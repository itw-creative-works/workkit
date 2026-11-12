// Tests for `workkit watch [--end] [suite|run]`: the call attaches to the repo's
// live run, the suite's before the supervised one, prints the log's last 20 lines
// and follows it to the run's code; a run that ended with no call attached still
// gives its code once; with no live run it says so; `--end` ends the named run on
// request. The world is test/lib/supervise-world.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun, mkTmp, until, alive, start,
} = require('../lib/harness');
const { BASH, NO_RC, shellPath } = require('../lib/platform');
const { wrapperMissing, wiredNpmEnv } = require('../lib/script-shell');
const { suiteLockPath } = require('../lib/suite-record');
const {
  CHECK_MINUTES, processTest, pidIn, pidOf, reap, silent, jsPath, writesPid, read, realOf,
} = require('../lib/supervise');
const {
  mkWorld, runLog, suiteLog, workkitStart, workkit, linesOf, waitsFor,
} = require('../lib/supervise-world');

const USAGE = 'usage: workkit watch [--end] [suite|run]';
const REQUEST_LINE = 'detach: the run was ended on request (exit 143)';
const TWO_LIVE = 'watch: two runs are live; name one: workkit watch --end suite, or workkit watch --end run';
const NO_RUN = /^watch: no run is live in (.+)$/m;

// A root test script that leaves its pid, announces itself, and exits 6 once its go file exists.
const SUITE = 'echo $$ > "$WK_OUT/suite.pid"; echo suite-marker; while [ ! -e "$WK_OUT/go-suite" ]; do sleep 0.1; done; exit 6';

// Only the cases with a live suite run need npm's script shell.
const suiteTest = testUnless(Boolean(wrapperMissing()), wrapperMissing());

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
  assertEq(res.code, 125, `the run asked for a look, got: ${res.output}`);
  fs.writeFileSync(go, '');
  assert(await until(() => read(path.join(runLock(w), 'done')) !== ''), `the run never ended; its log: ${JSON.stringify(read(runLog(w)))}`);
};

/** End every handle a case started, whichever of them it got to. */
const endAll = (...calls) => Promise.all(calls.filter(Boolean).map((call) => call.end('SIGKILL')));

/** A world whose root `npm test` is SUITE, the env every call there runs under, and both runs' pid files. */
const bothWorld = () => {
  const w = mkWorld({ files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: SUITE } })}\n` } });
  return {
    w,
    env: { ...wiredNpmEnv(w), WK_OUT: shellPath(w.out) },
    suitePid: path.join(w.out, 'suite.pid'),
    runPid: path.join(w.out, 'cmd.pid'),
  };
};

/**
 * Start a root `npm test` and a supervised run that prints `run-marker` and exits
 * 7 on its go file, then end the two calls that started them; both runs live on.
 */
const startBoth = async ({ w, env, suitePid, runPid }) => {
  const suite = start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test'], { cwd: w.repo, env, detached: true });
  let supervised;
  try {
    assert(await until(() => read(suiteLog(w)).includes('suite-marker')), `the suite never started; npm said: ${suite.output()}`);
    supervised = superviseStart(w, waitsFor(runPid, path.join(w.out, 'go-run'), { lines: ['run-marker'], code: 7 }), env);
    assert(await until(() => read(runLog(w)).includes('run-marker')), `the supervised run never started; it said: ${supervised.output()}`);
  } finally {
    await endAll(suite, supervised);
  }
  assert(alive(pidIn(suitePid)) && alive(pidIn(runPid)), 'both runs outlive the calls that started them');
};

const cases = async () => {
  group('workkit watch: attaching to the live run');

  await test('a live supervised run: the log\'s last 20 lines, then the run followed to its own code', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const go = path.join(w.out, 'go');
    const lines = Array.from({ length: 30 }, (_, i) => `line-${String(i + 1).padStart(2, '0')}`);
    const supervised = superviseStart(w, waitsFor(pidFile, go, { lines, after: 'after-attach', code: 5 }));
    let watch;
    try {
      assert(await until(() => read(runLog(w)).includes('line-30')), `the run never wrote its lines; it said: ${supervised.output()}`);
      // Watch attaches again once the call that started the run is gone.
      await supervised.end('SIGKILL');
      assert(alive(pidIn(pidFile)), 'the run outlives the call that started it');
      watch = workkitStart(['watch'], { cwd: w.repo, env: w.env });
      assert(await until(() => watch.output().includes('line-30')), `watch never printed the log; it said: ${watch.output()}`);
      fs.writeFileSync(go, '');
      const { status } = await watch.done;
      const said = linesOf(watch.output());
      assertEq(status, 5, `the run's own code, got: ${watch.output()}`);
      const missing = lines.slice(10).filter((line) => !said.includes(line));
      assertEq(missing.join(', '), '', `the log's last 20 lines, got: ${watch.output()}`);
      assert(!said.includes('line-10'), `and no line before them, got: ${watch.output()}`);
      assert(said.includes('after-attach'), `then what the run wrote after the attach, got: ${watch.output()}`);
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised, watch);
    }
  });

  await test('a watch attached beside the still-attached supervise call: both calls exit with the run\'s code', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const go = path.join(w.out, 'go');
    const supervised = superviseStart(w, waitsFor(pidFile, go, { lines: ['run-marker'], code: 5 }));
    let watch;
    try {
      assert(await until(() => read(runLog(w)).includes('run-marker')), `the run never started; it said: ${supervised.output()}`);
      watch = workkitStart(['watch'], { cwd: w.repo, env: w.env });
      assert(await until(() => watch.output().includes('run-marker')), `watch never printed the log; it said: ${watch.output()}`);
      fs.writeFileSync(go, '');
      const [first, second] = await Promise.all([supervised.done, watch.done]);
      assertEq(first.status, 5, `the supervise call exits with the run's code, got: ${supervised.output()}`);
      assertEq(second.status, 5, `the watch call exits with the run's code, got: ${watch.output()}`);
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised, watch);
    }
  });

  await suiteTest('a live suite run and a live supervised run: watch and watch suite follow the suite\'s, watch run the supervised one', async () => {
    const both = bothWorld();
    const { w, env } = both;
    const calls = {};
    try {
      await startBoth(both);
      for (const name of ['watch', 'suite', 'run']) {
        calls[name] = workkitStart(name === 'watch' ? ['watch'] : ['watch', name], { cwd: w.repo, env });
      }
      for (const [name, marker] of [['watch', 'suite-marker'], ['suite', 'suite-marker'], ['run', 'run-marker']]) {
        assert(await until(() => calls[name].output().includes(marker)), `${name} never showed ${marker}; it said: ${calls[name].output()}`);
      }
      fs.writeFileSync(path.join(w.out, 'go-suite'), '');
      fs.writeFileSync(path.join(w.out, 'go-run'), '');
      for (const [name, code, other] of [['watch', 6, 'run-marker'], ['suite', 6, 'run-marker'], ['run', 7, 'suite-marker']]) {
        const { status } = await calls[name].done;
        assertEq(status, code, `${name} ends with its run's code, got: ${calls[name].output()}`);
        assert(!calls[name].output().includes(other), `${name} showed its own run's log alone, got: ${calls[name].output()}`);
      }
    } finally {
      reap(pidIn(both.suitePid), pidIn(both.runPid));
      await endAll(...Object.values(calls));
    }
  });

  group('workkit watch: no run to attach to');

  await test('no live run: the no-run line naming the root, exit 1', async () => {
    const w = mkWorld();
    const res = await workkit(['watch'], { cwd: w.repo, env: w.env });
    assertEq(res.code, 1, `exit 1, got: ${res.output}`);
    const said = NO_RUN.exec(res.output);
    assert(said, `the no-run line, got: ${res.output}`);
    assertEq(realOf(said[1]), realOf(w.repo), `the line names the repo's root, got: ${said[0]}`);
  });

  await processTest('a run that asked for a look and then ended with 3, no call attached: watch prints the log\'s last lines and exits 3, a second watch the no-run line', async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      await lookedThenEnded(w, pidFile);
      const first = await workkit(['watch'], { cwd: w.repo, env: w.env });
      assertEq(first.code, 3, `the run's own code, got: ${first.output}`);
      assert(linesOf(first.output).includes('supervise: exit 3'), `the log's last lines, got: ${first.output}`);
      const second = await workkit(['watch'], { cwd: w.repo, env: w.env });
      assertEq(second.code, 1, `the second watch exits 1, got: ${second.output}`);
      assert(NO_RUN.test(second.output), `the second watch prints the no-run line, got: ${second.output}`);
    } finally {
      reap(pidIn(pidFile));
    }
  });

  await test('a folder outside any git repo: the line that says so, exit 1', async () => {
    const w = mkWorld();
    const res = await workkit(['watch'], { cwd: mkTmp('watch-nogit-'), env: w.env });
    assertEq(res.code, 1, `exit 1, got: ${res.output}`);
    assert(linesOf(res.output).includes('watch: not inside a git repository'), `the line, got: ${res.output}`);
  });

  await test('any other argument: the usage line, exit 2', async () => {
    const w = mkWorld();
    for (const args of [['nope'], ['--end', 'nope'], ['--stop']]) {
      const res = await workkit(['watch', ...args], { cwd: w.repo, env: w.env });
      assertEq(res.code, 2, `exit 2 for [${args}], got: ${res.output}`);
      assert(linesOf(res.output).includes(USAGE), `the usage line for [${args}], got: ${res.output}`);
    }
  });

  group('workkit watch --end');

  await test('a live run and watch --end: the request line, exit 0, the command is gone, the attached call exits 143, the lock dropped', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const supervised = superviseStart(w, silent(pidFile));
    try {
      const cmd = await pidOf(pidFile);
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env: w.env });
      assertEq(res.code, 0, `exit 0, got: ${res.output}`);
      assert(linesOf(res.output).includes(REQUEST_LINE), `the request line, got: ${res.output}`);
      assert(await until(() => !alive(cmd)), `the command ${cmd} outlived the request`);
      const { status } = await supervised.done;
      assertEq(status, 143, `the still-attached supervise call gets the run's code, got: ${supervised.output()}`);
      const after = await workkit(['watch'], { cwd: w.repo, env: w.env });
      assertEq(after.code, 1, `a watch after the end exits 1, got: ${after.output}`);
      assert(NO_RUN.test(after.output), `a watch after the end prints the no-run line, got: ${after.output}`);
    } finally {
      reap(pidIn(pidFile));
      await endAll(supervised);
    }
  });

  await processTest('a run that asked for a look and then ended with 3, no call attached: watch --end prints the ended line with its code, exit 0, the lock dropped', async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      await lookedThenEnded(w, pidFile);
      const res = await workkit(['watch', '--end'], { cwd: w.repo, env: w.env });
      assertEq(res.code, 0, `exit 0, got: ${res.output}`);
      assert(linesOf(res.output).includes('watch: the run ended already (exit 3)'), `the ended line, got: ${res.output}`);
      const after = await workkit(['watch'], { cwd: w.repo, env: w.env });
      assertEq(after.code, 1, `a watch after the end exits 1, got: ${after.output}`);
      assert(NO_RUN.test(after.output), `a watch after the end prints the no-run line, got: ${after.output}`);
    } finally {
      reap(pidIn(pidFile));
    }
  });

  await suiteTest('two live runs: watch --end with no name is refused, exit 2, both live; watch --end run ends the supervised one alone', async () => {
    const both = bothWorld();
    const { w, env } = both;
    try {
      await startBoth(both);
      const suite = pidIn(both.suitePid);
      const run = pidIn(both.runPid);
      const refused = await workkit(['watch', '--end'], { cwd: w.repo, env });
      assertEq(refused.code, 2, `the refusal's code, got: ${refused.output}`);
      assert(linesOf(refused.output).includes(TWO_LIVE), `the refusal line, got: ${refused.output}`);
      assert(!(await until(() => !alive(suite) || !alive(run), 500)), 'both runs still live after the refusal');
      const ended = await workkit(['watch', '--end', 'run'], { cwd: w.repo, env });
      assertEq(ended.code, 0, `exit 0, got: ${ended.output}`);
      assert(linesOf(ended.output).includes(REQUEST_LINE), `the request line, got: ${ended.output}`);
      assert(await until(() => !alive(run)), `the supervised command ${run} outlived the request`);
      assert(alive(suite), `the suite ${suite} still runs`);
    } finally {
      reap(pidIn(both.suitePid), pidIn(both.runPid));
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
