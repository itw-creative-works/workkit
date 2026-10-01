// Tests for workflow/script-shell.sh's root `npm test`: the suite runs detached,
// its output in the suite log and on the terminal, one run at a time, and the
// CHANGELOG check runs before it starts. The world both script-shell suites run
// npm in is tests/lib/script-shell.js.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, testUnless, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, SYSTEM_PATH, shellPath, joinPath, stubTool,
} = require('../lib/platform');
const { suiteLogPath, suiteLockPath, treeHash } = require('../lib/suite-record');
const { recordArgv, readArgv } = require('../lib/argv-log');
const {
  until, alive, readPid, collect,
} = require('../lib/process');
const { WRAPPER, CHANGELOG, ISSUE } = require('../hooks/commit-gate/helpers');
const {
  cleanup, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded,
} = require('../lib/script-shell');

// The suite log of a repo that does not ignore .workkit/, the lock's pid, and
// the log of one that does.
const tmpLog = (world, repo) => suiteLogPath(world.tmp, repo);
const lockPid = (world, repo) => path.join(suiteLockPath(world.tmp, repo), 'pid');
const repoLog = (repo) => path.join(repo, '.workkit', 'suite.log');
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
const lineCount = (file) => (read(file) || '').split('\n').filter(Boolean).length;

// A folder outside the repo the suite scripts write to (a counter, their pid),
// so nothing they leave changes the tree they prove; `env` hands it over.
const mkOut = (world) => {
  const dir = path.join(world.root, 'out');
  fs.mkdirSync(dir, { recursive: true });
  return { dir, env: { WK_OUT: shellPath(dir) } };
};

// A suite that announces itself, counts its runs, leaves its pid, and ends
// two seconds later.
const IN_FLIGHT = 'echo start; echo x >> "$WK_OUT/counter"; echo $$ > "$WK_OUT/suite.pid"; sleep 2; echo end';

// npm started without waiting for it, as an agent's tool starts a job: the
// caller polls `child.exitCode` and reads both streams through `output`.
const npmStart = (world, cwd, args, extra = {}) => {
  const child = spawn(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', `--script-shell=${WRAPPER}`, ...args], {
    cwd, env: { ...world.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, output: collect(child) };
};

const ended = (child) => child.exitCode !== null || child.signalCode !== null;

// Whatever a red case left running, ended hard so the next case starts clean.
const reap = (...pids) => {
  for (const pid of pids.filter(Boolean)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
};

// The pid of <parent>'s child whose command line names <needle>, or undefined.
const childPid = (parent, needle) => {
  const res = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' });
  const row = res.stdout.split('\n').map((l) => l.trim().split(/\s+/))
    .find(([, ppid, ...cmd]) => Number(ppid) === parent && cmd.join(' ').includes(needle));
  return row ? Number(row[0]) : undefined;
};

// A `node` ahead of the real one that logs every call's argv and runs it, so
// a case can tell whether the CHANGELOG linter was started.
const nodeLogger = (world) => {
  const bin = path.join(world.root, 'node-logger');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(world.root, 'node-argv.log');
  stubTool(bin, 'node', ['#!/bin/bash', recordArgv(log), `exec "${shellPath(process.execPath)}" "$@"`]);
  return {
    env: { PATH: joinPath(bin, NODE_DIR, SYSTEM_PATH) },
    lintCalls: () => readArgv(log).filter((argv) => argv.some((a) => a.includes('changelog/changelog.js'))),
  };
};

// A CHANGELOG entry of <words> words after its issue link.
const entryOf = (words) => CHANGELOG(`- ${ISSUE} - ${new Array(words - 1).fill('word').join(' ')} end.`);

const run = async () => {
  skipWithoutWrapper();

  group('script-shell: the root test runs detached, its output in the suite log');

  await test('a red root npm test: the output on the terminal and in the log, its code, no record', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'echo red-start && echo red-end && exit 3' } });
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 3, `the script's code comes back, got: ${res.code} ${res.err}`);
    assert(res.out.includes('red-start\nred-end\n'), `the terminal shows the output, got: ${res.out}`);
    const log = read(tmpLog(world, repo));
    assert(log !== undefined, `the suite log exists at ${tmpLog(world, repo)}`);
    assert(log.includes('red-start\nred-end\n'), `the log holds the output, got: ${JSON.stringify(log)}`);
    assert(log.endsWith('red-end\nscript-shell: exit 3\n'), `the log ends on the closing line, got: ${JSON.stringify(log)}`);
    assert(res.out.includes(log), `the terminal shows the log's output whole, log: ${JSON.stringify(log)}, out: ${res.out}`);
    assertEq(recorded(world, repo), undefined, 'a red run proves nothing');
    cleanup(world.root); cleanup(repo);
  });

  await testUnless(IS_WINDOWS, 'Windows sends npm no TERM it can forward or survive')(
    'npm sent TERM mid-run: the suite still finishes, the log holds its last line, the record is written',
    async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
      const tree = treeHash(repo);
      const log = tmpLog(world, repo);
      const { child, output } = npmStart(world, repo, ['test'], out.env);
      try {
        assert(await until(() => (read(log) || '').includes('start'), 20000),
          `the suite never wrote "start" to ${log}; npm said: ${output()}`);
        child.kill('SIGTERM');
        assert(await until(() => ended(child), 10000), 'npm never ended after TERM');
        assert(!read(log).split('\n').includes('end'), 'npm ended while the suite still ran');
        assert(await until(() => read(log).endsWith('script-shell: exit 0\n'), 20000),
          `the suite never finished; log: ${JSON.stringify(read(log))}`);
        assert(read(log).endsWith('\nend\nscript-shell: exit 0\n'),
          `the log holds the suite's last line, then the closing line, got: ${JSON.stringify(read(log))}`);
        assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
      } finally {
        reap(child.pid);
      }
      cleanup(world.root); cleanup(repo);
    },
  );

  await test('a second root npm test while one is in flight: exit 1, the line names the pid and the log, one run', async () => {
    const world = mkWorld();
    const out = mkOut(world);
    const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
    const counter = path.join(out.dir, 'counter');
    const { child, output } = npmStart(world, repo, ['test'], out.env);
    try {
      assert(await until(() => fs.existsSync(counter), 20000), `the first suite never started; npm said: ${output()}`);
      const second = npm(world, repo, ['test'], WRAPPER, out.env);
      assertEq(second.code, 1, `the second run refuses, got: ${second.code} ${second.err}`);
      const pid = read(lockPid(world, repo));
      assert(pid !== undefined, `the lock holds a pid at ${lockPid(world, repo)}`);
      const line = `script-shell: a root npm test is already running (pid ${pid.trim()}); its output is in ${shellPath(tmpLog(world, repo))}\n`;
      assert(second.err.includes(line), `the line names the pid and the log: ${JSON.stringify(line)}, got: ${second.err}`);
      assert(await until(() => ended(child), 20000), `the first run never ended; npm said: ${output()}`);
      assertEq(child.exitCode, 0, `the first run is green; npm said: ${output()}`);
      assertEq(lineCount(counter), 1, 'the script ran once');
    } finally {
      reap(child.pid);
    }
    cleanup(world.root); cleanup(repo);
  });

  await testUnless(IS_WINDOWS, 'Windows delivers no INT to one process')(
    'the wrapper sent INT mid-run: the suite is gone within 2 s, exit 130, no record',
    async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: 'echo $$ > "$WK_OUT/suite.pid"; sleep 10; echo x >> "$WK_OUT/counter"' } });
      const pidFile = path.join(out.dir, 'suite.pid');
      const { child, output } = npmStart(world, repo, ['test'], out.env);
      let wrapper;
      let suite;
      try {
        assert(await until(() => fs.existsSync(pidFile) && read(pidFile).trim() !== '', 20000),
          `the suite never wrote its pid; npm said: ${output()}`);
        suite = readPid(pidFile);
        assert(await until(() => (wrapper = childPid(child.pid, 'script-shell')) !== undefined, 5000),
          `npm (pid ${child.pid}) never showed a script-shell child`);
        process.kill(wrapper, 'SIGINT');
        assert(await until(() => !alive(suite), 2000), `the suite (pid ${suite}) still ran 2 s after INT`);
        assert(await until(() => ended(child), 10000), `npm never ended after the wrapper's INT; npm said: ${output()}`);
        assertEq(child.exitCode, 130, `the run's code is 130; npm said: ${output()}`);
        assertEq(recorded(world, repo), undefined, 'an interrupted run proves nothing');
        assertEq(lineCount(path.join(out.dir, 'counter')), 0, 'the suite never reached its end');
      } finally {
        reap(suite, wrapper, child.pid);
      }
      cleanup(world.root); cleanup(repo);
    },
  );

  await test('.workkit/ ignored: the log is .workkit/suite.log; not ignored: under TMPDIR; the record holds either tree', () => {
    const world = mkWorld();
    const ignored = mkRepo({ scripts: { test: 'echo logged-in-repo' } }, { '.gitignore': '.workkit/*\n' });
    const plain = mkRepo({ scripts: { test: 'echo logged-in-tmp' } });
    const ignoredTree = treeHash(ignored);
    const plainTree = treeHash(plain);
    assertEq(npm(world, ignored, ['test']).code, 0, 'the ignoring repo ran green');
    assertEq(npm(world, plain, ['test']).code, 0, 'the plain repo ran green');
    assert((read(repoLog(ignored)) || '').includes('logged-in-repo'), `the log is ${repoLog(ignored)}`);
    assertEq(read(tmpLog(world, ignored)), undefined, 'and not under TMPDIR');
    assert((read(tmpLog(world, plain)) || '').includes('logged-in-tmp'), `the log is ${tmpLog(world, plain)}`);
    assertEq(read(repoLog(plain)), undefined, 'and not in the repo, where it would change the tree');
    assertEq(recorded(world, ignored), `${ignoredTree}\n`, 'the ignored log leaves the tree as it was proved');
    assertEq(recorded(world, plain), `${plainTree}\n`, 'the TMPDIR log leaves the tree as it was proved');
    cleanup(world.root); cleanup(ignored); cleanup(plain);
  });

  group('script-shell: a lock left behind is taken over');

  await testUnless(IS_WINDOWS, 'Windows sends npm no TERM it can forward or survive')(
    'after a TERM-cut run has finished, the next root npm test runs: exit 0, its own log, the second count',
    async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
      const log = tmpLog(world, repo);
      const { child, output } = npmStart(world, repo, ['test'], out.env);
      let supervisor;
      try {
        assert(await until(() => (read(log) || '').includes('start') && read(lockPid(world, repo)) !== undefined, 20000),
          `the first suite never started under its lock; npm said: ${output()}`);
        supervisor = readPid(lockPid(world, repo));
        child.kill('SIGTERM');
        assert(await until(() => ended(child), 10000), 'npm never ended after TERM');
        // The supervisor writes the done file and then exits, so its exit is the done file's arrival.
        assert(await until(() => !alive(supervisor), 20000), `the first run's supervisor (pid ${supervisor}) never ended`);
        const second = npm(world, repo, ['test'], WRAPPER, out.env);
        assertEq(second.code, 0, `the second run goes green, got: ${second.code} ${second.out} ${second.err}`);
        assertEq(lineCount(path.join(out.dir, 'counter')), 2, 'the suite ran twice, once per run');
        const text = read(log);
        assertEq(text.split('\n').filter((l) => l === 'start').length, 1, `the log is the second run's own, got: ${JSON.stringify(text)}`);
        assert(text.endsWith('\nend\nscript-shell: exit 0\n'), `and it ran to its end, got: ${JSON.stringify(text)}`);
      } finally {
        reap(child.pid, supervisor);
      }
      cleanup(world.root); cleanup(repo);
    },
  );

  await test('a lock whose supervisor is gone and left no done file is taken over: the run goes green', () => {
    const world = mkWorld();
    const repo = mkRepo({ scripts: { test: 'echo after-takeover' } });
    const tree = treeHash(repo);
    const lock = suiteLockPath(world.tmp, repo);
    // A pid that was real a moment ago and has ended: the supervisor that died mid-run.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), `${dead}\n`);
    const res = npm(world, repo, ['test']);
    assertEq(res.code, 0, `the stale lock does not refuse the run, got: ${res.code} ${res.out} ${res.err}`);
    assert(!res.err.includes('already running'), `no refusal, got: ${res.err}`);
    assert((read(tmpLog(world, repo)) || '').includes('after-takeover'), 'the suite ran and logged');
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  group('script-shell: the CHANGELOG check runs before the suite');

  await test('a 62-word entry: exit 1, the gate\'s message with the word-cap line, the suite never ran, no record', () => {
    const world = mkWorld();
    const out = mkOut(world);
    const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(62));
    const res = npm(world, repo, ['test'], WRAPPER, out.env);
    assertEq(res.code, 1, `the run refuses, got: ${res.code} ${res.err}`);
    assert(res.err.includes('script-shell: the CHANGELOG entry does not match the format (see docs/project-state.md). '),
      `the gate's message, got: ${res.err}`);
    assert(res.err.includes('[word-cap] 62 words (max 50)'), `with the linter's word-cap line, got: ${res.err}`);
    assertEq(lineCount(path.join(out.dir, 'counter')), 0, 'the suite never ran');
    assertEq(recorded(world, repo), undefined, 'no record');
    cleanup(world.root); cleanup(repo);
  });

  await test('a clean 20-word entry: the linter runs, then the suite, and the record is written', () => {
    const world = mkWorld();
    const out = mkOut(world);
    const node = nodeLogger(world);
    const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(20));
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test'], WRAPPER, { ...out.env, ...node.env });
    assertEq(res.code, 0, `the run is green, got: ${res.code} ${res.err}`);
    assertEq(node.lintCalls().length, 1, 'the CHANGELOG linter ran once');
    assertEq(lineCount(path.join(out.dir, 'counter')), 1, 'the suite ran once');
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  await test('no CHANGELOG change: the suite runs and no linter is started', () => {
    const world = mkWorld();
    const out = mkOut(world);
    const node = nodeLogger(world);
    const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': entryOf(62) });
    fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test'], WRAPPER, { ...out.env, ...node.env });
    assertEq(res.code, 0, `the run is green, got: ${res.code} ${res.err}`);
    assertEq(node.lintCalls().length, 0, 'no CHANGELOG linter ran');
    assertEq(lineCount(path.join(out.dir, 'counter')), 1, 'the suite ran once');
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  await test('a 62-word entry in a workspace path with a space: caught before the suite, no record', () => {
    const world = mkWorld();
    const out = mkOut(world);
    const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'my pkg/CHANGELOG.md': CHANGELOG() });
    fs.writeFileSync(path.join(repo, 'my pkg', 'CHANGELOG.md'), entryOf(62));
    const res = npm(world, repo, ['test'], WRAPPER, out.env);
    assertEq(res.code, 1, `the run refuses, got: ${res.code} ${res.err}`);
    assert(res.err.includes('script-shell: the CHANGELOG entry does not match the format (see docs/project-state.md). '),
      `the gate's message, got: ${res.err}`);
    // The linter names only the file's basename; its word-cap line proves the
    // whole spaced path reached it, where a split path fails to read instead.
    assert(res.err.includes('[word-cap] 62 words (max 50)'), `the linter judged my pkg/CHANGELOG.md, got: ${res.err}`);
    assertEq(lineCount(path.join(out.dir, 'counter')), 0, 'the suite never ran');
    assertEq(recorded(world, repo), undefined, 'no record');
    cleanup(world.root); cleanup(repo);
  });

  await test('no linter where WORKFLOW_DIR points: the check stands aside, the suite runs and records', () => {
    const world = mkWorld();
    const out = mkOut(world);
    const empty = path.join(world.root, 'empty-engine');
    fs.mkdirSync(empty);
    const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(62));
    const tree = treeHash(repo);
    const res = npm(world, repo, ['test'], WRAPPER, { ...out.env, WORKFLOW_DIR: shellPath(empty) });
    assertEq(res.code, 0, `the run is green, got: ${res.code} ${res.out} ${res.err}`);
    assertEq(lineCount(path.join(out.dir, 'counter')), 1, 'the suite ran once');
    assertEq(recorded(world, repo), `${tree}\n`, 'the record holds the tree it proved');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
