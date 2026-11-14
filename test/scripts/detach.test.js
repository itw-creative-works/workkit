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
  describe, test, expect, mkTmp, until, alive, pidIn, run, start,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, shellPath, jsPath, stubTool, systemPathWith, homeEnv,
} = require('../lib/platform');
const {
  CHECK_MINUTES, skipOnWindows, FROZEN_LINE, checkSettings, pidOf, reap,
  writesPid, silent, busy, ended, read, lastLine, realOf,
} = require('../lib/supervise');
const { scratchWorkflowHome } = require('../lib/workflow-home');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');
const DETACH = path.join(LIB, 'detach.js');

const detach = (...args) => run(process.execPath, [DETACH, ...args]);

/**
 * `wk_run_detached <log> <lock> [--root <root>] -- node -e <script>` in a shell
 * that sourced the seam and detach.sh, the way both callers do, after the bash
 * `before`, the bash `after` run once it returns; its last stdout lines are
 * `look=<WK_RAN_LOOK>`, `ran=<WK_RAN_CODE>` and `rc=<code>`, and the shell exits
 * with that code. Node joins PATH because the run starts through a Node supervisor.
 */
const SOURCED = [
  `. ${JSON.stringify(shellPath(path.join(LIB, 'platform.sh')))}`,
  `. ${JSON.stringify(shellPath(path.join(LIB, 'detach.sh')))}`,
];
const runDetachedArgs = (dir, script, before = ':', root = null, after = ':') => [...NO_RC, '-c', [
  ...SOURCED,
  before,
  `wk_run_detached "$1" "$2" ${root ? '--root "$4" ' : ''}-- node -e "$3"; rc=$?`,
  after,
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
  expect(res.status, `detach.js exits 0, stderr: ${res.stderr}`).toBe(0);
  return Number(res.stdout.trim());
};

// An evidence line naming <pid>: `detach:   <pid> <seconds>s <command>`.
const evidenceOf = (pid) => new RegExp(`(?:^|\\n)detach: {3}${pid} [0-9.]+s \\S`);
const LOOK_LINE = /^detach: the run goes on; read (.+), then run workkit watch to keep waiting or workkit watch --end to end it \(exit 125\)$/m;
const BAD_VALUE_LINE = /^detach: tests\.check must be a number of minutes above 0 \(got (.+)\)$/m;

const REQUEST_LINE = 'detach: the run was ended on request (exit 143)';
// A pid that still runs: a zombie waiting on a stopped parent is gone.
const running = (pid) => alive(pid) && !/^Z/.test(run('ps', ['-o', 'stat=', '-p', String(pid)]).stdout.trim());

describe('detach: the argument list', () => {
  test('a bad argument list: exit 2, nothing launched', () => {
    const dir = mkTmp('detach-usage-');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    const ran = path.join(dir, 'ran');
    const cmd = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, '')`];
    const bad = [[], [logFile], [logFile, done], [logFile, done, '--'], [logFile, done, ...cmd]];
    for (const args of bad) {
      const res = detach(...args);
      expect(res.status, `usage error for argv ${JSON.stringify(args)}, stderr: ${res.stderr}`).toBe(2);
    }
    expect(!fs.existsSync(ran), 'no bad list ran its command').toBeTruthy();
    expect(!fs.existsSync(done), 'no bad list wrote a done file').toBeTruthy();
  });
});

describe('detach: the command outlives its launcher', () => {
  test('a parent that launches detach.js and exits at once: the command completes, done holds its code', async () => {
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
    expect(parent.status, `detach.js exits 0, stderr: ${parent.stderr}`).toBe(0);
    expect(/^\d+\s*$/.test(parent.stdout), `detach.js prints the supervisor's pid, got: ${JSON.stringify(parent.stdout)}`).toBeTruthy();
    const pid = Number(parent.stdout.trim());
    expect(alive(pid), 'the supervisor is alive after its launcher exited').toBeTruthy();
    expect(!fs.existsSync(done), 'the command was still running when its launcher had exited').toBeTruthy();
    expect(await until(() => fs.existsSync(done)), `the done file never appeared at ${done}`).toBeTruthy();
    expect(fs.readFileSync(done, 'utf8'), "the done file holds the command's exit code").toBe('4\n');
    const text = fs.readFileSync(logFile, 'utf8');
    expect(text.includes('finished'), `the log holds the command's output, got: ${JSON.stringify(text)}`).toBeTruthy();
    expect(!text.includes('stale line'), `the log was truncated first, got: ${JSON.stringify(text)}`).toBeTruthy();
  });

  test('a shell command under the supervisor: its output reaches the log, its code the done file', async () => {
    // The suite and the CI watch are both shell commands, and on Windows a
    // shell child writes nothing to a log the supervisor opened append-only.
    const dir = mkTmp('detach-shell-');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    const res = detach(logFile, done, '--', BASH, ...NO_RC, '-c', 'echo from-the-shell; echo to-stderr >&2; exit 3');
    expect(res.status, `detach.js exits 0, stderr: ${res.stderr}`).toBe(0);
    expect(await until(() => fs.existsSync(done)), `the done file never appeared at ${done}`).toBeTruthy();
    expect(fs.readFileSync(done, 'utf8'), "the done file holds the shell's exit code").toBe('3\n');
    const text = fs.readFileSync(logFile, 'utf8');
    expect(text.includes('from-the-shell'), `the log holds the shell's stdout, got: ${JSON.stringify(text)}`).toBeTruthy();
    expect(text.includes('to-stderr'), `the log holds the shell's stderr, got: ${JSON.stringify(text)}`).toBeTruthy();
  });
});

describe('detach.sh: wk_run_detached and its lock', () => {
  test('a lock whose pid was rewritten mid-run: the command\'s own code comes back and the lock stays', async () => {
    // The lock taken over by a newer run while this one still ran: the pid in it
    // is no longer this run's, so the lock is no longer this run's to drop.
    const dir = mkTmp('detach-owner-');
    const lock = path.join(dir, 'lock');
    const go = path.join(dir, 'go');
    const script = `const fs=require('fs');setInterval(()=>{if(fs.existsSync(${jsPath(go)}))process.exit(7)},50)`;
    const runner = start(BASH, runDetachedArgs(dir, script), { env: RUN_ENV });
    try {
      const pidFile = path.join(lock, 'pid');
      expect(await until(() => pidIn(pidFile) > 0),
        `the run wrote its pid into the lock, stderr: ${runner.stderr()}`).toBeTruthy();
      fs.writeFileSync(pidFile, `${process.pid}\n`);
      fs.writeFileSync(go, '');
      expect(await until(() => runner.child.exitCode !== null), `the run never returned, stdout: ${runner.stdout()}`).toBeTruthy();
      await runner.done;
      const out = runner.stdout();
      expect(rcOf(out), `the command's own code, stdout: ${JSON.stringify(out)}, stderr: ${runner.stderr()}`).toBe(7);
      expect(fs.existsSync(lock), 'the lock the newer pid holds is still there').toBeTruthy();
    } finally {
      await runner.end('SIGKILL');
    }
  });

  test('a lock holding a done file and a gone pid is taken over: the command runs and its code comes back', () => {
    // A finished run whose foreground never came to collect it.
    const dir = mkTmp('detach-done-');
    const lock = path.join(dir, 'lock');
    const ran = path.join(dir, 'ran');
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    expect(!alive(dead), `the stale pid ${dead} is gone`).toBeTruthy();
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'pid'), `${dead}\n`);
    fs.writeFileSync(path.join(lock, 'done'), '0\n');
    const script = `require('fs').writeFileSync(${jsPath(ran)},'');process.exit(6)`;
    const res = run(BASH, runDetachedArgs(dir, script), { env: RUN_ENV });
    expect(rcOf(res.stdout || ''), `the command's code, stdout: ${JSON.stringify(res.stdout)}, stderr: ${res.stderr}`).toBe(6);
    expect(fs.existsSync(ran), 'the command ran').toBeTruthy();
  });

  test('a run that starts on the lock the moment an earlier run\'s done file appears: each gets its own code', async () => {
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
        expect(await until(() => fs.existsSync(path.join(lock, 'pid'))), `round ${round}: run A took the lock`).toBeTruthy();
        expect(await until(() => fs.existsSync(spinning)), `round ${round}: run B is spinning on the done file`).toBeTruthy();
        fs.writeFileSync(go, '');
        expect(await until(() => first.child.exitCode !== null && second.child.exitCode !== null),
          `round ${round}: both runs returned`).toBeTruthy();
        await Promise.all([first.done, second.done]);
        expect(rcOf(first.stdout()), `round ${round}: run A's own code, stdout: ${JSON.stringify(first.stdout())}, stderr: ${first.stderr()}`).toBe(0);
        expect(rcOf(second.stdout()), `round ${round}: run B's own code, stdout: ${JSON.stringify(second.stdout())}, stderr: ${second.stderr()}`).toBe(5);
      } finally {
        await Promise.all([first.end('SIGKILL'), second.end('SIGKILL')]);
      }
    }
  });

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    test(`a ${signal} after the call took the lock and before its supervisor started: exit ${code}, no lock left, and a second run takes it with its own code`, {
      skip: IS_WINDOWS && 'Windows delivers no INT to one process',
    }, async () => {
      // A wk_node that never returns holds the first call in that window; the
      // signal goes to its whole group, as a terminal's does.
      const dir = mkTmp('detach-window-');
      const lock = path.join(dir, 'lock');
      const held = path.join(dir, 'held');
      const env = { ...machineEnv(), ...RUN_ENV };
      const hold = `wk_node() { : > ${JSON.stringify(shellPath(held))}; sleep 60; }`;
      const first = start(BASH, runDetachedArgs(dir, 'process.exit(0)', hold, rootWith(10)), { env, detached: true });
      try {
        expect(await until(() => fs.existsSync(held)), `the first call never reached its wk_node, output: ${first.output()}`).toBeTruthy();
        process.kill(-first.pid, signal);
        expect(await until(() => ended(first.child)), `the first call never ended after the ${signal}, output: ${first.output()}`).toBeTruthy();
        expect(first.child.exitCode, `the call exits ${code}, output: ${first.output()}`).toBe(code);
        expect(!fs.existsSync(lock), 'the call removed the lock it took').toBeTruthy();
        const second = run(BASH, runDetachedArgs(dir, 'process.exit(4)'), { env });
        expect(rcOf(second.stdout || ''), `the second run's own code, stdout: ${JSON.stringify(second.stdout)}, stderr: ${second.stderr}`).toBe(4);
      } finally {
        await first.end('SIGKILL');
      }
    });
  }

  test('the caller\'s own INT, TERM and HUP traps are back after wk_run_detached returns, from a run and from a start that failed', () => {
    const traps = "trap 'echo caller-int' INT; trap 'echo caller-term' TERM; trap 'echo caller-hup' HUP";
    const wanted = ["trap -- 'echo caller-int' SIGINT", "trap -- 'echo caller-term' SIGTERM", "trap -- 'echo caller-hup' SIGHUP"];
    const failedStart = `${traps}; wk_node() { return 1; }`;
    for (const [name, before, root] of [['a run', traps, null], ['a failed start', failedStart, rootWith(10)]]) {
      const res = run(BASH, runDetachedArgs(mkTmp('detach-traps-'), 'process.exit(0)', before, root, 'trap -p INT TERM HUP'), { env: RUN_ENV });
      const said = (res.stdout || '').split('\n');
      const lost = wanted.filter((line) => !said.includes(line));
      expect(lost.join(', '), `${name}: every caller trap is back, stdout: ${JSON.stringify(res.stdout)}, stderr: ${res.stderr}`).toBe('');
    }
  });

  test('WK_RAN_CODE: the command\'s code after it ran, empty when the runner could not start', () => {
    const dir = mkTmp('detach-ran-');
    const ran = run(BASH, runDetachedArgs(dir, 'process.exit(7)'), { env: RUN_ENV });
    expect(rcOf(ran.stdout || ''), `the command's code comes back, stdout: ${JSON.stringify(ran.stdout)}, stderr: ${ran.stderr}`).toBe(7);
    expect(ranOf(ran.stdout || ''), `WK_RAN_CODE holds it, stdout: ${JSON.stringify(ran.stdout)}`).toBe('7');

    // A node ahead of the real one that fails, so the Node supervisor never
    // runs; WK_RAN_CODE starts stale, so empty means the call reset it.
    const bin = path.join(mkTmp('detach-nonode-'), 'bin');
    fs.mkdirSync(bin);
    stubTool(bin, 'node', ['#!/bin/bash', 'exit 1']);
    const failed = run(BASH, runDetachedArgs(mkTmp('detach-ran-'), 'process.exit(7)', 'WK_RAN_CODE=7'),
      { env: { PATH: systemPathWith(bin, NODE_DIR) } });
    expect(rcOf(failed.stdout || ''), `the runner's 1, stdout: ${JSON.stringify(failed.stdout)}, stderr: ${failed.stderr}`).toBe(1);
    expect(ranOf(failed.stdout || ''), `WK_RAN_CODE is empty, stdout: ${JSON.stringify(failed.stdout)}`).toBe('');
  });

  test('a run that asks for a look: the evidence and the look\'s last line, 125 with WK_RAN_LOOK 1, the lock held, the run alive', { skip: skipOnWindows() }, () => {
    const dir = mkTmp('detach-look-sh-');
    const pidFile = path.join(dir, 'cmd.pid');
    const lockPid = path.join(dir, 'lock', 'pid');
    try {
      const res = run(BASH, runDetachedArgs(dir, busy(pidFile), ':', rootWith(CHECK_MINUTES)),
        { env: { ...machineEnv(), ...RUN_ENV } });
      const out = res.stdout || '';
      expect(rcOf(out), `the look's code, stdout: ${JSON.stringify(out)}, stderr: ${res.stderr}`).toBe(125);
      expect(lookOf(out), `WK_RAN_LOOK is 1, stdout: ${JSON.stringify(out)}`).toBe('1');
      const cmd = pidIn(pidFile);
      expect(evidenceOf(cmd).test(res.output), `the evidence names the command ${cmd}, got: ${res.output}`).toBeTruthy();
      const said = LOOK_LINE.exec(res.output);
      expect(said, `the look's last line, got: ${res.output}`).toBeTruthy();
      expect(realOf(said[1]), `the line names the log, got: ${said[0]}`).toBe(realOf(path.join(dir, 'log')));
      const holder = pidIn(lockPid);
      expect(holder > 0 && alive(holder), `the lock is still held by a live supervisor, pid: ${holder}`).toBeTruthy();
      expect(cmd > 0 && alive(cmd), `the run ${cmd} still lives`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), pidIn(lockPid));
    }
  });

  test('two calls attached to one run: when the command exits 5, both return 5', async () => {
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
      expect(await until(() => fs.existsSync(marker)), `the second call never started, stderr: ${second.stderr()}`).toBeTruthy();
      fs.writeFileSync(go, '');
      expect(await until(() => first.child.exitCode !== null && second.child.exitCode !== null), 'both calls returned').toBeTruthy();
      await Promise.all([first.done, second.done]);
      expect(rcOf(first.stdout()), `the starting call's code, stdout: ${JSON.stringify(first.stdout())}, stderr: ${first.stderr()}`).toBe(5);
      expect(rcOf(second.stdout()), `the attached call's code, stdout: ${JSON.stringify(second.stdout())}, stderr: ${second.stderr()}`).toBe(5);
    } finally {
      reap(pidIn(lockPid));
      await Promise.all([first.end('SIGKILL'), second && second.end('SIGKILL')]);
    }
  });
});

describe('detach: a run with no output and no processor use is ended', () => {
  test('a command that waits in silence: the evidence, then the frozen line, done 124, the command gone', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('detach-frozen-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, silent(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      expect(await until(() => FROZEN_LINE.test(lastLine(read(logFile)))),
        `the log never ended with the frozen line, got: ${JSON.stringify(read(logFile))}`).toBeTruthy();
      expect(evidenceOf(cmd).test(read(logFile)), `the log holds an evidence line for ${cmd}, got: ${JSON.stringify(read(logFile))}`).toBeTruthy();
      expect(await until(() => read(done) !== ''), `the done file never appeared at ${done}`).toBeTruthy();
      expect(read(done), 'the done file holds 124').toBe('124\n');
      expect(await until(() => !alive(cmd)), `the command ${cmd} is gone`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  test('a frozen command\'s child in its own session is gone too', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('detach-session-');
    const pidFile = path.join(dir, 'cmd.pid');
    const childFile = path.join(dir, 'child.pid');
    let supervisor;
    try {
      supervisor = launch(dir, parentOf(pidFile, silent(childFile), true), { root: rootWith(CHECK_MINUTES) });
      await pidOf(pidFile);
      const child = await pidOf(childFile);
      expect(await until(() => !alive(child)), `the child ${child} in its own session outlived the run`).toBeTruthy();
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
    }
  });

  test('a frozen command\'s child that ignores the terminate signal is gone after the forced end', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('detach-ignores-');
    const pidFile = path.join(dir, 'cmd.pid');
    const childFile = path.join(dir, 'child.pid');
    let supervisor;
    try {
      supervisor = launch(dir, parentOf(pidFile, ignoresTerm(childFile), false), { root: rootWith(CHECK_MINUTES) });
      await pidOf(pidFile);
      const child = await pidOf(childFile);
      expect(await until(() => !alive(child)), `the child ${child} that ignores the terminate signal outlived the run`).toBeTruthy();
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
    }
  });

  test('a busy run made of short-lived children, nothing written: still running after four checks, no frozen line', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('detach-short-');
    const pidFile = path.join(dir, 'cmd.pid');
    const logFile = path.join(dir, 'log');
    let supervisor;
    try {
      supervisor = launch(dir, shortBusyChildren(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      const fourChecks = CHECK_MINUTES * 60000 * 4;
      const ended = () => !alive(cmd) || read(logFile).split('\n').some((l) => FROZEN_LINE.test(l));
      expect(!(await until(ended, fourChecks)), `the run was ended, log: ${JSON.stringify(read(logFile))}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });
});

describe('detach: a run with work and no output asks for a look', () => {
  test('a silent command that keeps a processor busy: after six checks the look file holds its evidence, and it still runs', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('detach-look-');
    const pidFile = path.join(dir, 'cmd.pid');
    const look = path.join(dir, 'look');
    let supervisor;
    try {
      supervisor = launch(dir, busy(pidFile), { root: rootWith(CHECK_MINUTES) });
      const cmd = await pidOf(pidFile);
      expect(await until(() => evidenceOf(cmd).test(read(look))), `the look file never held ${cmd}'s evidence, got: ${JSON.stringify(read(look))}`).toBeTruthy();
      expect(alive(cmd), `the command ${cmd} still runs`).toBeTruthy();
      expect(!fs.existsSync(path.join(dir, 'done')), 'and the run has no done file').toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  test('a command that writes to its log at every check and runs past six checks: its own code, no look file', async () => {
    const dir = mkTmp('detach-ticks-');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, TICKS, { root: rootWith(CHECK_MINUTES) });
      expect(await until(() => read(done) !== ''), `the done file never appeared at ${done}`).toBeTruthy();
      expect(read(done), 'the done file holds the command\'s own code').toBe('3\n');
      expect(!fs.existsSync(path.join(dir, 'look')), 'no look was asked').toBeTruthy();
    } finally {
      reap(supervisor);
    }
  });
});

describe('detach: an end request', () => {
  test('an end file beside the done file: the command is gone, the log ends with the request line, done holds 143', async () => {
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
      expect(await until(() => !alive(cmd)), `the command ${cmd} outlived the request`).toBeTruthy();
      expect(await until(() => read(done) !== ''), `the done file never appeared at ${done}`).toBeTruthy();
      expect(read(done), 'the done file holds 143').toBe('143\n');
      expect(lastLine(read(logFile)), 'the log ends with the request line').toBe(REQUEST_LINE);
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });

  test('an end file while the process read fails: the failed end line, no done file, the end file gone, the command still runs', {
    skip: process.platform !== 'darwin' && 'the process read is ps on macOS alone: Linux reads /proc, Windows reads nothing',
  }, async () => {
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
      expect(await until(() => failed.test(read(logFile))), `the log never held the failed end line, got: ${JSON.stringify(read(logFile))}`).toBeTruthy();
      expect(await until(() => !fs.existsSync(end)), 'the end file was removed').toBeTruthy();
      expect(!(await until(() => fs.existsSync(path.join(dir, 'done')), 500)), 'no done file was written').toBeTruthy();
      expect(alive(cmd), `the command ${cmd} still runs`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });
});

describe('detach.sh: an INT to the attached call ends the whole run', () => {
  // Each run checks far less often than the case lasts, so only the INT ends it.
  test('a command with a child in its own session: both gone, the log ends with the request line, the lock gone, exit 130', {
    skip: IS_WINDOWS && 'Windows delivers no INT to one process',
  }, async () => {
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
      expect(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`).toBeTruthy();
      await runner.done;
      expect(runner.child.exitCode, `the call exits 130, output: ${runner.output()}`).toBe(130);
      expect(await until(() => !alive(cmd)), `the command ${cmd} outlived the INT`).toBeTruthy();
      expect(await until(() => !alive(child)), `the child ${child} in its own session outlived the INT`).toBeTruthy();
      expect(lastLine(read(path.join(dir, 'log'))), 'the log ends with the request line').toBe(REQUEST_LINE);
      expect(!fs.existsSync(lock), 'the lock is gone').toBeTruthy();
    } finally {
      reap(pidIn(childFile), pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  test('a call that attaches to the run once the INT\'d call has left: it returns 143', {
    skip: IS_WINDOWS && 'Windows delivers no INT to one process',
  }, async () => {
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
      expect(await until(() => ended(first.child)), `the first call never returned, output: ${first.output()}`).toBeTruthy();
      await first.done;
      expect(!fs.existsSync(lock), 'the first call dropped the lock').toBeTruthy();
      const later = run(BASH, attachArgs(dir, supervisor, path.join(dir, 'attached')), { env });
      expect(rcOf(later.stdout || ''), `the later call's code, stdout: ${JSON.stringify(later.stdout)}, stderr: ${later.stderr}`).toBe(143);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await first.end('SIGKILL');
    }
  });

  test('a supervisor that does not answer the end request: once the wait runs out the command is gone, exit 130', {
    skip: IS_WINDOWS && 'Windows delivers no INT to one process',
  }, async () => {
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
      expect(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`).toBeTruthy();
      await runner.done;
      expect(runner.child.exitCode, `the call exits 130, output: ${runner.output()}`).toBe(130);
      expect(await until(() => !running(cmd)), `the command ${cmd} outlived the INT`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  test('a supervisor that does not answer, and an end of its tree that fails: exit 130, the lock kept with the supervisor\'s pid', {
    skip: IS_WINDOWS && 'Windows delivers no INT to one process',
  }, async () => {
    const dir = mkTmp('detach-int-endfails-');
    const pidFile = path.join(dir, 'cmd.pid');
    const lockPid = path.join(dir, 'lock', 'pid');
    const runner = start(BASH, runDetachedArgs(dir, silent(pidFile), 'WK_END_WAIT=1; wk_end_run() { return 1; }', rootWith(10)),
      { env: { ...machineEnv(), ...RUN_ENV } });
    let supervisor;
    try {
      supervisor = await pidOf(lockPid);
      await pidOf(pidFile);
      process.kill(supervisor, 'SIGSTOP');
      process.kill(runner.pid, 'SIGINT');
      expect(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`).toBeTruthy();
      await runner.done;
      expect(runner.child.exitCode, `the call exits 130, output: ${runner.output()}`).toBe(130);
      expect(pidIn(lockPid), 'the lock is kept, still holding the supervisor').toBe(supervisor);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });

  test('a supervisor gone with no done file: the call exits 130 with the wait not run out', {
    skip: IS_WINDOWS && 'Windows delivers no INT to one process',
  }, async () => {
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
      expect(await until(() => !alive(supervisor)), `the supervisor ${supervisor} outlived its forced end`).toBeTruthy();
      process.kill(runner.pid, 'SIGINT');
      expect(await until(() => ended(runner.child)), `the call never returned after the INT, output: ${runner.output()}`).toBeTruthy();
      await runner.done;
      expect(runner.child.exitCode, `the call exits 130, output: ${runner.output()}`).toBe(130);
    } finally {
      reap(pidIn(pidFile), supervisor);
      await runner.end('SIGKILL');
    }
  });
});

describe('detach: the checks and their setting', () => {
  test('no --root: a command that waits in silence runs to its own code, though the machine and the folder set a short check', async () => {
    const dir = mkTmp('detach-noroot-');
    const done = path.join(dir, 'done');
    const short = checkSettings(0.01);
    const script = 'setTimeout(() => process.exit(5), 4000);';
    let supervisor;
    try {
      supervisor = launch(dir, script, { env: machineEnv(short), cwd: rootWith(0.01) });
      expect(await until(() => read(done) !== ''), `the done file never appeared at ${done}`).toBeTruthy();
      expect(read(done), 'the done file holds the command\'s own code').toBe('5\n');
    } finally {
      reap(supervisor);
    }
  });

  test('a ps that fails: the could-not-read line, and a silent command runs on to its own code', {
    skip: process.platform !== 'darwin' && 'the process read is ps on macOS alone: Linux reads /proc, Windows reads nothing',
  }, async () => {
    const dir = mkTmp('detach-nops-');
    const env = failingPsEnv(dir);
    const logFile = path.join(dir, 'log');
    const done = path.join(dir, 'done');
    let supervisor;
    try {
      supervisor = launch(dir, 'setTimeout(() => process.exit(6), 4000);', { root: rootWith(CHECK_MINUTES), env });
      expect(await until(() => read(done) !== ''), `the done file never appeared at ${done}`).toBeTruthy();
      expect(read(done), 'the done file holds the command\'s own code').toBe('6\n');
      const said = /^detach: could not read the run's processes \((.+)\), so the checks are off$/m;
      expect(said.test(read(logFile)), `the log holds the could-not-read line, got: ${JSON.stringify(read(logFile))}`).toBeTruthy();
    } finally {
      reap(supervisor);
    }
  });

  test('tests.check of 0, a negative number, an infinite number or a word: the bad value line, exit 2, nothing runs', async () => {
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
      expect(res.status, `exit 2 for ${name}, output: ${res.output}`).toBe(2);
      const said = BAD_VALUE_LINE.exec(res.output.replace(/\r/g, ''));
      expect(said, `the bad value line for ${name}, got: ${res.output}`).toBeTruthy();
      expect(said[1], `the line names the value ${name}`).toBe(shown);
    }
    expect(!(await until(() => fs.existsSync(ran), 500)), 'no bad value ran its command').toBeTruthy();
    expect(!fs.existsSync(done), 'no bad value wrote a done file').toBeTruthy();
  });
});

describe('detach: the awake hold', () => {
  test('awakeCommand: the caffeinate argument list on darwin, null on linux and win32', () => {
    const { awakeCommand } = require(DETACH);
    expect(JSON.stringify(awakeCommand(123, 'darwin')), 'darwin').toBe(JSON.stringify(['caffeinate', '-i', '-w', '123']));
    for (const platform of ['linux', 'win32']) expect(awakeCommand(123, platform), platform).toBe(null);
  });

  test('a Mac and a supervised command: a caffeinate naming the supervisor\'s pid lives while the command runs', {
    skip: process.platform !== 'darwin' && 'caffeinate is macOS only',
  }, async () => {
    const dir = mkTmp('detach-awake-');
    const pidFile = path.join(dir, 'cmd.pid');
    let supervisor;
    try {
      supervisor = launch(dir, silent(pidFile));
      const cmd = await pidOf(pidFile);
      const holds = new RegExp(`(?:^|/)caffeinate -i -w ${supervisor}$`);
      const awake = () => run('ps', ['-A', '-o', 'command=']).stdout.split('\n').some((l) => holds.test(l.trim()));
      expect(await until(awake), `no caffeinate -i -w ${supervisor} is running`).toBeTruthy();
      expect(alive(cmd), `while the command ${cmd} runs`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile), supervisor);
    }
  });
});
