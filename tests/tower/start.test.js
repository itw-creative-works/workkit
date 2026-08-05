//
// Tests for tower/start.sh — the one command that runs the whole tower.
//
// The script is run for REAL, but with both server commands injected
// (WORKKIT_TOWER_API / WORKKIT_TOWER_APP), so no port is opened and no
// framework toolchain is needed: each stub records its own pid and sleeps,
// and the assertions are about lifecycles — both start, one interrupt ends
// both, and one process ending takes the other with it.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const SCRIPT = path.join(__dirname, '..', '..', 'tower', 'start.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-start-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Poll until the predicate holds or the deadline passes — the script's own
// down-taker polls at one-second ticks, so lifecycle assertions wait for it.
const until = async (predicate, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
};

const readPid = (file) => Number(fs.readFileSync(file, 'utf8').trim());

// The port takeover is aimed at nothing unless a test says otherwise, so a
// run here never touches whatever this machine really has on 8693/4300.
const start = (dir, api, app, ports = '', { args = [], env = {}, capture = false } = {}) => spawn('bash', [SCRIPT, ...args], {
  env: {
    ...process.env, WORKKIT_TOWER_API: api, WORKKIT_TOWER_APP: app, WORKKIT_TOWER_PORTS: ports, ...env,
  },
  stdio: ['ignore', capture ? 'pipe' : 'ignore', capture ? 'pipe' : 'ignore'],
  cwd: dir,
});

// What the user actually sees: both streams of a captured run, in one string.
const collect = (child) => {
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { out += chunk.toString(); });
  return () => out;
};

// The ports the output tests hand the wrapper: high and unused, so the reclaim
// pass finds nothing and this machine's real tower is never touched.
const QUIET_PORTS = '18693 14300';

// A stand-in for the dev server's log wall — the chatter someone who typed
// `workkit tower` did not ask for, the two lines that matter, and the URL
// omega announces twice (its https proxy, then the dev server itself).
const NOISY_APP = [
  "echo 'omega: no cloudflare account id configured, skipping'",
  "echo 'compiled 42 files in 1.2s'",
  "echo 'HTTPS proxy listening on https://localhost:14300'",
  "echo 'Dev server: https://localhost:14300'",
  "echo 'WARN missing key: analytics'",
  "echo 'Error: the board failed to load' >&2",
  'exec sleep 30',
].join('; ');

// The shapes a half dies in that carry none of the obvious keywords — a
// missing binary, a missing module, a permission, a signal, an npm failure.
// Each is a run that is already over; a filter that swallowed them would leave
// the terminal blank about it.
const FAILURE_SHAPES = [
  'sh: omega: command not found',
  'Cannot find module @omega.js/core',
  'ENOENT: no such file or directory, open package.json',
  'EACCES: permission denied, mkdir /usr/local/lib',
  'Missing binding /node_modules/node-sass/vendor/binding.node',
  'Segmentation fault: 11',
  'Killed: 9',
  'npm ERR! code ELIFECYCLE',
];

const FAILING_APP = [...FAILURE_SHAPES.map((line) => `echo '${line}'`), 'exec sleep 30'].join('; ');

// The app coming up somewhere other than where it was asked to: omega takes
// the next free port when its own is busy, and says so.
const BUMPED_APP = [
  "echo 'Port 14300 was taken — bumped to 14301'",
  "echo 'Dev server: https://localhost:14301'",
  'exec sleep 30',
].join('; ');

// The pty case needs a real terminal to send a real Ctrl-C down; expect is the
// only portable way to get one, and a machine without it says so rather than
// pretending the case ran.
const hasExpect = () => spawnSync('sh', ['-c', 'command -v expect'], { stdio: 'ignore' }).status === 0;

const run = async () => {
  group('tower/start: one command, both processes');

  await test('both halves start, and one interrupt ends both', async () => {
    const dir = mkTmp();
    const apiPid = path.join(dir, 'api.pid');
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      `echo $$ > '${apiPid}'; exec sleep 30`,
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(apiPid) && fs.existsSync(appPid)), 'both commands were started');
      const pids = [readPid(apiPid), readPid(appPid)];
      assert(pids.every(alive), 'and both are running');

      child.kill('SIGTERM');
      assert(await until(() => pids.every((pid) => !alive(pid))), 'one interrupt took both down');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('either half ending takes the other with it — nothing lingers half-up', async () => {
    const dir = mkTmp();
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      'sleep 0.3',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(appPid)), 'the surviving half started');
      const pid = readPid(appPid);
      assert(await until(() => !alive(pid)), 'and ended when its sibling did');
      assert(await until(() => child.exitCode !== null), 'the wrapper itself ended too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a half that exits leaving a background child behind still ends the other', async () => {
    // The failure this pins (#138 review, B2): with the filter DOWNSTREAM in a
    // pipeline, the pid the down-taker watched was the pipeline's wrapper,
    // which lives until every writer of the pipe has closed. This stub's
    // leftover child holds that pipe, so the wrapper never ended and the tower
    // sat half-up forever instead of coming down.
    const dir = mkTmp();
    const appPid = path.join(dir, 'app.pid');
    const child = start(dir,
      'sleep 15 & exit 0',
      `echo $$ > '${appPid}'; exec sleep 30`);
    try {
      assert(await until(() => fs.existsSync(appPid)), 'the surviving half started');
      const pid = readPid(appPid);
      assert(await until(() => !alive(pid)), 'and ended when its sibling exited');
      assert(await until(() => child.exitCode !== null), 'the wrapper itself ended too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('ending a half ends its whole tree — a grandchild server dies with it', async () => {
    const dir = mkTmp();
    const kidPid = path.join(dir, 'kid.pid');
    // The app stub puts a child between itself and the sleeper, the way npm
    // and omega put children between the wrapper and the real server.
    const child = start(dir,
      'exec sleep 30',
      `bash -c "echo \\$\\$ > '${kidPid}'; exec sleep 30" & wait`);
    try {
      assert(await until(() => fs.existsSync(kidPid)), 'the grandchild started');
      const pid = readPid(kidPid);
      child.kill('SIGTERM');
      assert(await until(() => !alive(pid)), 'and died with the tree, not orphaned');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a previous instance on a tower port is replaced, not collided with', async () => {
    // A stand-in for a leftover server: a child of THIS test listening on an
    // ephemeral port, handed to the wrapper as the tower's port.
    const listener = spawn(process.execPath, ['-e',
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stand-in took a port');

    const dir = mkTmp();
    const child = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      assert(await until(() => listener.exitCode !== null || listener.signalCode !== null),
        'the wrapper ended it before starting its own');
      assert(await until(() => child.exitCode !== null), 'and the run itself completed');
      assertEq(child.exitCode, 0, 'cleanly');
    } finally {
      child.kill('SIGKILL');
      listener.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('a listener that ignores the polite signal is escalated, not collided with', async () => {
    // The failure this pins (#97 review, B1): reclaim's wait loop always
    // returned 0, so a TERM-resistant listener rode out the 5s deadline and
    // the fresh server died EADDRINUSE with nothing explaining why.
    const listener = spawn(process.execPath, ['-e',
      "process.on('SIGTERM',()=>{});const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));"],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    let port = '';
    listener.stdout.on('data', (chunk) => { port += chunk.toString(); });
    assert(await until(() => port.trim().length > 0), 'the stubborn stand-in took a port');

    const dir = mkTmp();
    const child = start(dir, 'exec sleep 0.5', 'exec sleep 0.5', port.trim());
    try {
      assert(await until(() => listener.exitCode !== null || listener.signalCode !== null, 15000),
        'the wrapper ended it anyway — the escalation exists');
      assert(await until(() => child.exitCode !== null, 15000), 'and the run completed');
      assertEq(child.exitCode, 0, 'cleanly, on the freed port');
    } finally {
      child.kill('SIGKILL');
      listener.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the default run is quiet: the log wall is dropped, the problems and one URL line survive', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /tower: dashboard at/.test(out())), 'the dashboard was announced');
      assert(await until(() => /the board failed to load/.test(out())), 'the error line came through');
      const text = out();
      assert(/tower: dashboard at https:\/\/localhost:14300/.test(text), 'at the URL the app itself named');
      assertEq(text.match(/tower: dashboard at/g).length, 1, 'once, not once per URL the app printed');
      assert(/WARN missing key/.test(text), 'the warning came through too');
      assert(!/cloudflare/.test(text), 'the framework chatter did not');
      assert(!/compiled 42 files/.test(text), 'nor the build timings');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('the shapes a failure really arrives in all survive the filter', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', FAILING_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /ELIFECYCLE/.test(out())), 'the app half was read to its last line');
      const text = out();
      FAILURE_SHAPES.forEach((line) => {
        assert(text.includes(line), `"${line}" came through`);
      });
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('an app on a bumped port is still announced — and says it was bumped', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', BUMPED_APP, QUIET_PORTS, { capture: true });
    const out = collect(child);
    try {
      assert(await until(() => /tower: dashboard at/.test(out())), 'the dashboard was announced');
      const text = out();
      assert(/tower: dashboard at https:\/\/localhost:14301/.test(text), 'at the port it actually took, not the one it was asked for');
      assertEq(text.match(/tower: dashboard at/g).length, 1, 'once');
      assert(/bumped to 14301/.test(text), 'and the line explaining the move survived too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('--verbose passes the whole wall through, as before', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS, { capture: true, args: ['--verbose'] });
    const out = collect(child);
    try {
      assert(await until(() => /compiled 42 files/.test(out())), 'the build timings are back');
      const text = out();
      assert(/cloudflare/.test(text), 'and the framework chatter with them');
      assert(/Dev server: https:\/\/localhost:14300/.test(text), "the app's own URL line stands unrewritten");
      assert(!/tower: dashboard at/.test(text), 'so the wrapper adds no second one');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  await test('WORKKIT_TOWER_VERBOSE=1 is the same door, for callers that pass no arguments', async () => {
    const dir = mkTmp();
    const child = start(dir, 'exec sleep 30', NOISY_APP, QUIET_PORTS,
      { capture: true, env: { WORKKIT_TOWER_VERBOSE: '1' } });
    const out = collect(child);
    try {
      assert(await until(() => /compiled 42 files/.test(out())), 'the env var opens the wall too');
    } finally {
      child.kill('SIGKILL');
      cleanup(dir);
    }
  });

  if (hasExpect()) {
    await test('a real Ctrl-C ends it silently — no job-control lines under a terminal', async () => {
      // Only a pty shows this (#138 review, B1): the suite's own runs redirect
      // both streams and never signal, so bash's "Terminated: 15 … Done …"
      // announcements — which it makes for a job some OTHER shell killed —
      // were invisible here while filling the terminal of everyone who typed
      // the command and pressed Ctrl-C.
      const dir = mkTmp();
      const runner = path.join(dir, 'runner.sh');
      const script = path.join(dir, 'ctrl-c.exp');
      fs.writeFileSync(runner, [
        '#!/usr/bin/env bash',
        `export WORKKIT_TOWER_PORTS='${QUIET_PORTS}'`,
        "export WORKKIT_TOWER_API='exec sleep 30'",
        'export WORKKIT_TOWER_APP="echo \'Dev server: https://localhost:14300\'; exec sleep 30"',
        `exec bash '${SCRIPT}'`,
        '',
      ].join('\n'));
      fs.writeFileSync(script, [
        'set timeout 20',
        `spawn bash ${runner}`,
        'expect -re "dashboard at"',
        'send \\003',
        'expect eof',
        '',
      ].join('\n'));

      const child = spawn('expect', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      const out = collect(child);
      try {
        assert(await until(() => child.exitCode !== null, 25000), 'the run came down on the interrupt');
        const text = out();
        assert(/tower: dashboard at/.test(text), 'the terminal saw the one line it should');
        assert(!/Terminated/.test(text), 'and no job-control obituary for the halves');
        assert(!/\bDone\b/.test(text), 'nor for their filters');
      } finally {
        child.kill('SIGKILL');
        cleanup(dir);
      }
    });
  } else {
    console.log('  \x1b[33m⊘ a real Ctrl-C ends it silently: expect is not installed\x1b[0m');
  }

  await test('workkit tower hands this script its arguments, so --verbose gets here', () => {
    // The other door, and the one that dropped the flag on the floor: the CLI
    // exec'd the wrapper with nothing, so `workkit tower --verbose` was quiet.
    const cli = fs.readFileSync(path.join(__dirname, '..', '..', 'workflow', 'workkit.sh'), 'utf8');
    assert(/exec bash "\$TOWER_START" "\$@"/.test(cli), 'the CLI forwards what it was given');
  });

  await test('npm run tower is this script, and its defaults are the two real servers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    assertEq(pkg.scripts.tower, 'bash tower/start.sh', 'the root command runs the wrapper');
    const script = fs.readFileSync(SCRIPT, 'utf8');
    assert(script.includes('tower/api/server.js'), 'one default is the JSON API');
    assert(/tower\/app.*npm run dev/.test(script), 'the other is the dashboard dev server');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
