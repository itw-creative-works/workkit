// Tests for `workkit supervise -- <command>`: the command runs detached under the
// supervisor, its output the call's and in `.workkit/run.log`, the call exiting with
// its code, 124 on a frozen end or 125 on a look; one supervised run per repo,
// inside a git repo only, and never around a run the supervisor reads already.
// The world is test/lib/supervise-world.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, until, alive,
} = require('../lib/harness');
const { shellPath, joinPath, stubTool } = require('../lib/platform');
const {
  CHECK_MINUTES, processTest, FROZEN_LINE, pidIn, pidOf, reap, silent, busy, read, lastLine, realOf,
} = require('../lib/supervise');
const {
  mkWorld, runLog, workkitStart, workkit, linesOf, touches, prints,
} = require('../lib/supervise-world');

const USAGE = 'usage: workkit supervise -- <command> [args...]';
const REFUSAL = /^supervise: a supervised run is already running \(pid (\d+)\); its output is in (.+)$/m;
const nested = (command) => `supervise: the supervisor reads ${command} already; run it without workkit supervise`;

const supervise = (world, script, cwd = world.repo) => workkit(['supervise', '--', 'node', '-e', script], { cwd, env: world.env });

/**
 * A world with a package folder under its root, and an env whose PATH finds a fake
 * `npm` and a fake `workkit` first, so no real suite or verb starts: each prints
 * `<name>-ran: <args>` and leaves `<name>-ran` in the world's out folder.
 */
const fakesWorld = () => {
  const w = mkWorld({ files: { 'packages/core/package.json': '{ "private": true }\n' } });
  const bin = path.join(w.dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['npm', 'workkit']) {
    stubTool(bin, name, ['#!/bin/bash', `: > ${JSON.stringify(shellPath(path.join(w.out, `${name}-ran`)))}`, `echo "${name}-ran: $*"`]);
  }
  return { w, env: { ...w.env, PATH: joinPath(bin, w.env.PATH) } };
};

const cases = async () => {
  group('workkit supervise: the run and its code');

  await test('a command that exits 3: the call exits 3, the output is the call\'s, and .workkit/run.log holds it and its exit line', async () => {
    const w = mkWorld();
    const res = await supervise(w, prints(3, { out: 'supervised-out', err: 'supervised-err' }));
    assertEq(res.code, 3, `the command's own code, got: ${res.output}`);
    const said = linesOf(res.output);
    assert(said.includes('supervised-out') && said.includes('supervised-err'), `the call shows both streams, got: ${res.output}`);
    const log = read(runLog(w));
    assert(log.includes('supervised-out\n') && log.includes('supervised-err\n'), `the run log holds both, got: ${JSON.stringify(log)}`);
    assertEq(lastLine(log), 'supervise: exit 3', 'the run log ends with the exit line');
  });

  await processTest('a command that freezes: the call exits 124 and its last line is the frozen line', async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      const res = await supervise(w, silent(pidFile));
      assertEq(res.code, 124, `the frozen run's code, got: ${res.output}`);
      assert(FROZEN_LINE.test(lastLine(res.output)), `the call's last line is the frozen line, got: ${JSON.stringify(linesOf(res.output).slice(-3))}`);
    } finally {
      reap(pidIn(pidFile));
    }
  });

  await processTest('a command that asks for a look: the call exits 125 and the command still runs', async () => {
    const w = mkWorld({ check: CHECK_MINUTES });
    const pidFile = path.join(w.out, 'cmd.pid');
    try {
      const res = await supervise(w, busy(pidFile));
      assertEq(res.code, 125, `the look's code, got: ${res.output}`);
      const cmd = pidIn(pidFile);
      assert(cmd !== undefined && alive(cmd), `the command still runs, pid: ${cmd}`);
    } finally {
      reap(pidIn(pidFile));
    }
  });

  group('workkit supervise: one supervised run per repo');

  await test('a second supervise while one runs: the refusal with the live pid and the run log, exit 1, its command never runs', async () => {
    const w = mkWorld();
    const pidFile = path.join(w.out, 'cmd.pid');
    const marker = path.join(w.out, 'second-ran');
    const first = workkitStart(['supervise', '--', 'node', '-e', silent(pidFile)], { cwd: w.repo, env: w.env });
    try {
      await pidOf(pidFile);
      const second = await supervise(w, touches(marker));
      assertEq(second.code, 1, `the refusal's code, got: ${second.output}`);
      const said = REFUSAL.exec(second.output);
      assert(said, `the refusal line, got: ${second.output}`);
      assert(alive(Number(said[1])), `the pid it names is a live process, got: ${said[0]}`);
      assertEq(realOf(said[2]), realOf(runLog(w)), `the line names the run log, got: ${said[0]}`);
      assert(!(await until(() => fs.existsSync(marker), 500)), 'the second command never ran');
    } finally {
      reap(pidIn(pidFile));
      await first.end('SIGKILL');
    }
  });

  group('workkit supervise: how and where it is called');

  await test('no -- or no command: the usage line, exit 2, nothing runs', async () => {
    const w = mkWorld();
    const marker = path.join(w.out, 'ran');
    for (const args of [['supervise'], ['supervise', 'node', '-e', touches(marker)], ['supervise', '--']]) {
      const res = await workkit(args, { cwd: w.repo, env: w.env });
      assertEq(res.code, 2, `exit 2 for [${args.slice(0, 2)}], got: ${res.output}`);
      assert(linesOf(res.output).includes(USAGE), `the usage line for [${args.slice(0, 2)}], got: ${res.output}`);
    }
    assert(!(await until(() => fs.existsSync(marker), 500)), 'no call ran its command');
  });

  await test('a folder outside any git repo: the line that says so, exit 1, nothing runs', async () => {
    const w = mkWorld();
    const marker = path.join(w.out, 'ran');
    const res = await supervise(w, touches(marker), mkTmp('supervise-nogit-'));
    assertEq(res.code, 1, `exit 1, got: ${res.output}`);
    assert(linesOf(res.output).includes('supervise: not inside a git repository'), `the line, got: ${res.output}`);
    assert(!(await until(() => fs.existsSync(marker), 500)), 'the command never ran');
  });

  group('workkit supervise: a command the supervisor reads already');

  await test('npm test in the repo root, workkit prove, or workkit supervise -- true: the nested refusal, exit 2, nothing runs', async () => {
    const { w, env } = fakesWorld();
    for (const command of [['npm', 'test'], ['workkit', 'prove'], ['workkit', 'supervise', '--', 'true']]) {
      const spelled = command.join(' ');
      const res = await workkit(['supervise', '--', ...command], { cwd: w.repo, env });
      assertEq(res.code, 2, `exit 2 for ${spelled}, got: ${res.output}`);
      assert(linesOf(res.output).includes(nested(spelled)), `the nested refusal naming ${spelled}, got: ${res.output}`);
    }
    const ran = () => ['npm-ran', 'workkit-ran'].some((name) => fs.existsSync(path.join(w.out, name)));
    assert(!(await until(ran, 500)), 'no refused command ran');
  });

  await test('npm test -- test/x.test.js in the repo root, or npm test in a package folder under it: the command runs', async () => {
    const { w, env } = fakesWorld();
    for (const [args, cwd] of [[['test', '--', 'test/x.test.js'], w.repo], [['test'], path.join(w.repo, 'packages', 'core')]]) {
      const res = await workkit(['supervise', '--', 'npm', ...args], { cwd, env });
      assertEq(res.code, 0, `the command's own code for npm ${args.join(' ')}, got: ${res.output}`);
      assert(linesOf(res.output).includes(`npm-ran: ${args.join(' ')}`), `the fake npm ran with ${args.join(' ')}, got: ${res.output}`);
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
