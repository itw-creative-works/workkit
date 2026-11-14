// Tests for `workkit supervise -- <command>`: the command runs detached under the
// supervisor, its output the call's and in `.workkit/run.log`, the call exiting with
// its code, 124 on a frozen end or 125 on a look; one supervised run per repo,
// inside a git repo only; a narrowed npm test or a second supervise inside it
// runs under it alone, and a root npm test inside it holds the suite slot.
// The world is test/lib/supervise-world.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, run, start,
} = require('../lib/harness');
const {
  BASH, NO_RC, jsPath, joinPath,
} = require('../lib/platform');
const { skipWithoutWrapper, wiredNpmEnv } = require('../lib/script-shell');
const { workkitBin } = require('../lib/workkit-bin');
const {
  CHECK_MINUTES, skipOnWindows, FROZEN_LINE, pidOf, reap, silent, busy, read, lastLine, realOf,
} = require('../lib/supervise');
const {
  mkWorld, runLog, suiteLog, workkitStart, workkit, linesToLast, touches, prints, waitsFor,
} = require('../lib/supervise-world');

const USAGE = 'usage: workkit supervise -- <command> [args...]';
const REFUSAL = /^supervise: a supervised run is already running \(pid (\d+)\); its output is in (.+)$/m;

const supervise = (world, script, cwd = world.repo) => workkit(['supervise', '--', 'node', '-e', script], { cwd, env: world.env });

// The live supervisor processes of a world's runs: each detach.js whose command line names the world's folder.
const supervisorsIn = (w) => run('ps', ['-A', '-ww', '-o', 'command=']).stdout
  .split('\n').filter((line) => line.includes('detach.js') && line.includes(path.basename(w.dir))).length;

describe('workkit supervise: the run and its code', () => {
  test('a command that exits 3: the call exits 3, the output is the call\'s, and .workkit/run.log holds it and its exit line', async () => {
    const w = mkWorld();
    const res = await supervise(w, prints(3, { out: 'supervised-out', err: 'supervised-err' }));
    expect(res.code, `the command's own code, got: ${res.output}`).toBe(3);
    const said = linesToLast(res.output);
    expect(said.includes('supervised-out') && said.includes('supervised-err'), `the call shows both streams, got: ${res.output}`).toBeTruthy();
    const log = read(runLog(w));
    expect(log.includes('supervised-out\n') && log.includes('supervised-err\n'), `the run log holds both, got: ${JSON.stringify(log)}`).toBeTruthy();
    expect(lastLine(log), 'the run log ends with the exit line').toBe('supervise: exit 3');
  });

  test('a command that freezes: the call exits 124 and its last line is the frozen line', { skip: skipOnWindows() }, async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      const res = await supervise(w, silent(pidFile));
      expect(res.code, `the frozen run's code, got: ${res.output}`).toBe(124);
      expect(FROZEN_LINE.test(lastLine(res.output)), `the call's last line is the frozen line, got: ${JSON.stringify(linesToLast(res.output).slice(-3))}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
    }
  });

  test('a command that asks for a look: the call exits 125 and the command still runs', { skip: skipOnWindows() }, async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      const res = await supervise(w, busy(pidFile));
      expect(res.code, `the look's code, got: ${res.output}`).toBe(125);
      const cmd = pidIn(pidFile);
      expect(cmd > 0 && alive(cmd), `the command still runs, pid: ${cmd}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
    }
  });
});

describe('workkit supervise: one supervised run per repo', () => {
  test('a second supervise while one runs: the refusal with the live pid and the run log, exit 1, its command never runs', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const marker = path.join(w.out, 'second-ran');
    const first = workkitStart(['supervise', '--', 'node', '-e', silent(pidFile)], { cwd: w.repo, env: w.env });
    try {
      await pidOf(pidFile);
      const second = await supervise(w, touches(marker));
      expect(second.code, `the refusal's code, got: ${second.output}`).toBe(1);
      const said = REFUSAL.exec(second.output);
      expect(said, `the refusal line, got: ${second.output}`).toBeTruthy();
      expect(alive(Number(said[1])), `the pid it names is a live process, got: ${said[0]}`).toBeTruthy();
      expect(realOf(said[2]), `the line names the run log, got: ${said[0]}`).toBe(realOf(runLog(w)));
      expect(!(await until(() => fs.existsSync(marker), 500)), 'the second command never ran').toBeTruthy();
    } finally {
      reap(pidIn(pidFile));
      await first.end('SIGKILL');
    }
  });
});

describe('workkit supervise: how and where it is called', () => {
  test('no -- or no command: the usage line, exit 2, nothing runs', async () => {
    const w = mkWorld();
    const marker = path.join(w.out, 'ran');
    for (const args of [['supervise'], ['supervise', 'node', '-e', touches(marker)], ['supervise', '--']]) {
      const res = await workkit(args, { cwd: w.repo, env: w.env });
      expect(res.code, `exit 2 for [${args.slice(0, 2)}], got: ${res.output}`).toBe(2);
      expect(linesToLast(res.output).includes(USAGE), `the usage line for [${args.slice(0, 2)}], got: ${res.output}`).toBeTruthy();
    }
    expect(!(await until(() => fs.existsSync(marker), 500)), 'no call ran its command').toBeTruthy();
  });

  test('a folder outside any git repo: the line that says so, exit 1, nothing runs', async () => {
    const w = mkWorld();
    const marker = path.join(w.out, 'ran');
    const res = await supervise(w, touches(marker), mkTmp('supervise-nogit-'));
    expect(res.code, `exit 1, got: ${res.output}`).toBe(1);
    expect(linesToLast(res.output).includes('supervise: not inside a git repository'), `the line, got: ${res.output}`).toBeTruthy();
    expect(!(await until(() => fs.existsSync(marker), 500)), 'the command never ran').toBeTruthy();
  });
});

describe('workkit supervise: a supervised call inside it', () => {
  // Only the cases with a real npm test need npm's script shell.
  test('workkit supervise -- npm test -- <file>: one supervisor, the narrowed run in the foreground under it, the script\'s code', { skip: skipWithoutWrapper() }, async () => {
    const w = mkWorld({ files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node narrowed.js' } })}\n` } });
    fs.writeFileSync(path.join(w.repo, 'narrowed.js'), prints(3, { out: 'narrowed-out', err: 'narrowed-err' }));
    const res = await workkit(['supervise', '--', 'npm', 'test', '--', 'only/one.test.js'], { cwd: w.repo, env: wiredNpmEnv(w) });
    expect(res.code, `the script's own code, got: ${res.output}`).toBe(3);
    const said = linesToLast(res.output);
    expect(said.includes('narrowed-out') && said.includes('narrowed-err'), `the call shows the script's output, got: ${res.output}`).toBeTruthy();
    const closing = said.filter((line) => /^(supervise|script-shell): exit \d+$/.test(line));
    expect(JSON.stringify(closing), `one supervisor closed the run, the inner run none of its own, got: ${res.output}`).toBe(JSON.stringify(['supervise: exit 3']));
  });

  test('workkit supervise -- npm test at the root holds the suite slot: a second root npm test is refused, the suite log is there', { skip: skipWithoutWrapper() }, async () => {
    const w = mkWorld({ files: { 'package.json': `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node suite.js' } })}\n` } });
    const pidFile = path.join(w.out, 'suite.pid');
    const marker = path.join(w.out, 'second-ran');
    // The first run waits for its go file; a second one that ran would leave the marker.
    fs.writeFileSync(path.join(w.repo, 'suite.js'), [
      `if (require('fs').existsSync(${jsPath(pidFile)})) require('fs').writeFileSync(${jsPath(marker)}, '');`,
      waitsFor(pidFile, path.join(w.out, 'go'), { lines: ['suite-marker'], code: 0 }),
    ].join('\n'));
    const env = wiredNpmEnv(w);
    const first = workkitStart(['supervise', '--', 'npm', 'test'], { cwd: w.repo, env });
    let firstPid;
    let second;
    try {
      firstPid = await pidOf(pidFile);
      second = start(BASH, [...NO_RC, '-c', 'exec npm "$@"', 'npm', 'test'], { cwd: w.repo, env, detached: true });
      const { status } = await second.done;
      expect(status, `the second root run is refused, got: ${second.output()}`).toBe(1);
      expect(/^script-shell: a root npm test is already running \(pid \d+\)/m.test(second.output()), `the suite's one-run refusal, got: ${second.output()}`).toBeTruthy();
      expect(!fs.existsSync(marker), 'the second run never started the suite').toBeTruthy();
      expect(fs.existsSync(suiteLog(w)), `the supervised root run writes the suite log at ${suiteLog(w)}`).toBeTruthy();
    } finally {
      reap(firstPid, pidIn(pidFile));
      await Promise.all([first, second].filter(Boolean).map((call) => call.end('SIGKILL')));
    }
  });

  test('workkit supervise -- workkit supervise -- <script> that exits 3: as many supervisors as a plain supervise, the call exits 3', { skip: skipOnWindows() }, async () => {
    const plain = mkWorld();
    const nestedWorld = mkWorld();
    const envOf = (w) => ({ ...w.env, PATH: joinPath(workkitBin(), w.env.PATH) });
    const pidFile = (w) => path.join(w.out, 'cmd.pid');
    const go = (w) => path.join(w.out, 'go');
    const script = (w) => waitsFor(pidFile(w), go(w), { lines: ['inner-out'], code: 3 });
    const calls = [
      workkitStart(['supervise', '--', 'node', '-e', script(plain)], { cwd: plain.repo, env: envOf(plain) }),
      workkitStart(['supervise', '--', 'workkit', 'supervise', '--', 'node', '-e', script(nestedWorld)], { cwd: nestedWorld.repo, env: envOf(nestedWorld) }),
    ];
    try {
      for (const w of [plain, nestedWorld]) await pidOf(pidFile(w));
      const one = supervisorsIn(plain);
      expect(one > 0, 'a plain supervise shows its supervisor in the process list').toBeTruthy();
      expect(supervisorsIn(nestedWorld), 'the nested call starts no supervisor beyond a plain one\'s').toBe(one);
      for (const w of [plain, nestedWorld]) fs.writeFileSync(go(w), '');
      const { status } = await calls[1].done;
      expect(status, `the script's own code, got: ${calls[1].output()}`).toBe(3);
      expect(linesToLast(calls[1].output()).includes('inner-out'), `the call shows the script's output, got: ${calls[1].output()}`).toBeTruthy();
    } finally {
      reap(pidIn(pidFile(plain)), pidIn(pidFile(nestedWorld)));
      await Promise.all(calls.map((call) => call.end('SIGKILL')));
    }
  });

  test('a supervised command that prints a line, then runs workkit supervise -- <script> printing three: the run log holds all four once, in order, no NUL byte', async () => {
    const w = mkWorld();
    const env = { ...w.env, PATH: joinPath(workkitBin(), w.env.PATH) };
    const nested = ['nested-1', 'nested-2', 'nested-3'];
    const script = `${nested.map((line) => `console.log(${JSON.stringify(line)});`).join(' ')} process.exit(3);`;
    // The outer command writes first, so the inner supervise starts on a log already written to.
    const outer = ['bash', '-c', 'echo pre-line; workkit supervise -- node -e "$1"', 'bash', script];
    const res = await workkit(['supervise', '--', ...outer], { cwd: w.repo, env });
    expect(res.code, `the script's own code, got: ${res.output}`).toBe(3);
    const log = read(runLog(w));
    expect(!log.includes('\0'), `the run log holds no NUL byte, got: ${JSON.stringify(log)}`).toBeTruthy();
    const lines = ['pre-line', ...nested];
    expect(JSON.stringify(linesToLast(log).filter((line) => lines.includes(line))), `the run log holds each line once, in order, got: ${JSON.stringify(log)}`).toBe(JSON.stringify(lines));
  });
});
