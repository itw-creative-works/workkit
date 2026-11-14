// Tests for workflow/script-shell.sh's root `npm test`: the suite runs detached,
// its output in the suite log and on the terminal, one run at a time, and the
// CHANGELOG check runs before it starts; a narrowed run is supervised too, each in
// a slot of its own that Ctrl-C clears; a suite that freezes is ended, and one that works in silence
// asks for a look and runs on. The world both script-shell suites run npm in is
// test/lib/script-shell.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, until, alive, pidIn, start,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NODE_DIR, NO_RC, SYSTEM_PATH, shellPath, jsPath, joinPath, stubTool,
} = require('../lib/platform');
const { suiteLogPath, suiteLockPath, treeHash } = require('../lib/suite-record');
const { recordArgv, readArgv } = require('../lib/argv-log');
const { CHANGELOG, ISSUE } = require('../hooks/commit-gate/helpers');
const {
  cleanup, git, skipWithoutWrapper, mkRepo, mkWorld, npm, recorded, assertRecord,
} = require('../lib/script-shell');
const { runLib } = require('../lib/hook-lib');
const {
  CHECK_MINUTES, skipOnWindows, FROZEN_LINE, checkSettings, reap, realOf, ended, silent,
} = require('../lib/supervise');
const { linesToLast, prints } = require('../lib/supervise-world');

// The suite log of a repo that does not ignore .workkit/, the lock's pid, and
// the log of one that does.
const tmpLog = (world, repo) => suiteLogPath(world.workflowHome, repo);
const lockPid = (world, repo) => path.join(suiteLockPath(world.workflowHome, repo), 'pid');
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
// harness handle, whose caller polls `child.exitCode`, reads both streams
// through `output` and ends npm through `end`.
const npmStart = (world, cwd, args, extra = {}) => start(
  BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', `--script-shell=${world.wrapper}`, ...args],
  { cwd, env: { ...world.env, ...extra } },
);

// A repo's settings setting a check of about a second.
const SHORT_CHECK = { '.workkit/settings.json': checkSettings(CHECK_MINUTES) };

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
  const logFile = path.join(world.root, 'node-argv.log');
  stubTool(bin, 'node', ['#!/bin/bash', recordArgv(logFile), `exec "${shellPath(process.execPath)}" "$@"`]);
  return {
    env: { PATH: joinPath(bin, NODE_DIR, SYSTEM_PATH) },
    lintCalls: () => readArgv(logFile).filter((argv) => argv.some((a) => a.includes('changelog/lint.js'))),
  };
};

// A CHANGELOG entry of <words> words after its issue link.
const entryOf = (words) => CHANGELOG(`- ${ISSUE} - ${new Array(words - 1).fill('word').join(' ')} end.`);

describe('script-shell detached', { skip: skipWithoutWrapper() }, () => {
  describe('script-shell: the root test runs detached, its output in the suite log', () => {
    test('a red root npm test: the output on the terminal and in the log, its code, no record', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'echo red-start && echo red-end && exit 3' } });
      const res = npm(world, repo, ['test']);
      expect(res.code, `the script's code comes back, got: ${res.code} ${res.err}`).toBe(3);
      expect(res.out.includes('red-start\nred-end\n'), `the terminal shows the output, got: ${res.out}`).toBeTruthy();
      const logText = read(tmpLog(world, repo));
      expect(logText !== undefined, `the suite log exists at ${tmpLog(world, repo)}`).toBeTruthy();
      expect(logText.includes('red-start\nred-end\n'), `the log holds the output, got: ${JSON.stringify(logText)}`).toBeTruthy();
      expect(logText.endsWith('red-end\nscript-shell: exit 3\n'), `the log ends on the closing line, got: ${JSON.stringify(logText)}`).toBeTruthy();
      expect(res.out.includes(logText), `the terminal shows the log's output whole, log: ${JSON.stringify(logText)}, out: ${res.out}`).toBeTruthy();
      expect(recorded(world, repo), 'a red run proves nothing').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('npm sent TERM mid-run: the suite still finishes, the log holds its last line, the record is written', {
      skip: IS_WINDOWS && 'Windows sends npm no TERM it can forward or survive',
    }, async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
      const tree = treeHash(repo);
      const logFile = tmpLog(world, repo);
      const { child, output, end } = npmStart(world, repo, ['test'], out.env);
      try {
        expect(await until(() => (read(logFile) || '').includes('start')),
          `the suite never wrote "start" to ${logFile}; npm said: ${output()}`).toBeTruthy();
        child.kill('SIGTERM');
        expect(await until(() => ended(child)), 'npm never ended after TERM').toBeTruthy();
        expect(!read(logFile).split('\n').includes('end'), 'npm ended while the suite still ran').toBeTruthy();
        expect(await until(() => read(logFile).endsWith('script-shell: exit 0\n')),
          `the suite never finished; log: ${JSON.stringify(read(logFile))}`).toBeTruthy();
        expect(read(logFile).endsWith('\nend\nscript-shell: exit 0\n'),
          `the log holds the suite's last line, then the closing line, got: ${JSON.stringify(read(logFile))}`).toBeTruthy();
        assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      } finally {
        await end('SIGKILL');
      }
      cleanup(world.root); cleanup(repo);
    });

    test('a second root npm test while one is in flight: exit 1, the line names the pid and the log, one run', async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
      const counter = path.join(out.dir, 'counter');
      const { child, output, end } = npmStart(world, repo, ['test'], out.env);
      try {
        expect(await until(() => fs.existsSync(counter)), `the first suite never started; npm said: ${output()}`).toBeTruthy();
        const second = npm(world, repo, ['test'], world.wrapper, out.env);
        expect(second.code, `the second run refuses, got: ${second.code} ${second.err}`).toBe(1);
        const pid = read(lockPid(world, repo));
        expect(pid !== undefined, `the lock holds a pid at ${lockPid(world, repo)}`).toBeTruthy();
        // The wrapper's bash spells the log as its WORKFLOW_HOME reached it, so the
        // path is held to the file node resolves, never to one spelling.
        const said = second.err.match(/^script-shell: a root npm test is already running \(pid (\d+)\); its output is in (.+)$/m);
        expect(said && said[1] === pid.trim(), `the line names the lock's pid ${pid.trim()}, got: ${second.err}`).toBeTruthy();
        expect(realOf(said[2]), `the line names the suite log, got: ${second.err}`).toBe(realOf(tmpLog(world, repo)));
        expect(await until(() => ended(child)), `the first run never ended; npm said: ${output()}`).toBeTruthy();
        expect(child.exitCode, `the first run is green; npm said: ${output()}`).toBe(0);
        expect(lineCount(counter), 'the script ran once').toBe(1);
      } finally {
        await end('SIGKILL');
      }
      cleanup(world.root); cleanup(repo);
    });

    test('the wrapper sent INT mid-run: the suite is gone, exit 130, no record', {
      skip: IS_WINDOWS && 'Windows delivers no INT to one process',
    }, async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: 'echo $$ > "$WK_OUT/suite.pid"; sleep 10; echo x >> "$WK_OUT/counter"' } });
      const pidFile = path.join(out.dir, 'suite.pid');
      const { child, output, end } = npmStart(world, repo, ['test'], out.env);
      let wrapper;
      let suite;
      try {
        expect(await until(() => pidIn(pidFile) > 0),
          `the suite never wrote its pid; npm said: ${output()}`).toBeTruthy();
        suite = pidIn(pidFile);
        expect(await until(() => (wrapper = childPid(child.pid, 'script-shell')) !== undefined),
          `npm (pid ${child.pid}) never showed a script-shell child`).toBeTruthy();
        process.kill(wrapper, 'SIGINT');
        expect(await until(() => !alive(suite)), `the suite (pid ${suite}) outlived the INT`).toBeTruthy();
        expect(await until(() => ended(child)), `npm never ended after the wrapper's INT; npm said: ${output()}`).toBeTruthy();
        expect(child.exitCode, `the run's code is 130; npm said: ${output()}`).toBe(130);
        expect(recorded(world, repo), 'an interrupted run proves nothing').toBe(undefined);
        expect(lineCount(path.join(out.dir, 'counter')), 'the suite never reached its end').toBe(0);
      } finally {
        reap(suite, wrapper);
        await end('SIGKILL');
      }
      cleanup(world.root); cleanup(repo);
    });

    test('.workkit/ ignored: the log is .workkit/suite.log; not ignored: under the workflow home; the record holds either tree', () => {
      const world = mkWorld();
      const ignored = mkRepo({ scripts: { test: 'echo logged-in-repo' } }, { '.gitignore': '.workkit/*\n' });
      const plain = mkRepo({ scripts: { test: 'echo logged-in-tmp' } });
      const ignoredTree = treeHash(ignored);
      const plainTree = treeHash(plain);
      expect(npm(world, ignored, ['test']).code, 'the ignoring repo ran green').toBe(0);
      expect(npm(world, plain, ['test']).code, 'the plain repo ran green').toBe(0);
      expect((read(repoLog(ignored)) || '').includes('logged-in-repo'), `the log is ${repoLog(ignored)}`).toBeTruthy();
      expect(read(tmpLog(world, ignored)), 'and not under the workflow home').toBe(undefined);
      expect((read(tmpLog(world, plain)) || '').includes('logged-in-tmp'), `the log is ${tmpLog(world, plain)}`).toBeTruthy();
      expect(read(repoLog(plain)), 'and not in the repo, where it would change the tree').toBe(undefined);
      assertRecord(recorded(world, ignored), ignoredTree, 'the ignored log leaves the tree as it was proved');
      assertRecord(recorded(world, plain), plainTree, 'the workflow home log leaves the tree as it was proved');
      cleanup(world.root); cleanup(ignored); cleanup(plain);
    });
  });

  describe('script-shell: a lock left behind is taken over', () => {
    test('after a TERM-cut run has finished, the next root npm test runs: exit 0, its own log, the second count', {
      skip: IS_WINDOWS && 'Windows sends npm no TERM it can forward or survive',
    }, async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: IN_FLIGHT } });
      const logFile = tmpLog(world, repo);
      const { child, output, end } = npmStart(world, repo, ['test'], out.env);
      let supervisor;
      try {
        expect(await until(() => (read(logFile) || '').includes('start') && pidIn(lockPid(world, repo)) > 0),
          `the first suite never started under its lock; npm said: ${output()}`).toBeTruthy();
        supervisor = pidIn(lockPid(world, repo));
        child.kill('SIGTERM');
        expect(await until(() => ended(child)), 'npm never ended after TERM').toBeTruthy();
        // The supervisor writes the done file and then exits, so its exit is the done file's arrival.
        expect(await until(() => !alive(supervisor)), `the first run's supervisor (pid ${supervisor}) never ended`).toBeTruthy();
        const second = npm(world, repo, ['test'], world.wrapper, out.env);
        expect(second.code, `the second run goes green, got: ${second.code} ${second.out} ${second.err}`).toBe(0);
        expect(lineCount(path.join(out.dir, 'counter')), 'the suite ran twice, once per run').toBe(2);
        const text = read(logFile);
        expect(text.split('\n').filter((l) => l === 'start').length, `the log is the second run's own, got: ${JSON.stringify(text)}`).toBe(1);
        expect(text.endsWith('\nend\nscript-shell: exit 0\n'), `and it ran to its end, got: ${JSON.stringify(text)}`).toBeTruthy();
      } finally {
        await end('SIGKILL');
        reap(supervisor);
      }
      cleanup(world.root); cleanup(repo);
    });

    test('a lock whose supervisor is gone and left no done file is taken over: the run goes green', () => {
      const world = mkWorld();
      const repo = mkRepo({ scripts: { test: 'echo after-takeover' } });
      const tree = treeHash(repo);
      const lock = suiteLockPath(world.workflowHome, repo);
      // A pid that was real a moment ago and has ended: the supervisor that died mid-run.
      const dead = spawnSync(process.execPath, ['-e', '0']).pid;
      fs.mkdirSync(lock, { recursive: true });
      fs.writeFileSync(path.join(lock, 'pid'), `${dead}\n`);
      const res = npm(world, repo, ['test']);
      expect(res.code, `the stale lock does not refuse the run, got: ${res.code} ${res.out} ${res.err}`).toBe(0);
      expect(!res.err.includes('already running'), `no refusal, got: ${res.err}`).toBeTruthy();
      expect((read(tmpLog(world, repo)) || '').includes('after-takeover'), 'the suite ran and logged').toBeTruthy();
      assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: the CHANGELOG check runs before the suite', () => {
    test('a 62-word entry: exit 1, the gate\'s message with the word-cap line, the suite never ran, no record', () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(62));
      const res = npm(world, repo, ['test'], world.wrapper, out.env);
      expect(res.code, `the run refuses, got: ${res.code} ${res.err}`).toBe(1);
      expect(res.err.includes('script-shell: the CHANGELOG entry does not match the format (see docs/project-state.md). '),
        `the gate's message, got: ${res.err}`).toBeTruthy();
      expect(res.err.includes('[word-cap] 62 words (max 50)'), `with the linter's word-cap line, got: ${res.err}`).toBeTruthy();
      expect(lineCount(path.join(out.dir, 'counter')), 'the suite never ran').toBe(0);
      expect(recorded(world, repo), 'no record').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('a clean 20-word entry: the linter runs, then the suite, and the record is written', () => {
      const world = mkWorld();
      const out = mkOut(world);
      const node = nodeLogger(world);
      const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(20));
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test'], world.wrapper, { ...out.env, ...node.env });
      expect(res.code, `the run is green, got: ${res.code} ${res.err}`).toBe(0);
      expect(node.lintCalls().length, 'the CHANGELOG linter ran once').toBe(1);
      expect(lineCount(path.join(out.dir, 'counter')), 'the suite ran once').toBe(1);
      assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      cleanup(world.root); cleanup(repo);
    });

    test('no CHANGELOG change: the suite runs and no linter is started', () => {
      const world = mkWorld();
      const out = mkOut(world);
      const node = nodeLogger(world);
      const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': entryOf(62) });
      fs.writeFileSync(path.join(repo, 'app.js'), 'const x = 2;\n');
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test'], world.wrapper, { ...out.env, ...node.env });
      expect(res.code, `the run is green, got: ${res.code} ${res.err}`).toBe(0);
      expect(node.lintCalls().length, 'no CHANGELOG linter ran').toBe(0);
      expect(lineCount(path.join(out.dir, 'counter')), 'the suite ran once').toBe(1);
      assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      cleanup(world.root); cleanup(repo);
    });

    test('a 62-word entry in a workspace path with a space: caught before the suite, no record', () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'my pkg/CHANGELOG.md': CHANGELOG() });
      fs.writeFileSync(path.join(repo, 'my pkg', 'CHANGELOG.md'), entryOf(62));
      const res = npm(world, repo, ['test'], world.wrapper, out.env);
      expect(res.code, `the run refuses, got: ${res.code} ${res.err}`).toBe(1);
      expect(res.err.includes('script-shell: the CHANGELOG entry does not match the format (see docs/project-state.md). '),
        `the gate's message, got: ${res.err}`).toBeTruthy();
      // The linter names only the file's basename; its word-cap line proves the
      // whole spaced path reached it, where a split path fails to read instead.
      expect(res.err.includes('[word-cap] 62 words (max 50)'), `the linter judged my pkg/CHANGELOG.md, got: ${res.err}`).toBeTruthy();
      expect(lineCount(path.join(out.dir, 'counter')), 'the suite never ran').toBe(0);
      expect(recorded(world, repo), 'no record').toBe(undefined);
      cleanup(world.root); cleanup(repo);
    });

    test('no linter where WORKFLOW_DIR points: the check stands aside, the suite runs and records', () => {
      const world = mkWorld();
      const out = mkOut(world);
      const empty = path.join(world.root, 'empty-engine');
      fs.mkdirSync(empty);
      const repo = mkRepo({ scripts: { test: 'echo x >> "$WK_OUT/counter"' } }, { 'CHANGELOG.md': CHANGELOG() });
      fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), entryOf(62));
      const tree = treeHash(repo);
      const res = npm(world, repo, ['test'], world.wrapper, { ...out.env, WORKFLOW_DIR: shellPath(empty) });
      expect(res.code, `the run is green, got: ${res.code} ${res.out} ${res.err}`).toBe(0);
      expect(lineCount(path.join(out.dir, 'counter')), 'the suite ran once').toBe(1);
      assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: a narrowed run runs supervised, in a slot of its own', () => {
    test('a narrowed npm test that exits 3: the call exits 3, its output holds both streams, its last line the closing line', () => {
      const world = mkWorld();
      // node, so the file npm appends to the script is an argument and never exit's.
      const repo = mkRepo({ scripts: { test: 'node narrowed.js' } }, { 'narrowed.js': prints(3, { out: 'narrowed-out', err: 'narrowed-err' }) });
      const res = npm(world, repo, ['test', '--', 'only/one.test.js']);
      expect(res.code, `the script's own code, got: ${res.code} ${res.out} ${res.err}`).toBe(3);
      const said = linesToLast(res.out);
      expect(said.includes('narrowed-out') && said.includes('narrowed-err'), `the output holds the script's stdout and stderr, got: ${res.out}`).toBeTruthy();
      expect(said[said.length - 1], `the last line is the closing line, got: ${res.out}`).toBe('script-shell: exit 3');
      cleanup(world.root); cleanup(repo);
    });

    test('two narrowed npm tests started at once in one repo: both run to their end, each with its own code', async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const go = path.join(out.dir, 'go');
      // Leaves its own pid by the code it was given, then exits with that code once the go file exists.
      const waits = [
        "const fs = require('fs');",
        'const code = Number(process.argv[2]);',
        `fs.writeFileSync(${jsPath(out.dir)} + '/' + code + '.pid', String(process.pid));`,
        `setInterval(() => { if (fs.existsSync(${jsPath(go)})) process.exit(code); }, 50);`,
      ].join('\n');
      const repo = mkRepo({ scripts: { test: 'node waits.js' } }, { 'waits.js': waits });
      const runs = [4, 5].map((code) => ({ code, pid: path.join(out.dir, `${code}.pid`), call: npmStart(world, repo, ['test', '--', String(code)]) }));
      try {
        for (const { code, pid, call } of runs) {
          expect(await until(() => pidIn(pid) > 0), `the run given ${code} never started beside the other; npm said: ${call.output()}`).toBeTruthy();
        }
        fs.writeFileSync(go, '');
        for (const { code, call } of runs) {
          const { status } = await call.done;
          expect(status, `the run given ${code} exits with it, got: ${call.output()}`).toBe(code);
          const said = linesToLast(call.stdout());
          expect(said[said.length - 1], `its own supervisor saw its end, got: ${call.output()}`).toBe(`script-shell: exit ${code}`);
        }
      } finally {
        reap(...runs.map(({ pid }) => pidIn(pid)));
        await Promise.all(runs.map(({ call }) => call.end('SIGKILL')));
      }
      cleanup(world.root); cleanup(repo);
    });

    test('a narrowed npm test that Ctrl-C ends: the call exits 130, the run\'s log and lock are gone', {
      skip: IS_WINDOWS && 'Windows delivers no INT to one process',
    }, async () => {
      const world = mkWorld();
      const out = mkOut(world);
      const pidFile = path.join(out.dir, 'narrowed.pid');
      const repo = mkRepo({ scripts: { test: 'node waits.js' } }, { 'waits.js': silent(pidFile) });
      const root = git(repo, 'rev-parse', '--show-toplevel');
      const { child, output, end } = npmStart(world, repo, ['test', '--', 'only/one.test.js']);
      let wrapper;
      let run;
      try {
        expect(await until(() => pidIn(pidFile) > 0), `the narrowed run never wrote its pid; npm said: ${output()}`).toBeTruthy();
        run = pidIn(pidFile);
        expect(await until(() => (wrapper = childPid(child.pid, 'script-shell')) !== undefined),
          `npm (pid ${child.pid}) never showed a script-shell child`).toBeTruthy();
        const slot = runLib(`wk_test_log_path "${root}" ${wrapper} && wk_test_lock_path "${root}" ${wrapper}`,
          { ...world.env, WORKKIT_NODE: shellPath(process.execPath) });
        const [log, lock] = slot.stdout.trim().split('\n');
        expect(slot.code === 0 && fs.existsSync(log) && fs.existsSync(lock), `the run's slot is there while it runs, got: ${slot.stdout} ${slot.stderr}`).toBeTruthy();
        process.kill(wrapper, 'SIGINT');
        expect(await until(() => !alive(run)), `the narrowed run (pid ${run}) outlived the INT`).toBeTruthy();
        expect(await until(() => ended(child)), `npm never ended after the INT; npm said: ${output()}`).toBeTruthy();
        expect(child.exitCode, `the call's code is 130; npm said: ${output()}`).toBe(130);
        expect(!fs.existsSync(log), `the run's log is gone: ${log}`).toBeTruthy();
        expect(!fs.existsSync(lock), `the run's lock is gone: ${lock}`).toBeTruthy();
      } finally {
        reap(run, wrapper);
        await end('SIGKILL');
      }
      cleanup(world.root); cleanup(repo);
    });
  });

  describe('script-shell: the supervisor\'s checks', () => {
    test('a root npm test whose suite freezes: exit 124, the log\'s last line the frozen line', { skip: skipOnWindows() }, () => {
      const world = mkWorld();
      const out = mkOut(world);
      const repo = mkRepo({ scripts: { test: 'echo $$ > "$WK_OUT/suite.pid"; exec sleep 600' } }, SHORT_CHECK);
      const pidFile = path.join(out.dir, 'suite.pid');
      try {
        const res = npm(world, repo, ['test'], world.wrapper, out.env);
        expect(res.code, `the frozen run's code, got: ${res.code} ${res.err}`).toBe(124);
        const lines = (read(tmpLog(world, repo)) || '').replace(/\n$/, '').split('\n');
        expect(FROZEN_LINE.test(lines[lines.length - 1]), `the log's last line is the frozen line, got: ${JSON.stringify(lines.slice(-3))}`).toBeTruthy();
      } finally {
        reap(pidIn(pidFile));
      }
      cleanup(world.root); cleanup(repo);
    });

    test('a root npm test that asks for a look: exit 125, the suite runs on, and its green end still writes the record', { skip: skipOnWindows() }, async () => {
      const world = mkWorld();
      const out = mkOut(world);
      // Busy and silent until the case writes its go file, then green; exec
      // keeps the pid it wrote, so a red case ends the busy loop itself.
      const busy = 'exec node -e \'const fs = require("fs"); while (!fs.existsSync(process.env.WK_OUT + "/go")) {}\'';
      const repo = mkRepo({ scripts: { test: `echo $$ > "$WK_OUT/suite.pid"; ${busy}` } }, SHORT_CHECK);
      const tree = treeHash(repo);
      const pidFile = path.join(out.dir, 'suite.pid');
      const { child, output, end } = npmStart(world, repo, ['test'], out.env);
      try {
        expect(await until(() => ended(child)), `npm never returned; npm said: ${output()}`).toBeTruthy();
        expect(child.exitCode, `the look's code; npm said: ${output()}`).toBe(125);
        const suite = pidIn(pidFile);
        expect(suite > 0 && alive(suite), `the suite runs on, pid: ${suite}`).toBeTruthy();
        fs.writeFileSync(path.join(out.dir, 'go'), '');
        expect(await until(() => recorded(world, repo) !== undefined), 'the green end never wrote its record').toBeTruthy();
        assertRecord(recorded(world, repo), tree, 'the record holds the tree it proved');
      } finally {
        reap(pidIn(pidFile));
        await end('SIGKILL');
      }
      cleanup(world.root); cleanup(repo);
    });
  });
});
