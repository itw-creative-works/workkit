// Tests for `workkit watch [--end] [suite|run|<pid>]`: the call attaches to the repo's
// live run, the suite's before the supervised one, or the narrowed run its pid names,
// prints the log's last 20 lines and follows it to the run's code; a run that ended
// with no call attached still gives its code once; with no live run it says so;
// `--end` ends the named run on request; a narrowed run's start clears this repo's
// day-old leftover slots. The world is test/lib/supervise-world.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, run, start,
} = require('../lib/harness');
const {
  BASH, NO_RC, IS_WINDOWS, jsPath, shellPath, cygpathStub, joinPath,
} = require('../lib/platform');
const { runLib } = require('../lib/hook-lib');
const { skipWithoutWrapper, wiredNpmEnv } = require('../lib/script-shell');
const { suiteLockPath } = require('../lib/suite-record');
const {
  CHECK_MINUTES, skipOnWindows, pidOf, reap, silent, writesPid, ended, read, realOf,
} = require('../lib/supervise');
const {
  LONG_CHECK, mkWorld, runLog, suiteLog, workkitStart, workkit, linesToLast, waitsFor,
} = require('../lib/supervise-world');

const USAGE = 'usage: workkit watch [--end] [suite|run|<pid>]';
const REQUEST_LINE = 'detach: the run was ended on request (exit 143)';
const TWO_LIVE = 'watch: two runs are live; name one: workkit watch --end suite, or workkit watch --end run';
const NO_RUN = /^watch: no run is live in (.+)$/m;

const superviseStart = (world, script, env = world.env) => workkitStart(['supervise', '--', 'node', '-e', script], { cwd: world.repo, env });

// Busy and silent, so the run asks for a look, until <go> exists; then it exits <code>.
const busyUntil = (pidFile, go, code) => `${writesPid(pidFile)}\nconst fs = require('fs');\nfor (;;) if (fs.existsSync(${jsPath(go)})) process.exit(${code});`;

// The supervised run's lock folder: the suite lock's per-repo recipe, under the run lock's name.
const runLock = (w) => {
  const suite = suiteLockPath(w.workflowHome, w.repo);
  return path.join(path.dirname(path.dirname(suite)), 'claude-run-lock', path.basename(suite));
};

/** A supervised run that asked for a look, then ended with 3 while no call was attached to it. */
const lookedThenEnded = async (w, pidFile) => {
  const go = path.join(w.out, 'go');
  const res = await workkit(['supervise', '--', 'node', '-e', busyUntil(pidFile, go, 3)], { cwd: w.repo, env: w.env });
  expect(res.code, `the run asked for a look, got: ${res.output}`).toBe(125);
  fs.writeFileSync(go, '');
  expect(await until(() => read(path.join(runLock(w), 'done')) !== ''), `the run never ended; its log: ${JSON.stringify(read(runLog(w)))}`).toBeTruthy();
};

/**
 * A world whose `npm test -- <name>` runs narrowed.js: it leaves its pid in
 * `<name>.pid`, writes `narrowed-marker`, then works in silence, so the run asks
 * for a look, until `<name>.go` exists; then it exits 3. A bare `npm test` is the
 * suite: `suite.pid`, a `suite-tick` line a quarter check apart, exit 6 on `suite.go`.
 * The env npm runs under, and each run's pid and go files by name. <check> sets
 * the check length, the short one unless a case needs no look.
 */
const narrowedWorld = ({ check = CHECK_MINUTES } = {}) => {
  const w = mkWorld({
    check,
    files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node narrowed.js' } })}\n` },
  });
  fs.writeFileSync(path.join(w.repo, 'narrowed.js'), [
    "const fs = require('fs');",
    "const name = process.argv[2] || 'suite';",
    `const at = (ext) => ${jsPath(w.out)} + '/' + name + ext;`,
    "fs.writeFileSync(at('.pid'), String(process.pid));",
    "if (!process.argv[2]) setInterval(() => { console.log('suite-tick'); if (fs.existsSync(at('.go'))) process.exit(6); }, 300);",
    "else { fs.writeSync(1, 'narrowed-marker\\n'); for (;;) if (fs.existsSync(at('.go'))) process.exit(3); }",
  ].join('\n'));
  return {
    w, env: wiredNpmEnv(w), pidFile: (name) => path.join(w.out, `${name}.pid`), go: (name) => path.join(w.out, `${name}.go`),
  };
};

/** `npm test -- <name>` in a narrowedWorld, started and not waited on. */
const narrowedCall = ({ w, env }, name) => start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test', '--', name],
  { cwd: w.repo, env, detached: true });

/** `npm test -- <name>` in a narrowedWorld, run until its look ends the call: the pid its look line names. */
const lookedNarrowed = async (world, name) => {
  const call = narrowedCall(world, name);
  try {
    const { status } = await call.done;
    expect(status, `the narrowed run ${name} asked for a look, got: ${call.output()}`).toBe(125);
    const said = /workkit watch (\d+)/.exec(call.output());
    expect(said, `the look line names the watch call with a pid, got: ${call.output()}`).toBeTruthy();
    return said[1];
  } finally {
    await call.end('SIGKILL');
  }
};

/** The slot of the narrowed run whose look named <pid>: its log and its lock folder, from the suite library's own paths. */
const slotOf = ({ w, env }, pid) => {
  const root = run('git', ['rev-parse', '--show-toplevel'], { cwd: w.repo }).stdout.trim();
  const res = runLib(`wk_test_log_path "${root}" ${pid} && wk_test_lock_path "${root}" ${pid}`,
    { ...env, WORKKIT_NODE: shellPath(process.execPath) });
  const [log, lock] = res.stdout.trim().split('\n');
  expect(res.code === 0 && log && lock, `the slot of run ${pid}, got: ${res.stdout} ${res.stderr}`).toBeTruthy();
  return { log, lock };
};

/**
 * The suite lock and the run lock of <w>'s repo from the suite library's own paths,
 * under <env>: the shell's spelling, which a run writes in a `foreground` file.
 */
const lockPaths = (w, env = w.env) => {
  const root = run('git', ['rev-parse', '--show-toplevel'], { cwd: w.repo }).stdout.trim();
  const res = runLib(`wk_suite_lock_path "${root}" && wk_run_lock_path "${root}"`, { ...env, WORKKIT_NODE: shellPath(process.execPath) });
  const [suite, runLock] = res.stdout.trim().split('\n');
  expect(res.code === 0 && suite && runLock, `the repo's two locks, got: ${res.stdout} ${res.stderr}`).toBeTruthy();
  return { suite, run: runLock };
};

/** The same two locks as Node opens them, where a planted lock goes on every platform. */
const lockFolders = (w) => ({ suite: suiteLockPath(w.workflowHome, w.repo), run: runLock(w) });

/** Plant <lock> as a run held in the foreground leaves it: a live pid, and the enclosing run's lock. */
const plantForeground = (lock, enclosing) => {
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`);
  fs.writeFileSync(path.join(lock, 'foreground'), `${enclosing}\n`);
};

/** Narrowed runs <names>, each left by a look and then let end with no call attached: their slots, each holding its done file. */
const finishedNarrowed = async (world, names) => {
  const pids = await Promise.all(names.map((name) => lookedNarrowed(world, name)));
  for (const name of names) fs.writeFileSync(world.go(name), '');
  const slots = pids.map((pid) => slotOf(world, pid));
  for (const { lock } of slots) expect(await until(() => fs.existsSync(path.join(lock, 'done'))), `the run never ended: no done file in ${lock}`).toBeTruthy();
  return slots;
};

/** A slot's log, lock folder and every file in it, last modified <ms> ago. */
const age = ({ log, lock }, ms) => {
  const then = new Date(Date.now() - ms);
  for (const file of [log, lock, ...fs.readdirSync(lock).map((name) => path.join(lock, name))]) fs.utimesSync(file, then, then);
};

const HOUR = 60 * 60 * 1000;

/** The pid of <parent>'s child whose command line names <needle>, or 0 while there is none. */
const childPid = (parent, needle) => {
  const row = run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command=']).stdout.split('\n').map((line) => line.trim().split(/\s+/))
    .find(([, ppid, ...cmd]) => Number(ppid) === parent && cmd.join(' ').includes(needle));
  return row ? Number(row[0]) : 0;
};

/** End every handle a case started, whichever of them it got to. */
const endAll = (...calls) => Promise.all(calls.filter(Boolean).map((call) => call.end('SIGKILL')));

/**
 * A world whose root `npm test` runs `suite.js`, a node script that leaves its own
 * pid, prints `suite-marker` and exits 6 once its go file exists; the env every
 * call there runs under, and both runs' pid files.
 */
const bothWorld = () => {
  const w = mkWorld({ files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node suite.js' } })}\n` } });
  const suitePid = path.join(w.out, 'suite.pid');
  fs.writeFileSync(path.join(w.repo, 'suite.js'), waitsFor(suitePid, path.join(w.out, 'go-suite'), { lines: ['suite-marker'], code: 6 }));
  return { w, env: wiredNpmEnv(w), suitePid, runPid: path.join(w.out, 'cmd.pid') };
};

/**
 * Start a root `npm test` and a supervised run that prints `run-marker` and exits
 * 7 on its go file, then end the two calls that started them; both runs live on.
 * @returns {Promise<{suite: number, run: number}>} the two runs' pids
 */
const startBoth = async ({ w, env, suitePid, runPid }) => {
  const suite = start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test'], { cwd: w.repo, env, detached: true });
  let supervised;
  try {
    expect(await until(() => read(suiteLog(w)).includes('suite-marker')), `the suite never started; npm said: ${suite.output()}`).toBeTruthy();
    supervised = superviseStart(w, waitsFor(runPid, path.join(w.out, 'go-run'), { lines: ['run-marker'], code: 7 }), env);
    expect(await until(() => read(runLog(w)).includes('run-marker')), `the supervised run never started; it said: ${supervised.output()}`).toBeTruthy();
  } finally {
    await endAll(suite, supervised);
  }
  const pids = { suite: pidIn(suitePid), run: pidIn(runPid) };
  const gone = Object.entries(pids).filter(([, pid]) => !(pid > 0 && alive(pid))).map(([name, pid]) => `the ${name}'s pid ${pid}`);
  expect(gone.length === 0, `both runs outlive the calls that started them; not alive: ${gone.join(', ')}`).toBeTruthy();
  return pids;
};

/**
 * `workkit supervise -- npm test` started in a world whose root `npm test` runs
 * suite.js, which leaves its pid and waits: the suite held in the foreground
 * under the supervised run. The world, its npm env, the pid file and the call.
 */
const foregroundSuite = () => {
  const w = mkWorld({ files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node suite.js' } })}\n` } });
  const pidFile = path.join(w.out, 'suite.pid');
  fs.writeFileSync(path.join(w.repo, 'suite.js'), waitsFor(pidFile, path.join(w.out, 'go'), { lines: ['suite-marker'], code: 0 }));
  const env = wiredNpmEnv(w);
  return { w, env, pidFile, supervised: workkitStart(['supervise', '--', 'npm', 'test'], { cwd: w.repo, env }) };
};

// The skip of a case that ends the supervised run and then needs the suite gone.
const skipEndOfNpmSuite = () => (IS_WINDOWS && 'Windows: the end does not reach a suite an npm test started under the supervised run') || skipWithoutWrapper();

describe('workkit watch: attaching to the live run', () => {
  test('a live supervised run: the log\'s last 20 lines, then the run followed to its own code', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const go = path.join(w.out, 'go');
    const lines = Array.from({ length: 30 }, (_, i) => `line-${String(i + 1).padStart(2, '0')}`);
    const supervised = superviseStart(w, waitsFor(pidFile, go, { lines, after: 'after-attach', code: 5 }));
    let watch;
    try {
      expect(await until(() => read(runLog(w)).includes('line-30')), `the run never wrote its lines; it said: ${supervised.output()}`).toBeTruthy();
      // Watch attaches again once the call that started the run is gone.
      await supervised.end('SIGKILL');
      expect(alive(await pidOf(pidFile)), 'the run outlives the call that started it').toBeTruthy();
      watch = workkitStart(['watch'], { cwd: w.repo, env: w.env });
      expect(await until(() => watch.output().includes('line-30')), `watch never printed the log; it said: ${watch.output()}`).toBeTruthy();
      fs.writeFileSync(go, '');
      const { status } = await watch.done;
      const said = linesToLast(watch.output());
      expect(status, `the run's own code, got: ${watch.output()}`).toBe(5);
      const missing = lines.slice(10).filter((line) => !said.includes(line));
      expect(missing.join(', '), `the log's last 20 lines, got: ${watch.output()}`).toBe('');
      expect(!said.includes('line-10'), `and no line before them, got: ${watch.output()}`).toBeTruthy();
      expect(said.includes('after-attach'), `then what the run wrote after the attach, got: ${watch.output()}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised, watch);
    }
  });

  test('a watch attached beside the still-attached supervise call: both calls exit with the run\'s code', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const go = path.join(w.out, 'go');
    const supervised = superviseStart(w, waitsFor(pidFile, go, { lines: ['run-marker'], code: 5 }));
    let watch;
    try {
      expect(await until(() => read(runLog(w)).includes('run-marker')), `the run never started; it said: ${supervised.output()}`).toBeTruthy();
      watch = workkitStart(['watch'], { cwd: w.repo, env: w.env });
      expect(await until(() => watch.output().includes('run-marker')), `watch never printed the log; it said: ${watch.output()}`).toBeTruthy();
      fs.writeFileSync(go, '');
      const [first, second] = await Promise.all([supervised.done, watch.done]);
      expect(first.status, `the supervise call exits with the run's code, got: ${supervised.output()}`).toBe(5);
      expect(second.status, `the watch call exits with the run's code, got: ${watch.output()}`).toBe(5);
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised, watch);
    }
  });

  // Only the cases with a live suite run need npm's script shell; a narrowed
  // run that asks for a look needs both the script shell and a process read.
  test('a live suite run and a live supervised run: watch and watch suite follow the suite\'s, watch run the supervised one', { skip: skipWithoutWrapper() }, async () => {
    const both = bothWorld();
    const { w, env } = both;
    const calls = {};
    try {
      await startBoth(both);
      for (const name of ['watch', 'suite', 'run']) {
        calls[name] = workkitStart(name === 'watch' ? ['watch'] : ['watch', name], { cwd: w.repo, env });
      }
      for (const [name, marker] of [['watch', 'suite-marker'], ['suite', 'suite-marker'], ['run', 'run-marker']]) {
        expect(await until(() => calls[name].output().includes(marker)), `${name} never showed ${marker}; it said: ${calls[name].output()}`).toBeTruthy();
      }
      fs.writeFileSync(path.join(w.out, 'go-suite'), '');
      fs.writeFileSync(path.join(w.out, 'go-run'), '');
      for (const [name, code, other] of [['watch', 6, 'run-marker'], ['suite', 6, 'run-marker'], ['run', 7, 'suite-marker']]) {
        const { status } = await calls[name].done;
        expect(status, `${name} ends with its run's code, got: ${calls[name].output()}`).toBe(code);
        expect(!calls[name].output().includes(other), `${name} showed its own run's log alone, got: ${calls[name].output()}`).toBeTruthy();
      }
    } finally {
      reap(pidIn(both.suitePid), pidIn(both.runPid));
      await endAll(...Object.values(calls));
    }
  });

  test('a narrowed npm test a look left running: workkit watch <pid> from the look line follows it to its end and its code', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld();
    const { w, env } = world;
    let watch;
    try {
      const pid = await lookedNarrowed(world, 'one');
      expect(alive(await pidOf(world.pidFile('one'))), 'the narrowed run outlives the call that started it').toBeTruthy();
      watch = workkitStart(['watch', pid], { cwd: w.repo, env });
      expect(await until(() => watch.output().includes('narrowed-marker')), `watch never printed the run's log; it said: ${watch.output()}`).toBeTruthy();
      expect(!ended(watch.child), `watch is still attached while the run goes on; it said: ${watch.output()}`).toBeTruthy();
      fs.writeFileSync(world.go('one'), '');
      const followed = await watch.done;
      expect(followed.status, `watch returns the run's own code, got: ${watch.output()}`).toBe(3);
    } finally {
      reap(pidIn(world.pidFile('one')));
      await endAll(watch);
    }
  });

  test('two narrowed npm tests a look left running: workkit watch with no name exits 2, its line naming both', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld();
    const { w, env } = world;
    try {
      const pids = await Promise.all(['one', 'two'].map((name) => lookedNarrowed(world, name)));
      const res = await workkit(['watch'], { cwd: w.repo, env });
      expect(res.code, `watch with two narrowed runs and no name exits 2, got: ${res.output}`).toBe(2);
      const names = (line) => pids.every((pid) => new RegExp(`\\b${pid}\\b`).test(line));
      expect(linesToLast(res.output).some(names), `one line names both runs ${pids.join(' and ')}, got: ${res.output}`).toBeTruthy();
    } finally {
      reap(pidIn(world.pidFile('one')), pidIn(world.pidFile('two')));
    }
  });

  test('a narrowed run at its start clears a leftover slot of this repo whose done file is past a day old, and keeps an hour-old one', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld();
    try {
      const [old, recent] = await finishedNarrowed(world, ['old', 'recent']);
      age(old, 48 * HOUR);
      age(recent, HOUR);
      // Its go file first, so the new run ends at once.
      fs.writeFileSync(world.go('fresh'), '');
      const fresh = narrowedCall(world, 'fresh');
      const { status } = await fresh.done;
      expect(status, `the new narrowed run ran to its own code, got: ${fresh.output()}`).toBe(3);
      expect(!fs.existsSync(old.log) && !fs.existsSync(old.lock), `the day-old slot is gone: ${old.log}, ${old.lock}`).toBeTruthy();
      expect(fs.existsSync(recent.log) && fs.existsSync(path.join(recent.lock, 'done')), `the hour-old slot is kept: ${recent.log}, ${recent.lock}`).toBeTruthy();
    } finally {
      reap(...['old', 'recent', 'fresh'].map((name) => pidIn(world.pidFile(name))));
    }
  });
});

describe('workkit watch: no run to attach to', () => {
  test('no live run: the no-run line naming the root, exit 1', async () => {
    const w = mkWorld();
    const res = await workkit(['watch'], { cwd: w.repo, env: w.env });
    expect(res.code, `exit 1, got: ${res.output}`).toBe(1);
    const said = NO_RUN.exec(res.output);
    expect(said, `the no-run line, got: ${res.output}`).toBeTruthy();
    expect(realOf(said[1]), `the line names the repo's root, got: ${said[0]}`).toBe(realOf(w.repo));
  });

  test('a run that asked for a look and then ended with 3, no call attached: watch prints the log\'s last lines and exits 3, a second watch the no-run line', { skip: skipOnWindows() }, async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      await lookedThenEnded(w, pidFile);
      const first = await workkit(['watch'], { cwd: w.repo, env: w.env });
      expect(first.code, `the run's own code, got: ${first.output}`).toBe(3);
      expect(linesToLast(first.output).includes('supervise: exit 3'), `the log's last lines, got: ${first.output}`).toBeTruthy();
      const second = await workkit(['watch'], { cwd: w.repo, env: w.env });
      expect(second.code, `the second watch exits 1, got: ${second.output}`).toBe(1);
      expect(NO_RUN.test(second.output), `the second watch prints the no-run line, got: ${second.output}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
    }
  });

  test('a folder outside any git repo: the line that says so, exit 1', async () => {
    const w = mkWorld();
    const res = await workkit(['watch'], { cwd: mkTmp('watch-nogit-'), env: w.env });
    expect(res.code, `exit 1, got: ${res.output}`).toBe(1);
    expect(linesToLast(res.output).includes('watch: not inside a git repository'), `the line, got: ${res.output}`).toBeTruthy();
  });

  test('any other argument: the usage line, exit 2', async () => {
    const w = mkWorld();
    for (const args of [['nope'], ['--end', 'nope'], ['--stop']]) {
      const res = await workkit(['watch', ...args], { cwd: w.repo, env: w.env });
      expect(res.code, `exit 2 for [${args}], got: ${res.output}`).toBe(2);
      expect(linesToLast(res.output).includes(USAGE), `the usage line for [${args}], got: ${res.output}`).toBeTruthy();
    }
  });
});

describe('workkit watch --end', () => {
  test('a live run and watch --end: the request line, exit 0, the command is gone, the attached call exits 143, the lock dropped', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const supervised = superviseStart(w, silent(pidFile));
    try {
      const cmd = await pidOf(pidFile);
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env: w.env });
      expect(res.code, `exit 0, got: ${res.output}`).toBe(0);
      expect(linesToLast(res.output).includes(REQUEST_LINE), `the request line, got: ${res.output}`).toBeTruthy();
      expect(await until(() => !alive(cmd)), `the command ${cmd} outlived the request`).toBeTruthy();
      const { status } = await supervised.done;
      expect(status, `the still-attached supervise call gets the run's code, got: ${supervised.output()}`).toBe(143);
      const after = await workkit(['watch'], { cwd: w.repo, env: w.env });
      expect(after.code, `a watch after the end exits 1, got: ${after.output}`).toBe(1);
      expect(NO_RUN.test(after.output), `a watch after the end prints the no-run line, got: ${after.output}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised);
    }
  });

  test('a live suite run and a narrowed run a look left: watch --end with no name exits 2, names each, ends neither', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld();
    const { w, env } = world;
    const suite = start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test'], { cwd: w.repo, env, detached: true });
    try {
      expect(await until(() => read(suiteLog(w)).includes('suite-tick')), `the suite never started; npm said: ${suite.output()}`).toBeTruthy();
      const pid = await lookedNarrowed(world, 'one');
      const runs = [pidIn(world.pidFile('suite')), pidIn(world.pidFile('one'))];
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env });
      expect(res.code, `watch --end with two runs and no name exits 2, got: ${res.output}`).toBe(2);
      const said = linesToLast(res.output);
      expect(said.some((line) => /\bsuite\b/.test(line)) && said.some((line) => new RegExp(`\\b${pid}\\b`).test(line)),
        `the output names the suite and the narrowed run ${pid}, got: ${res.output}`).toBeTruthy();
      expect(!(await until(() => runs.some((each) => !alive(each)), 500)), `both runs still live after the refusal: ${runs.join(', ')}`).toBeTruthy();
    } finally {
      reap(pidIn(world.pidFile('suite')), pidIn(world.pidFile('one')));
      await endAll(suite);
    }
  });

  test('a narrowed run with its own call attached and watch --end <pid>: the call exits 143 on its closing line, the slot gone', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld({ check: LONG_CHECK });
    const { w, env } = world;
    const attached = narrowedCall(world, 'one');
    try {
      await pidOf(world.pidFile('one'));
      let wrapper = 0;
      expect(await until(() => (wrapper = childPid(attached.pid, 'script-shell')) > 0), `npm (pid ${attached.pid}) never showed a script-shell child`).toBeTruthy();
      const slot = slotOf(world, wrapper);
      expect(await until(() => fs.existsSync(slot.log) && fs.existsSync(slot.lock)), `the run's slot is there while it runs: ${slot.log}, ${slot.lock}`).toBeTruthy();
      // The attached call is held stopped while watch --end runs, so watch reads the
      // end first: the order that left the attached call no record.
      process.kill(wrapper, 'SIGSTOP');
      const res = await workkit(['watch', '--end', String(wrapper)], { cwd: w.repo, env });
      process.kill(wrapper, 'SIGCONT');
      expect(res.code, `watch --end exits 0, got: ${res.output}`).toBe(0);
      const { status } = await attached.done;
      expect(status, `the attached call gets the run's code, got: ${attached.output()}`).toBe(143);
      expect(linesToLast(attached.stdout()).includes('script-shell: exit 143'), `its closing line, got: ${attached.output()}`).toBeTruthy();
      expect(!fs.existsSync(slot.log) && !fs.existsSync(slot.lock), `the slot is gone: ${slot.log}, ${slot.lock}`).toBeTruthy();
    } finally {
      reap(pidIn(world.pidFile('one')));
      await endAll(attached);
    }
  });

  test('a finished narrowed run nobody collected beside a live suite: watch --end with no name ends the suite, never exit 2', { skip: skipOnWindows() || skipWithoutWrapper() }, async () => {
    const world = narrowedWorld();
    const { w, env } = world;
    let suite;
    try {
      await finishedNarrowed(world, ['one']);
      suite = start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test'], { cwd: w.repo, env, detached: true });
      expect(await until(() => read(suiteLog(w)).includes('suite-tick')), `the suite never started; npm said: ${suite.output()}`).toBeTruthy();
      const suitePid = await pidOf(world.pidFile('suite'));
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env });
      expect(res.code, `the finished run is no live run, so the suite alone is ended, got: ${res.output}`).toBe(0);
      expect(linesToLast(res.output).includes(REQUEST_LINE), `the request line, got: ${res.output}`).toBeTruthy();
      expect(await until(() => !alive(suitePid)), `the suite ${suitePid} outlived the request`).toBeTruthy();
    } finally {
      reap(pidIn(world.pidFile('suite')), pidIn(world.pidFile('one')));
      await endAll(suite);
    }
  });

  test('a run that asked for a look and then ended with 3, no call attached: watch --end prints the ended line with its code, exit 0, the lock dropped', { skip: skipOnWindows() }, async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      await lookedThenEnded(w, pidFile);
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env: w.env });
      expect(res.code, `exit 0, got: ${res.output}`).toBe(0);
      expect(linesToLast(res.output).includes('watch: the run ended already (exit 3)'), `the ended line, got: ${res.output}`).toBeTruthy();
      const after = await workkit(['watch'], { cwd: w.repo, env: w.env });
      expect(after.code, `a watch after the end exits 1, got: ${after.output}`).toBe(1);
      expect(NO_RUN.test(after.output), `a watch after the end prints the no-run line, got: ${after.output}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
    }
  });

  test('a suite run held in the foreground under workkit supervise: watch --end with no name ends the supervised run, never exit 2', { skip: skipEndOfNpmSuite() }, async () => {
    const { w, env, pidFile, supervised } = foregroundSuite();
    try {
      const suite = await pidOf(pidFile);
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env });
      expect(res.code, `the foreground suite is no run to choose, so the supervised one is ended, got: ${res.output}`).toBe(0);
      expect(linesToLast(res.output).includes(REQUEST_LINE), `the request line, got: ${res.output}`).toBeTruthy();
      expect(await until(() => !alive(suite)), `the suite ${suite} outlived the end`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised);
    }
  });

  test('a suite run held in the foreground under workkit supervise: watch --end suite says so, exit 1, no end file, the run goes on', { skip: skipWithoutWrapper() }, async () => {
    const { w, env, pidFile, supervised } = foregroundSuite();
    try {
      const suite = await pidOf(pidFile);
      const lock = suiteLockPath(w.workflowHome, w.repo);
      expect(fs.existsSync(path.join(lock, 'pid')), `the foreground run holds the suite lock at ${lock}`).toBeTruthy();
      const refusal = await workkit(['watch', '--end', 'suite'], { cwd: w.repo, env });
      expect(refusal.code, `exit 1, got: ${refusal.output}`).toBe(1);
      const said = linesToLast(refusal.output);
      expect(said.length === 1 && /foreground/.test(said[0]) && said[0].includes('workkit watch --end run'),
        `one line naming the foreground hold and the call that ends it, got: ${refusal.output}`).toBeTruthy();
      expect(!fs.existsSync(path.join(lock, 'end')), 'no end request was written').toBeTruthy();
      expect(alive(suite), `the suite ${suite} still runs`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised);
    }
  });

  test('a suite run held in the foreground under workkit supervise: watch --end run ends it', { skip: skipEndOfNpmSuite() }, async () => {
    const { w, env, pidFile, supervised } = foregroundSuite();
    try {
      const suite = await pidOf(pidFile);
      const res = await workkit(['watch', '--end', 'run'], { cwd: w.repo, env });
      expect(res.code, `watch --end run exits 0, got: ${res.output}`).toBe(0);
      expect(linesToLast(res.output).includes(REQUEST_LINE), `the request line, got: ${res.output}`).toBeTruthy();
      expect(await until(() => !alive(suite)), `the suite ${suite} outlived the end`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised);
    }
  });

  // Each lock is planted as its run leaves it: a live pid, and the marker naming
  // the enclosing run's lock. The line may quote the call it refuses, and names
  // no other call but the one that ends the enclosing run.
  for (const [typed, enclosing, ends] of [
    ['run', (locks) => locks.suite, 'workkit watch --end suite'],
    ['suite', (locks) => path.join(path.dirname(locks.run), 'another-run-lock'), null],
  ]) {
    test(`the ${typed} lock held in the foreground under ${ends ? 'the suite lock' : 'neither lock'}: watch --end ${typed} exits 1 on one line ${ends ? `naming ${ends}` : 'naming no other watch call'}, no end file`, async () => {
      const w = mkWorld();
      const lock = lockFolders(w)[typed];
      plantForeground(lock, enclosing(lockPaths(w)));
      const res = await workkit(['watch', '--end', typed], { cwd: w.repo, env: w.env });
      expect(res.code, `exit 1, got: ${res.output}`).toBe(1);
      const said = linesToLast(res.output);
      expect(said.length, `one line, got: ${res.output}`).toBe(1);
      if (ends) expect(said[0].includes(ends), `the line names ${ends}, got: ${res.output}`).toBeTruthy();
      const others = (said[0].match(/workkit watch --end \w+/g) || []).filter((call) => call !== ends && call !== `workkit watch --end ${typed}`);
      expect(others.join(', '), `the line names no call that leaves the run going, got: ${res.output}`).toBe('');
      expect(!fs.existsSync(path.join(lock, 'end')), 'no end request was written').toBeTruthy();
    });
  }

  // On Windows a run writes the enclosing lock in another spelling of the folder
  // watch computes. An inherited OSTYPE and the seam's cygpath give that second
  // spelling off Windows; there the real cygpath gives it.
  for (const [typed, enclosing] of [['suite', 'run'], ['run', 'suite']]) {
    test(`the ${typed} lock held in the foreground under the ${enclosing} lock spelled another way: watch --end ${typed} exits 1 on one line naming the foreground hold and workkit watch --end ${enclosing}, no end file`, async () => {
      const w = mkWorld();
      const cyg = mkTmp('watch-cygpath-');
      cygpathStub(cyg);
      const env = { ...w.env, OSTYPE: 'msys', PATH: joinPath(cyg, w.env.PATH) };
      const enclosingShell = lockPaths(w, env)[enclosing];
      const spelled = runLib(`wk_native_path "${enclosingShell}"`, env).stdout;
      expect(spelled && spelled !== enclosingShell, `a second spelling of ${enclosingShell}, got: ${spelled}`).toBeTruthy();
      const lock = lockFolders(w)[typed];
      plantForeground(lock, spelled);
      const res = await workkit(['watch', '--end', typed], { cwd: w.repo, env });
      expect(res.code, `exit 1, got: ${res.output}`).toBe(1);
      const said = linesToLast(res.output);
      expect(said.length === 1 && /foreground/.test(said[0]) && said[0].includes(`workkit watch --end ${enclosing}`),
        `one line naming the foreground hold and workkit watch --end ${enclosing}, got: ${res.output}`).toBeTruthy();
      expect(!fs.existsSync(path.join(lock, 'end')), 'no end request was written').toBeTruthy();
    });
  }

  test('two live runs: watch --end with no name is refused, exit 2, both live; watch --end run ends the supervised one alone', { skip: skipWithoutWrapper() }, async () => {
    const both = bothWorld();
    const { w, env } = both;
    try {
      const { suite, run } = await startBoth(both);
      const refused = await workkit(['watch', '--end'], { cwd: w.repo, env });
      expect(refused.code, `the refusal's code, got: ${refused.output}`).toBe(2);
      expect(linesToLast(refused.output).includes(TWO_LIVE), `the refusal line, got: ${refused.output}`).toBeTruthy();
      expect(!(await until(() => !alive(suite) || !alive(run), 500)), 'both runs still live after the refusal').toBeTruthy();
      const ended = await workkit(['watch', '--end', 'run'], { cwd: w.repo, env });
      expect(ended.code, `exit 0, got: ${ended.output}`).toBe(0);
      expect(linesToLast(ended.output).includes(REQUEST_LINE), `the request line, got: ${ended.output}`).toBeTruthy();
      expect(await until(() => !alive(run)), `the supervised command ${run} outlived the request`).toBeTruthy();
      expect(alive(suite), `the suite ${suite} still runs`).toBeTruthy();
    } finally {
      reap(pidIn(both.suitePid), pidIn(both.runPid));
    }
  });
});
