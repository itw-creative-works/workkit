// Tests for workflow/lib/detach.js, the detached runner: a bad argument list is
// a usage error, and a command it launches outlives the process that launched
// it, leaving its output in the log and its exit code in the done file. And for
// detach.sh's `wk_run_detached` on top of it: whose lock a run drops, and when
// a lock a finished run left is taken over.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, shellPath, stubTool, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { until, alive } = require('../lib/process');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const DETACH = path.join(LIB, 'detach.js');

const detach = (...args) => spawnSync(process.execPath, [DETACH, ...args], { encoding: 'utf8', timeout: 30000 });

/**
 * `wk_run_detached <log> <lock> -- node -e <script>` in a shell that sourced
 * the seam and detach.sh, the way both callers do, after the bash `before`; its
 * last stdout lines are `ran=<WK_RAN_CODE>` and `rc=<code>`. Node joins PATH
 * because the run starts through a Node supervisor.
 */
const runDetachedArgs = (dir, script, before = ':') => [...NO_RC, '-c', [
  `. ${JSON.stringify(shellPath(path.join(LIB, 'platform.sh')))}`,
  `. ${JSON.stringify(shellPath(path.join(LIB, 'detach.sh')))}`,
  before,
  'wk_run_detached "$1" "$2" -- node -e "$3"; rc=$?; printf "ran=%s\\nrc=%s\\n" "$WK_RAN_CODE" "$rc"',
].join('\n'), 'wk', shellPath(path.join(dir, 'log')), shellPath(path.join(dir, 'lock')), script];
const RUN_ENV = { PATH: systemPathWith(NODE_DIR) };

const rcOf = (out) => { const m = /rc=(\d+)\n$/.exec(out); return m ? Number(m[1]) : null; };
const ranOf = (out) => { const m = /(?:^|\n)ran=(\d*)\nrc=\d+\n$/.exec(out); return m ? m[1] : null; };

/** A run started without waiting, its stdout gathered; `result()` resolves on close. */
const startDetached = (args, env = RUN_ENV) => {
  const child = spawn(BASH, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { err += chunk.toString(); });
  const closed = new Promise((resolve) => { child.on('close', resolve); });
  return { child, result: () => closed.then(() => ({ out, err })) };
};

const run = async () => {
  group('detach: the argument list');

  await test('a bad argument list: exit 2, nothing launched', () => {
    const dir = mkTmp('detach-usage-');
    const log = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    const ran = path.join(dir, 'ran');
    const cmd = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, '')`];
    const bad = [[], [log], [log, done], [log, done, '--'], [log, done, ...cmd]];
    for (const args of bad) {
      const res = detach(...args);
      assertEq(res.status, 2, `usage error for argv ${JSON.stringify(args)}, stderr: ${res.stderr}`);
    }
    assert(!fs.existsSync(ran), 'no bad list ran its command');
    assert(!fs.existsSync(done), 'no bad list wrote a done file');
  });

  group('detach: the command outlives its launcher');

  await test('a parent that launches detach.js and exits at once: the command completes, done holds its code', async () => {
    const dir = mkTmp('detach-run-');
    const log = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    fs.writeFileSync(log, 'stale line from an earlier run\n');
    const cmd = [process.execPath, '-e', "setTimeout(() => { console.log('finished'); process.exit(4); }, 2000)"];
    // The parent hands detach.js its own argv and exits with its code, at once.
    const parent = spawnSync(process.execPath, ['-e', [
      "const r = require('child_process').spawnSync(process.execPath, process.argv.slice(1), { encoding: 'utf8' });",
      'process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");',
      'process.exit(r.status === null ? 1 : r.status);',
    ].join(' '), DETACH, log, done, '--', ...cmd], { encoding: 'utf8', timeout: 30000 });
    assertEq(parent.status, 0, `detach.js exits 0, stderr: ${parent.stderr}`);
    assert(/^\d+\s*$/.test(parent.stdout), `detach.js prints the supervisor's pid, got: ${JSON.stringify(parent.stdout)}`);
    const pid = Number(parent.stdout.trim());
    assert(alive(pid), 'the supervisor is alive after its launcher exited');
    assert(!fs.existsSync(done), 'the command was still running when its launcher had exited');
    assert(await until(() => fs.existsSync(done), 15000), `the done file never appeared at ${done}`);
    assertEq(fs.readFileSync(done, 'utf8'), '4\n', "the done file holds the command's exit code");
    const text = fs.readFileSync(log, 'utf8');
    assert(text.includes('finished'), `the log holds the command's output, got: ${JSON.stringify(text)}`);
    assert(!text.includes('stale line'), `the log was truncated first, got: ${JSON.stringify(text)}`);
  });

  group('detach.sh: wk_run_detached and its lock');

  await test('a lock whose pid was rewritten mid-run: the command\'s own code comes back and the lock stays', async () => {
    // The lock taken over by a newer run while this one still ran: the pid in it
    // is no longer this run's, so the lock is no longer this run's to drop.
    const dir = mkTmp('detach-owner-');
    const lock = path.join(dir, 'lock');
    const go = path.join(dir, 'go');
    const script = `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${JSON.stringify(go)}))process.exit(7)},50)`;
    const child = spawn(BASH, runDetachedArgs(dir, script), { env: RUN_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    const closed = new Promise((resolve) => { child.on('close', resolve); });
    try {
      const pidFile = path.join(lock, 'pid');
      assert(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '', 10000),
        `the run wrote its pid into the lock, stderr: ${err}`);
      fs.writeFileSync(pidFile, `${process.pid}\n`);
      fs.writeFileSync(go, '');
      assert(await until(() => child.exitCode !== null, 10000), `the run returned within 10 s, stdout: ${out}`);
      await closed;
      assertEq(rcOf(out), 7, `the command's own code, stdout: ${JSON.stringify(out)}, stderr: ${err}`);
      assert(fs.existsSync(lock), 'the lock the newer pid holds is still there');
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  });

  await test('a lock holding a done file and a gone pid is taken over: the command runs and its code comes back within 5 s', () => {
    // A finished run whose foreground never came to collect it.
    const dir = mkTmp('detach-done-');
    const lock = path.join(dir, 'lock');
    const ran = path.join(dir, 'ran');
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    assert(!alive(dead), `the stale pid ${dead} is gone`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'pid'), `${dead}\n`);
    fs.writeFileSync(path.join(lock, 'done'), '0\n');
    const script = `require('fs').writeFileSync(${JSON.stringify(ran)},'');process.exit(6)`;
    const start = Date.now();
    const res = spawnSync(BASH, runDetachedArgs(dir, script), { env: RUN_ENV, encoding: 'utf8', timeout: 30000 });
    const took = Date.now() - start;
    assertEq(rcOf(res.stdout || ''), 6, `the command's code, stdout: ${JSON.stringify(res.stdout)}, stderr: ${res.stderr}`);
    assert(fs.existsSync(ran), 'the command ran');
    assert(took < 5000, `within 5 s, took ${took} ms`);
  });

  await test('a run that starts on the lock the moment an earlier run\'s done file appears: each gets its own code', async () => {
    // A race, so it runs a few times: B spins on A's done file and calls the
    // moment it appears, while A's foreground is still collecting it.
    for (let round = 1; round <= 5; round += 1) {
      const dir = mkTmp('detach-race-');
      const lock = path.join(dir, 'lock');
      const go = path.join(dir, 'go');
      const first = startDetached(runDetachedArgs(dir,
        `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${JSON.stringify(go)}))process.exit(0)},20)`));
      const second = startDetached(runDetachedArgs(dir, 'process.exit(5)',
        'until [ -e "$2/done" ]; do :; done'));
      try {
        assert(await until(() => fs.existsSync(path.join(lock, 'pid')), 10000), `round ${round}: run A took the lock`);
        fs.writeFileSync(go, '');
        assert(await until(() => first.child.exitCode !== null && second.child.exitCode !== null, 15000),
          `round ${round}: both runs returned within 15 s`);
        const a = await first.result();
        const b = await second.result();
        assertEq(rcOf(a.out), 0, `round ${round}: run A's own code, stdout: ${JSON.stringify(a.out)}, stderr: ${a.err}`);
        assertEq(rcOf(b.out), 5, `round ${round}: run B's own code, stdout: ${JSON.stringify(b.out)}, stderr: ${b.err}`);
      } finally {
        for (const { child } of [first, second]) if (child.exitCode === null) child.kill('SIGKILL');
      }
    }
  });

  await test('WK_RAN_CODE: the command\'s code after it ran, empty when the runner could not start', () => {
    const dir = mkTmp('detach-ran-');
    const ran = spawnSync(BASH, runDetachedArgs(dir, 'process.exit(7)'), { env: RUN_ENV, encoding: 'utf8', timeout: 30000 });
    assertEq(rcOf(ran.stdout || ''), 7, `the command's code comes back, stdout: ${JSON.stringify(ran.stdout)}, stderr: ${ran.stderr}`);
    assertEq(ranOf(ran.stdout || ''), '7', `WK_RAN_CODE holds it, stdout: ${JSON.stringify(ran.stdout)}`);

    // A node ahead of the real one that fails, so the Node supervisor never
    // runs; WK_RAN_CODE starts stale, so empty means the call reset it.
    const bin = path.join(mkTmp('detach-nonode-'), 'bin');
    fs.mkdirSync(bin);
    stubTool(bin, 'node', ['#!/bin/bash', 'exit 1']);
    const failed = spawnSync(BASH, runDetachedArgs(mkTmp('detach-ran-'), 'process.exit(7)', 'WK_RAN_CODE=7'),
      { env: { PATH: systemPathWith(bin, NODE_DIR) }, encoding: 'utf8', timeout: 30000 });
    assertEq(rcOf(failed.stdout || ''), 1, `the runner's 1, stdout: ${JSON.stringify(failed.stdout)}, stderr: ${failed.stderr}`);
    assertEq(ranOf(failed.stdout || ''), '', `WK_RAN_CODE is empty, stdout: ${JSON.stringify(failed.stdout)}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
