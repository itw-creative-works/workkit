// Tests for workflow/lib/detach.js, the detached runner: a bad argument list is
// a usage error, and a command it launches outlives the process that launched
// it, leaving its output in the log and its exit code in the done file. And for
// detach.sh's `wk_run_detached` on top of it: whose lock a run drops, and when
// a lock a finished run left is taken over, the code two attached calls get,
// and the whole run an INT to the call ends. Then the supervisor's checks: a frozen run ended whole, a busy one never,
// an unclear one given a look, an end on request and one that fails, a failed process read, and
// the awake hold on a Mac.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun, mkTmp, until, alive, run, start,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, shellPath, stubTool, systemPathWith, homeEnv,
} = require('../lib/platform');
const {
  CHECK_MINUTES, processTest, FROZEN_LINE, checkSettings, pidIn, pidOf, reap,
  jsPath, writesPid, silent, busy, ended, read, lastLine, realOf,
} = require('../lib/supervise');
const { scratchWorkflowHome } = require('../lib/workflow-home');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const DETACH = path.join(LIB, 'detach.js');

const detach = (...args) => run(process.execPath, [DETACH, ...args]);

/**
 * `wk_run_detached <log> <lock> [--root <root>] -- node -e <script>` in a shell
 * that sourced the seam and detach.sh, the way both callers do, after the bash
 * `before`; its last stdout lines are `look=<WK_RAN_LOOK>`, `ran=<WK_RAN_CODE>`
 * and `rc=<code>`, and the shell exits with that code. Node joins PATH because the
 * run starts through a Node supervisor.
 */
const SOURCED = [
  `. ${JSON.stringify(shellPath(path.join(LIB, 'platform.sh')))}`,
  `. ${JSON.stringify(shellPath(path.join(LIB, 'detach.sh')))}`,
];
const runDetachedArgs = (dir, script, before = ':', root = null) => [...NO_RC, '-c', [
  ...SOURCED,
  before,
  `wk_run_detached "$1" "$2" ${root ? '--root "$4" ' : ''}-- node -e "$3"; rc=$?`,
  'printf "look=%s\\nran=%s\\nrc=%s\\n" "$WK_RAN_LOOK" "$WK_RAN_CODE" "$rc"',
  'exit "$rc"',
].join('\n'), 'wk', shellPath(path.join(dir, 'log')), shellPath(path.join(dir, 'lock')), script,
...(root ? [shellPath(root)] : [])];
/**
 * `wk_attach_run <log> <lock> <pid>` on the run runDetachedArgs started in <dir>,
 * in a shell that sourced the same two files and first touched <marker>; its last
 * stdout line is `rc=<code>`.
 */
const attachArgs = (dir, pid, marker) => [...NO_RC, '-c', [
  ...SOURCED,
  ': > "$4"',
  'wk_attach_run "$1" "$2" "$3"; rc=$?',
  'printf "rc=%s\\n" "$rc"',
].join('\n'), 'wk', shellPath(path.join(dir, 'log')), shellPath(path.join(dir, 'lock')), String(pid), shellPath(marker)];
const RUN_ENV = { PATH: systemPathWith(NODE_DIR) };

const rcOf = (out) => { const m = /rc=(\d+)\n$/.exec(out); return m ? Number(m[1]) : null; };
const ranOf = (out) => { const m = /(?:^|\n)ran=(\d*)\nrc=\d+\n$/.exec(out); return m ? m[1] : null; };
const lookOf = (out) => { const m = /(?:^|\n)look=(\d*)\nran=\d*\nrc=\d+\n$/.exec(out); return m ? m[1] : null; };

/**
 * A scratch machine folder, so no case reads the machine's own settings: the env
 * naming it, holding <settings> as its settings file when given.
 */
const machineEnv = (settings) => {
  const { workflowHome, env } = scratchWorkflowHome('detach-home-');
  if (settings) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(path.join(workflowHome, 'settings.json'), settings);
  }
  return homeEnv(path.dirname(workflowHome), { PATH: process.env.PATH, WORKFLOW_HOME: env.WORKFLOW_HOME });
};

/** A scratch folder whose `.workkit/settings.json` is <body>. */
const rootHolding = (body) => {
  const root = mkTmp('detach-root-');
  fs.mkdirSync(path.join(root, '.workkit'));
  fs.writeFileSync(path.join(root, '.workkit', 'settings.json'), body);
  return root;
};

/** A scratch folder whose `.workkit/settings.json` sets `tests.check` to <check>. */
const rootWith = (check) => rootHolding(checkSettings(check));

/** A machine env whose PATH finds a `ps` that fails, ahead of node and the system tools. */
const failingPsEnv = (dir) => {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  stubTool(bin, 'ps', ['#!/bin/bash', 'exit 1']);
  return { ...machineEnv(), PATH: systemPathWith(bin, NODE_DIR) };
};

// The fake commands beside the shared ones, each writing its own pid to <pidFile>.
// One short busy child after another, each about 0.4 seconds on one core, nothing written.
const shortBusyChildren = (pidFile) => [
  "const { spawnSync } = require('child_process');",
  writesPid(pidFile),
  "const child = 'const end = Date.now() + 400; while (Date.now() < end) {}';",
  "for (;;) spawnSync(process.execPath, ['-e', child]);",
].join('\n');
const ignoresTerm = (pidFile) => `process.on('SIGTERM', () => {});\n${silent(pidFile)}`;
// A silent parent of a child running <childScript>, in its own session when <detached>.
const parentOf = (pidFile, childScript, detached) => [
  "const { spawn } = require('child_process');",
  `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { detached: ${detached}, stdio: 'ignore' });`,
  silent(pidFile),
].join('\n');
// A line to the log a quarter check apart, then exit 3, about ten checks in.
const TICKS = "let n = 0; setInterval(() => { console.log('tick'); n += 1; if (n === 40) process.exit(3); }, 300);";

/**
 * detach.js launching node -e <script> with its log and done file in <dir>, under a
 * scratch machine folder unless <env> names one, the run's settings read from
 * <root> when given; the supervisor's pid it printed.
 */
const launch = (dir, script, { root, env = machineEnv(), cwd } = {}) => {
  const rootArgs = root ? ['--root', root] : [];
  const res = run(process.execPath, [DETACH, path.join(dir, 'log'), path.join(dir, 'done'), ...rootArgs, '--',
    process.execPath, '-e', script], { env, cwd });
  assertEq(res.status, 0, `detach.js exits 0, stderr: ${res.stderr}`);
  return Number(res.stdout.trim());
};

// An evidence line naming <pid>: `detach:   <pid> <seconds>s <command>`.
const evidenceOf = (pid) => new RegExp(`(?:^|\\n)detach: {3}${pid} [0-9.]+s \\S`);
const LOOK_LINE = /^detach: the run goes on; read (.+), then run workkit watch to keep waiting or workkit watch --end to end it \(exit 125\)$/m;
const BAD_VALUE_LINE = /^detach: tests\.check must be a number of minutes above 0 \(got (.+)\)$/m;

// A case that fails the process read through a stub ps, which only the macOS read runs.
const psTest = testUnless(process.platform !== 'darwin', 'the process read is ps on macOS alone: Linux reads /proc, Windows reads nothing');

// A Ctrl-C on the attached call, sent to the call alone.
const intTest = testUnless(IS_WINDOWS, 'Windows delivers no INT to one process');
const REQUEST_LINE = 'detach: the run was ended on request (exit 143)';
// A pid that still runs: a zombie waiting on a stopped parent is gone.
const running = (pid) => alive(pid) && !/^Z/.test(run('ps', ['-o', 'stat=', '-p', String(pid)]).stdout.trim());

const cases = async () => {
  group('detach: the argument list');

  await test('a bad argument list: exit 2, nothing launched', () => {
    const dir = mkTmp('detach-usage-');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    const ran = path.join(dir, 'ran');
    const cmd = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, '')`];
    const bad = [[], [logFile], [logFile, done], [logFile, done, '--'], [logFile, done, ...cmd]];
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
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    fs.writeFileSync(logFile, 'stale line from an earlier run\n');
    const cmd = [process.execPath, '-e', "setTimeout(() => { console.log('finished'); process.exit(4); }, 2000)"];
    // The parent hands detach.js its own argv and exits with its code, at once.
    const parent = run(process.execPath, ['-e', [
      "const r = require('child_process').spawnSync(process.execPath, process.argv.slice(1), { encoding: 'utf8' });",
      'process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || "");',
      'process.exit(r.status === null ? 1 : r.status);',
    ].join(' '), DETACH, logFile, done, '--', ...cmd]);
    assertEq(parent.status, 0, `detach.js exits 0, stderr: ${parent.stderr}`);
    assert(/^\d+\s*$/.test(parent.stdout), `detach.js prints the supervisor's pid, got: ${JSON.stringify(parent.stdout)}`);
    const pid = Number(parent.stdout.trim());
    assert(alive(pid), 'the supervisor is alive after its launcher exited');
    assert(!fs.existsSync(done), 'the command was still running when its launcher had exited');
    assert(await until(() => fs.existsSync(done)), `the done file never appeared at ${done}`);
    assertEq(fs.readFileSync(done, 'utf8'), '4\n', "the done file holds the command's exit code");
    const text = fs.readFileSync(logFile, 'utf8');
    assert(text.includes('finished'), `the log holds the command's output, got: ${JSON.stringify(text)}`);
    assert(!text.includes('stale line'), `the log was truncated first, got: ${JSON.stringify(text)}`);
  });

  await test('a shell command under the supervisor: its output reaches the log, its code the done file', async () => {
    // The suite and the CI watch are both shell commands, and on Windows a
    // shell child writes nothing to a log the supervisor opened append-only.
    const dir = mkTmp('detach-shell-');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    const res = detach(logFile, done, '--', BASH, ...NO_RC, '-c', 'echo from-the-shell; echo to-stderr >&2; exit 3');
    assertEq(res.status, 0, `detach.js exits 0, stderr: ${res.stderr}`);
    assert(await until(() => fs.existsSync(done)), `the done file never appeared at ${done}`);
    assertEq(fs.readFileSync(done, 'utf8'), '3\n', "the done file holds the shell's exit code");
    const text = fs.readFileSync(logFile, 'utf8');
    assert(text.includes('from-the-shell'), `the log holds the shell's stdout, got: ${JSON.stringify(text)}`);
    assert(text.includes('to-stderr'), `the log holds the shell's stderr, got: ${JSON.stringify(text)}`);
  });

  group('detach.sh: wk_run_detached and its lock');

  await test('a lock whose pid was rewritten mid-run: the command\'s own code comes back and the lock stays', async () => {
    // The lock taken over by a newer run while this one still ran: the pid in it
    // is no longer this run's, so the lock is no longer this run's to drop.
    const dir = mkTmp('detach-owner-');
    const lock = path.join(dir, 'lock');
    const go = path.join(dir, 'go');
    const script = `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${jsPath(go)}))process.exit(7)},50)`;
    const runner = start(BASH, runDetachedArgs(dir, script), { env: RUN_ENV });
    try {
      const pidFile = path.join(lock, 'pid');
      assert(await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== ''),
        `the run wrote its pid into the lock, stderr: ${runner.stderr()}`);
      fs.writeFileSync(pidFile, `${process.pid}\n`);
      fs.writeFileSync(go, '');
      assert(await until(() => runner.child.exitCode !== null), `the run never returned, stdout: ${runner.stdout()}`);
      await runner.done;
      const out = runner.stdout();
      assertEq(rcOf(out), 7, `the command's own code, stdout: ${JSON.stringify(out)}, stderr: ${runner.stderr()}`);
      assert(fs.existsSync(lock), 'the lock the newer pid holds is still there');
    } finally {
      await runner.end('SIGKILL');
    }
  });

  await test('a lock holding a done file and a gone pid is taken over: the command runs and its code comes back', () => {
    // A finished run whose foreground never came to collect it.
    const dir = mkTmp('detach-done-');
    const lock = path.join(dir, 'lock');
    const ran = path.join(dir, 'ran');
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    assert(!alive(dead), `the stale pid ${dead} is gone`);
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'pid'), `${dead}\n`);
    fs.writeFileSync(path.join(lock, 'done'), '0\n');
    const script = `require('fs').writeFileSync(${jsPath(ran)},'');process.exit(6)`;
    const res = run(BASH, runDetachedArgs(dir, script), { env: RUN_ENV });
    assertEq(rcOf(res.stdout || ''), 6, `the command's code, stdout: ${JSON.stringify(res.stdout)}, stderr: ${res.stderr}`);
    assert(fs.existsSync(ran), 'the command ran');
  });

  await test('a run that starts on the lock the moment an earlier run\'s done file appears: each gets its own code', async () => {
    // A race, so it runs a few times: B spins on A's done file and calls the
    // moment it appears, while A's foreground is still collecting it.
    for (let round = 1; round <= 5; round += 1) {
      const dir = mkTmp('detach-race-');
      const lock = path.join(dir, 'lock');
      const go = path.join(dir, 'go');
      const first = start(BASH, runDetachedArgs(dir,
        `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${jsPath(go)}))process.exit(0)},20)`), { env: RUN_ENV });
      // B marks the moment its spin starts: under load its shell can come up
      // after A would otherwise have finished and dropped the lock.
      const spinning = `${lock}.spinning`;
      const second = start(BASH, runDetachedArgs(dir, 'process.exit(5)',
        ': > "$2.spinning"; seen=; until [ -e "$2/done" ]; do if [ -d "$2" ]; then seen=1; elif [ -n "$seen" ]; then break; fi; done'), { env: RUN_ENV });
      try {
        assert(await until(() => fs.existsSync(path.join(lock, 'pid'))), `round ${round}: run A took the lock`);
        assert(await until(() => fs.existsSync(spinning)), `round ${round}: run B is spinning on the done file`);
        fs.writeFileSync(go, '');
        assert(await until(() => first.child.exitCode !== null && second.child.exitCode !== null),
          `round ${round}: both runs returned`);
        await Promise.all([first.done, second.done]);
        assertEq(rcOf(first.stdout()), 0, `round ${round}: run A's own code, stdout: ${JSON.stringify(first.stdout())}, stderr: ${first.stderr()}`);
        assertEq(rcOf(second.stdout()), 5, `round ${round}: run B's own code, stdout: ${JSON.stringify(second.stdout())}, stderr: ${second.stderr()}`);
      } finally {
        await Promise.all([first.end('SIGKILL'), second.end('SIGKILL')]);
      }
    }
  });

  await test('WK_RAN_CODE: the command\'s code after it ran, empty when the runner could not start', () => {
    const dir = mkTmp('detach-ran-');
    const ran = run(BASH, runDetachedArgs(dir, 'process.exit(7)'), { env: RUN_ENV });
    assertEq(rcOf(ran.stdout || ''), 7, `the command's code comes back, stdout: ${JSON.stringify(ran.stdout)}, stderr: ${ran.stderr}`);
    assertEq(ranOf(ran.stdout || ''), '7', `WK_RAN_CODE holds it, stdout: ${JSON.stringify(ran.stdout)}`);

    // A node ahead of the real one that fails, so the Node supervisor never
    // runs; WK_RAN_CODE starts stale, so empty means the call reset it.
    const bin = path.join(mkTmp('detach-nonode-'), 'bin');
    fs.mkdirSync(bin);
    stubTool(bin, 'node', ['#!/bin/bash', 'exit 1']);
    const failed = run(BASH, runDetachedArgs(mkTmp('detach-ran-'), 'process.exit(7)', 'WK_RAN_CODE=7'),
      { env: { PATH: systemPathWith(bin, NODE_DIR) } });
    assertEq(rcOf(failed.stdout || ''), 1, `the runner's 1, stdout: ${JSON.stringify(failed.stdout)}, stderr: ${failed.stderr}`);
    assertEq(ranOf(failed.stdout || ''), '', `WK_RAN_CODE is empty, stdout: ${JSON.stringify(failed.stdout)}`);
  });

  await processTest('a run that asks for a look: the evidence and the look\'s last line, 125 with WK_RAN_LOOK 1, the lock held, the run alive', () => {
    const dir = mkTmp('detach-look-sh-');
    const pidFile = path.join(dir, 'cmd.pid');
    const lockPid = path.join(dir, 'lock', 'pid');
    try {
      const res = run(BASH, runDetachedArgs(dir, busy(pidFile), ':', rootWith(CHECK_MINUTES)),
        { env: { ...machineEnv(), ...RUN_ENV } });
      const out = res.stdout || '';
      assertEq(rcOf(out), 125, `the look's code, stdout: ${JSON.stringify(out)}, stderr: ${res.stderr}`);
      assertEq(lookOf(out), '1', `WK_RAN_LOOK is 1, stdout: ${JSON.stringify(out)}`);
      const cmd = pidIn(pidFile);
      assert(evidenceOf(cmd).test(res.output), `the evidence names the command ${cmd}, got: ${res.output}`);
      const said = LOOK_LINE.exec(res.output);
      assert(said, `the look's last line, got: ${res.output}`);
      assertEq(realOf(said[1]), realOf(path.join(dir, 'log')), `the line names the log, got: ${said[0]}`);
      const holder = pidIn(lockPid);
      assert(holder !== undefined && alive(holder), `the lock is still held by a live supervisor, pid: ${holder}`);
      assert(alive(cmd), `the run ${cmd} still lives`);
    } finally {
      reap(pidIn(pidFile), pidIn(lockPid));
    }
  });

  await test('two calls attached to one run: when the command exits 5, both return 5', async () => {
    const dir = mkTmp('detach-two-');
    const go = path.join(dir, 'go');
    const marker = path.join(dir, 'attached');
    const lockPid = path.join(dir, 'lock', 'pid');
    const env = { ...machineEnv(), ...RUN_ENV };
    const script = `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${jsPath(go)}))process.exit(5)},50)`;
    const first = start(BASH, runDetachedArgs(dir, script), { env });
    let second;
    try {
      const supervisor = await pidOf(lockPid);
      second = start(BASH, attachArgs(dir, supervisor, marker), { env });
      assert(await until(() => fs.existsSync(marker)), `the second call never started, stderr: ${second.stderr()}`);
      fs.writeFileSync(go, '');
      assert(await until(() => first.child.exitCode !== null && second.child.exitCode !== null), 'both calls returned');
      await Promise.all([first.done, second.done]);
      assertEq(rcOf(first.stdout()), 5, `the starting call's code, stdout: ${JSON.stringify(first.stdout())}, stderr: ${first.stderr()}`);
      assertEq(rcOf(second.stdout()), 5, `the attached call's code, stdout: ${JSON.stringify(second.stdout())}, stderr: ${second.stderr()}`);
    } finally {
      reap(pidIn(lockPid));
      await Promise.all([first.end('SIGKILL'), second && second.end('SIGKILL')]);
    }
  });

  group('detach: a run with no output and no processor use is ended');

  await processTest('a command that waits in silence: the evidence, then the frozen line, done 124, the command gone', async () => {
    const dir = mkTmp('detach-frozen-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, silent(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      assert(await until(() => FROZEN_LINE.test(lastLine(read(logFile)))),
        `the log never ended with the frozen line, got: ${JSON.stringify(read(logFile))}`);
      assert(evidenceOf(cmd).test(read(logFile)), `the log holds an evidence line for ${cmd}, got: ${JSON.stringify(read(logFile))}`);
      assert(await until(() => read(done) !== ''), `the done file never appeared at ${done}`);
      assertEq(read(done), '124\n', 'the done file holds 124');
      assert(await until(() => !alive(cmd)), `the command ${cmd} is gone`);
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  await processTest('a frozen command\'s child in its own session is gone too', async () => {
    const dir = mkTmp('detach-session-');
    const pidFile = path.join(dir, 'cmd.pid');
    const childFile = path.join(dir, 'child.pid');
    let supervisor;
    try {
      supervisor = launch(dir, parentOf(pidFile, silent(childFile), true), { root: rootWith(CHECK_MINUTES) });
      await pidOf(pidFile);
      const child = await pidOf(childFile);
      assert(await until(() => !alive(child)), `the child ${child} in its own session outlived the run`);
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
    }
  });

  await processTest('a frozen command\'s child that ignores the terminate signal is gone after the forced end', async () => {
    const dir = mkTmp('detach-ignores-');
    const pidFile = path.join(dir, 'cmd.pid');
    const childFile = path.join(dir, 'child.pid');
    let supervisor;
    try {
      supervisor = launch(dir, parentOf(pidFile, ignoresTerm(childFile), false), { root: rootWith(CHECK_MINUTES) });
      await pidOf(pidFile);
      const child = await pidOf(childFile);
      assert(await until(() => !alive(child)), `the child ${child} that ignores the terminate signal outlived the run`);
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
    }
  });

  await processTest('a busy run made of short-lived children, nothing written: still running after four checks, no frozen line', async () => {
    const dir = mkTmp('detach-short-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    let supervisor;
    try {
      supervisor = launch(dir, shortBusyChildren(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      const fourChecks = CHECK_MINUTES * 60000 * 4;
      const ended = () => !alive(cmd) || read(logFile).split('\n').some((l) => FROZEN_LINE.test(l));
      assert(!(await until(ended, fourChecks)), `the run was ended, log: ${JSON.stringify(read(logFile))}`);
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  group('detach: a run with work and no output asks for a look');

  await processTest('a silent command that keeps a processor busy: after six checks the look file holds its evidence, and it still runs', async () => {
    const dir = mkTmp('detach-look-');
    const pidFile = path.join(dir, 'cmd.pid');
    const look = path.join(dir, 'look');
    let supervisor;
    try {
      supervisor = launch(dir, busy(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      assert(await until(() => evidenceOf(cmd).test(read(look))), `the look file never held ${cmd}'s evidence, got: ${JSON.stringify(read(look))}`);
      assert(alive(cmd), `the command ${cmd} still runs`);
      assert(!fs.existsSync(path.join(dir, 'done')), 'and the run has no done file');
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  await test('a command that writes to its log at every check and runs past six checks: its own code, no look file', async () => {
    const dir = mkTmp('detach-ticks-');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, TICKS, { root: rootWith(CHECK_MINUTES) });
      assert(await until(() => read(done) !== ''), `the done file never appeared at ${done}`);
      assertEq(read(done), '3\n', 'the done file holds the command\'s own code');
      assert(!fs.existsSync(path.join(dir, 'look')), 'no look was asked');
    } finally {
      reap(supervisor);
    }
  });

  group('detach: an end request');

  await test('an end file beside the done file: the command is gone, the log ends with the request line, done holds 143', async () => {
    // A check far longer than the case, so only the request can end the run.
    const dir = mkTmp('detach-end-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, silent(pidFile), { root: rootWith(10) });
      const cmd = await pidOf(pidFile);
      fs.writeFileSync(path.join(dir, 'end'), '');
      assert(await until(() => !alive(cmd)), `the command ${cmd} outlived the request`);
      assert(await until(() => read(done) !== ''), `the done file never appeared at ${done}`);
      assertEq(read(done), '143\n', 'the done file holds 143');
      assertEq(lastLine(read(logFile)), REQUEST_LINE, 'the log ends with the request line');
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  await psTest('an end file while the process read fails: the failed end line, no done file, the end file gone, the command still runs', async () => {
    // A check far longer than the case, so only the request acts on the run.
    const dir = mkTmp('detach-end-nops-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    const end = path.join(dir, 'end');
    const failed = /^detach: the run could not be ended \((.+)\), so it goes on$/m;
    let supervisor;
    try {
      supervisor = launch(dir, silent(pidFile), { root: rootWith(10), env: failingPsEnv(dir) });
      const cmd = await pidOf(pidFile);
      fs.writeFileSync(end, '');
      assert(await until(() => failed.test(read(logFile))), `the log never held the failed end line, got: ${JSON.stringify(read(logFile))}`);
      assert(await until(() => !fs.existsSync(end)), 'the end file was removed');
      assert(!(await until(() => fs.existsSync(path.join(dir, 'done')), 500)), 'no done file was written');
      assert(alive(cmd), `the command ${cmd} still runs`);
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  group('detach.sh: an INT to the attached call ends the whole run');

  // Each run checks far less often than the case lasts, so only the INT ends it.
  await intTest('a command with a child in its own session: both gone, the log ends with the request line, the lock gone, exit 130', async () => {
    const dir = mkTmp('detach-int-');
    const pidFile = path.join(dir, 'cmd.pid');
    const childFile = path.join(dir, 'child.pid');
    const lock = path.join(dir, 'lock');
    const runner = start(BASH, runDetachedArgs(dir, parentOf(pidFile, silent(childFile), true), ':', rootWith(10)),
      { env: { ...machineEnv(), ...RUN_ENV } });
    let supervisor;
    try {
      supervisor = await pidOf(path.join(lock, 'pid'));
      const cmd = await pidOf(pidFile);
      const child = await pidOf(childFile);
      process.kill(runner.pid, 'SIGINT');
      assert(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`);
      await runner.done;
      assertEq(runner.child.exitCode, 130, `the call exits 130, output: ${runner.output()}`);
      assert(await until(() => !alive(cmd)), `the command ${cmd} outlived the INT`);
      assert(await until(() => !alive(child)), `the child ${child} in its own session outlived the INT`);
      assertEq(lastLine(read(path.join(dir, 'log'))), REQUEST_LINE, 'the log ends with the request line');
      assert(!fs.existsSync(lock), 'the lock is gone');
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  await intTest('a call that attaches to the run once the INT\'d call has left: it returns 143', async () => {
    // The first call has dropped the lock, so the code can come from the record alone.
    const dir = mkTmp('detach-int-after-');
    const pidFile = path.join(dir, 'cmd.pid');
    const lock = path.join(dir, 'lock');
    const env = { ...machineEnv(), ...RUN_ENV };
    const first = start(BASH, runDetachedArgs(dir, silent(pidFile), ':', rootWith(10)), { env });
    let supervisor;
    try {
      supervisor = await pidOf(path.join(lock, 'pid'));
      await pidOf(pidFile);
      process.kill(first.pid, 'SIGINT');
      assert(await until(() => ended(first.child)), `the first call never returned, output: ${first.output()}`);
      await first.done;
      assert(!fs.existsSync(lock), 'the first call dropped the lock');
      const later = run(BASH, attachArgs(dir, supervisor, path.join(dir, 'attached')), { env });
      assertEq(rcOf(later.stdout || ''), 143, `the later call's code, stdout: ${JSON.stringify(later.stdout)}, stderr: ${later.stderr}`);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await first.end('SIGKILL');
    }
  });

  await intTest('a supervisor that does not answer the end request: once the wait runs out the command is gone, exit 130', async () => {
    // A stopped supervisor answers nothing; a one second wait keeps the case short.
    const dir = mkTmp('detach-int-stopped-');
    const pidFile = path.join(dir, 'cmd.pid');
    const runner = start(BASH, runDetachedArgs(dir, silent(pidFile), 'WK_END_WAIT=1', rootWith(10)),
      { env: { ...machineEnv(), ...RUN_ENV } });
    let supervisor;
    try {
      supervisor = await pidOf(path.join(dir, 'lock', 'pid'));
      const cmd = await pidOf(pidFile);
      process.kill(supervisor, 'SIGSTOP');
      process.kill(runner.pid, 'SIGINT');
      assert(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`);
      await runner.done;
      assertEq(runner.child.exitCode, 130, `the call exits 130, output: ${runner.output()}`);
      assert(await until(() => !running(cmd)), `the command ${cmd} outlived the INT`);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  await intTest('a supervisor gone with no done file: the call exits 130 with the wait not run out', async () => {
    // A wait far past the shared deadline, so only an early end of it returns in time. The
    // INT follows the forced end at once, well before the attach loop sees the supervisor gone.
    const dir = mkTmp('detach-int-gone-');
    const pidFile = path.join(dir, 'cmd.pid');
    const runner = start(BASH, runDetachedArgs(dir, silent(pidFile), 'WK_END_WAIT=600', rootWith(10)),
      { env: { ...machineEnv(), ...RUN_ENV } });
    let supervisor;
    try {
      supervisor = await pidOf(path.join(dir, 'lock', 'pid'));
      await pidOf(pidFile);
      process.kill(supervisor, 'SIGKILL');
      assert(await until(() => !alive(supervisor)), `the supervisor ${supervisor} outlived its forced end`);
      process.kill(runner.pid, 'SIGINT');
      assert(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`);
      await runner.done;
      assertEq(runner.child.exitCode, 130, `the call exits 130, output: ${runner.output()}`);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  group('detach: the checks and their setting');

  await test('no --root: a command that waits in silence runs to its own code, though the machine and the folder set a short check', async () => {
    const dir = mkTmp('detach-noroot-');
    const done = path.join(dir, 'done');
    const short = checkSettings(0.01);
    const script = 'setTimeout(() => process.exit(5), 4000);';
    let supervisor;
    try {
      supervisor = launch(dir, script, { env: machineEnv(short), cwd: rootWith(0.01) });
      assert(await until(() => read(done) !== ''), `the done file never appeared at ${done}`);
      assertEq(read(done), '5\n', 'the done file holds the command\'s own code');
    } finally {
      reap(supervisor);
    }
  });

  await psTest(
    'a ps that fails: the could-not-read line, and a silent command runs on to its own code',
    async () => {
      const dir = mkTmp('detach-nops-');
      const env = failingPsEnv(dir);
      const logFile = path.join(dir, 'log');
      const done = path.join(dir, 'done');
      let supervisor;
      try {
        supervisor = launch(dir, 'setTimeout(() => process.exit(6), 4000);', { root: rootWith(CHECK_MINUTES), env });
        assert(await until(() => read(done) !== ''), `the done file never appeared at ${done}`);
        assertEq(read(done), '6\n', 'the done file holds the command\'s own code');
        const said = /^detach: could not read the run's processes \((.+)\), so the checks are off$/m;
        assert(said.test(read(logFile)), `the log holds the could-not-read line, got: ${JSON.stringify(read(logFile))}`);
      } finally {
        reap(supervisor);
      }
    },
  );

  await test('tests.check of 0, a negative number, an infinite number or a word: the bad value line, exit 2, nothing runs', async () => {
    const dir = mkTmp('detach-bad-');
    const ran = path.join(dir, 'ran');
    const done = path.join(dir, 'done');
    const cmd = [process.execPath, '-e', `require('fs').writeFileSync(${jsPath(ran)}, '')`];
    // JSON has no infinite number, so 1e999 is the file's own text, and the line names what it reads as: Infinity.
    const bad = [
      ...[0, -1, 'five'].map((value) => ({ name: JSON.stringify(value), body: checkSettings(value), shown: JSON.stringify(value) })),
      { name: '1e999', body: '{ "tests": { "check": 1e999 } }\n', shown: 'Infinity' },
    ];
    for (const { name, body, shown } of bad) {
      const res = run(process.execPath, [DETACH, path.join(dir, 'log'), done, '--root', rootHolding(body), '--', ...cmd],
        { env: machineEnv() });
      assertEq(res.status, 2, `exit 2 for ${name}, output: ${res.output}`);
      const said = BAD_VALUE_LINE.exec(res.output.replace(/\r/g, ''));
      assert(said, `the bad value line for ${name}, got: ${res.output}`);
      assertEq(said[1], shown, `the line names the value ${name}`);
    }
    assert(!(await until(() => fs.existsSync(ran), 500)), 'no bad value ran its command');
    assert(!fs.existsSync(done), 'no bad value wrote a done file');
  });

  group('detach: the awake hold');

  await test('awakeCommand: the caffeinate argument list on darwin, null on linux and win32', () => {
    const { awakeCommand } = require(DETACH);
    assertEq(JSON.stringify(awakeCommand(123, 'darwin')), JSON.stringify(['caffeinate', '-i', '-w', '123']), 'darwin');
    for (const platform of ['linux', 'win32']) assertEq(awakeCommand(123, platform), null, platform);
  });

  await testUnless(process.platform !== 'darwin', 'caffeinate is macOS only')(
    'a Mac and a supervised command: a caffeinate naming the supervisor\'s pid lives while the command runs',
    async () => {
      const dir = mkTmp('detach-awake-');
      const pidFile = path.join(dir, 'cmd.pid');
      let supervisor;
      try {
        supervisor = launch(dir, silent(pidFile));
        const cmd = await pidOf(pidFile);
        const holds = new RegExp(`(?:^|/)caffeinate -i -w ${supervisor}$`);
        const awake = () => run('ps', ['-A', '-o', 'command=']).stdout.split('\n').some((l) => holds.test(l.trim()));
        assert(await until(awake), `no caffeinate -i -w ${supervisor} is running`);
        assert(alive(cmd), `while the command ${cmd} runs`);
      } finally {
        reap(pidIn(pidFile), supervisor);
      }
    },
  );

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
