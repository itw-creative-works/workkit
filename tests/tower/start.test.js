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
const { spawn } = require('child_process');
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
const start = (dir, api, app, ports = '') => spawn('bash', [SCRIPT], {
  env: {
    ...process.env, WORKKIT_TOWER_API: api, WORKKIT_TOWER_APP: app, WORKKIT_TOWER_PORTS: ports,
  },
  stdio: ['ignore', 'ignore', 'ignore'],
  cwd: dir,
});

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
