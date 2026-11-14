// Tests for workflow/lib/tree.js: treeOf, the processes under a pid by parent,
// a child in its own session included and an unrelated process left out, each
// with the processor time it has used so far; and endTreeOf, the one home of the
// Windows tree end, its Windows arm reached on any machine through its seams.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, start, pidIn, alive,
  endTree, run,
} = require('../lib/harness');
const { IS_WINDOWS, pathWith, recordingRun, signalsRefused, samePath, spawn } = require('../lib/platform');
const { skipOnWindows, reap } = require('../lib/supervise');
const { caught } = require('../lib/caught');

const TREE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree.js');
const { treeOf, endTreeOf } = require(TREE);

const PLATFORM = path.join(__dirname, '..', 'lib', 'platform.js');

const SYSTEM_ROOT = 'C:\\Windows';
const TASKKILL = 'C:\\Windows\\System32\\taskkill.exe';

/**
 * The seams that put `endTreeOf` or `endTree` on its Windows arm with a `run`
 * whose taskkill exits `status` (null: cannot start, 'hang': runs to its timeout),
 * and the calls it saw.
 */
const windowsArm = (status, extra = { systemRoot: SYSTEM_ROOT }) => {
  const recorded = recordingRun(status);
  return { seams: { platform: 'win32', run: recorded.run, ...extra }, calls: recorded.calls };
};

/** The one call `calls` holds, else a failure naming them all. */
const onlyCall = (calls) => {
  expect(calls.length, `one program was run, got: ${JSON.stringify(calls)}`).toBe(1);
  return calls[0];
};

// A process that writes its pid to <dir>/<name>, starts each child [name, detached,
// children] in turn through the suites' platform seam, and then waits, or keeps a
// processor busy when its name says so.
const NODE = [
  `const { spawn } = require(${JSON.stringify(PLATFORM)});`,
  "const fs = require('fs');",
  "const path = require('path');",
  'const [dir, name, kids] = process.argv.slice(2);',
  'for (const [kid, detached, grand] of JSON.parse(kids)) {',
  "  spawn(process.execPath, [__filename, dir, kid, JSON.stringify(grand)], { detached, stdio: 'ignore' });",
  '}',
  'fs.writeFileSync(path.join(dir, name), String(process.pid));',
  "if (name.startsWith('busy')) for (;;) {}",
  'setInterval(() => {}, 1 << 30);',
  '',
].join('\n');

/**
 * The tree <kids> describes under a root named `root`, started from <dir>, and
 * the pids of <names> once each has written its own.
 */
const startTree = async (dir, kids, names) => {
  const program = path.join(dir, 'node.js');
  fs.writeFileSync(program, NODE);
  const handle = start(process.execPath, [program, dir, 'root', JSON.stringify(kids)]);
  const pidOf = (name) => pidIn(path.join(dir, name));
  expect(await until(() => names.every(pidOf)), `every process wrote its pid: ${names.filter((n) => !pidOf(n)).join(', ')} did not`).toBeTruthy();
  return { handle, pids: Object.fromEntries(names.map((name) => [name, pidOf(name)])) };
};

describe('tree: treeOf', () => {
  test('a grandchild and a child in its own session are listed, each by its parent; an unrelated process is not', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('tree-list-');
    const other = mkTmp('tree-other-');
    const kids = [['child', false, [['grandchild', false, []]]], ['session', true, []]];
    const { handle, pids } = await startTree(dir, kids, ['root', 'child', 'grandchild', 'session']);
    const unrelated = await startTree(other, [], ['root']);
    try {
      const entries = treeOf(pids.root);
      const byPid = (pid) => entries.find((e) => e.pid === pid);
      const listed = entries.map((e) => e.pid).join(', ');
      expect(byPid(pids.grandchild), `the grandchild ${pids.grandchild} is listed, got: ${listed}`).toBeTruthy();
      expect(byPid(pids.grandchild).ppid, 'the grandchild\'s parent is the child').toBe(pids.child);
      expect(byPid(pids.session), `the child in its own session ${pids.session} is listed, got: ${listed}`).toBeTruthy();
      expect(byPid(pids.session).ppid, 'its parent is the root').toBe(pids.root);
      expect(!byPid(unrelated.pids.root), `the unrelated ${unrelated.pids.root} is not listed, got: ${listed}`).toBeTruthy();
      const named = entries.filter((e) => typeof e.command === 'string' && e.command.includes('node'));
      expect(named.length, `every entry names its command, got: ${JSON.stringify(entries)}`).toBe(entries.length);
    } finally {
      reap(...Object.values(pids), unrelated.pids.root);
      await Promise.all([handle.end('SIGKILL'), unrelated.handle.end('SIGKILL')]);
    }
  });

  test('a process that keeps a processor busy shows a growing cpu', { skip: skipOnWindows() }, async () => {
    const dir = mkTmp('tree-busy-');
    const { handle, pids } = await startTree(dir, [['busy', false, []]], ['root', 'busy']);
    try {
      const cpuOf = () => (treeOf(pids.root).find((e) => e.pid === pids.busy) || {}).cpu;
      const first = cpuOf();
      expect(typeof first, `the busy process is listed with a cpu, got: ${JSON.stringify(treeOf(pids.root))}`).toBe('number');
      expect(await until(() => cpuOf() > first), `its cpu never grew past ${first}`).toBeTruthy();
    } finally {
      reap(...Object.values(pids));
      await handle.end('SIGKILL');
    }
  });
});

describe('tree: endTreeOf on the Windows arm', () => {
  test('a taskkill that starts is run from System32 under SystemRoot with /T /F /PID, whatever PATH holds', async () => {
    const shadow = mkTmp('tree-path-');
    fs.writeFileSync(path.join(shadow, 'taskkill.exe'), '');
    const { seams, calls } = windowsArm(0);
    const realPath = process.env.PATH;
    process.env.PATH = pathWith(shadow);
    try {
      await signalsRefused(() => endTreeOf(4242, seams));
    } finally {
      process.env.PATH = realPath;
    }
    const call = onlyCall(calls);
    expect(samePath(call.file, TASKKILL, 'win32'), `the program is ${TASKKILL}, got: ${call.file}`).toBeTruthy();
    expect(JSON.stringify(call.args), 'the whole tree, forced, by pid').toBe(JSON.stringify(['/T', '/F', '/PID', '4242']));
  });

  test('a taskkill that cannot start rejects the end, naming why', async () => {
    const { seams, calls } = windowsArm(null);
    const err = await signalsRefused(() => caught(() => endTreeOf(4242, seams)));
    const cause = `spawnSync ${onlyCall(calls).file} ENOENT`;
    expect(err.message, 'the reject line carries the start error').toBe(`tree.js: taskkill could not run (${cause})`);
  });

  test('with no SystemRoot the end rejects with the line that names it', async () => {
    const { seams } = windowsArm(0, {});
    const realRoot = process.env.SystemRoot;
    delete process.env.SystemRoot;
    try {
      const err = await signalsRefused(() => caught(() => endTreeOf(4242, seams)));
      expect(err.message, 'the reject names SystemRoot').toBe('tree.js: SystemRoot is not set, so taskkill cannot be found');
    } finally {
      if (realRoot !== undefined) process.env.SystemRoot = realRoot;
    }
  });

  test('the taskkill call is bounded at 60 seconds', async () => {
    const { seams, calls } = windowsArm(0);
    await signalsRefused(() => endTreeOf(4242, seams));
    expect(onlyCall(calls).options.timeout, 'the timeout taskkill runs under, in ms').toBe(60000);
  });

  test('a taskkill that hangs to its timeout rejects the end as one that could not run', async () => {
    const { seams, calls } = windowsArm('hang');
    const err = await signalsRefused(() => caught(() => endTreeOf(4242, seams)));
    const cause = `spawnSync ${onlyCall(calls).file} ETIMEDOUT`;
    expect(err?.message, 'the reject line carries the timeout').toBe(`tree.js: taskkill could not run (${cause})`);
  });

  test('a taskkill that exits nonzero still resolves the end, as it does for a tree already gone', async () => {
    const { seams, calls } = windowsArm(128);
    let rejected;
    await signalsRefused(() => endTreeOf(4242, seams)).catch((err) => { rejected = err; });
    expect(rejected?.message, 'the end resolves').toBe(undefined);
    onlyCall(calls);
  });

  test('the published endTree runs the same program with the same arguments as endTreeOf', async () => {
    const home = windowsArm(0);
    const published = windowsArm(0);
    await signalsRefused(async () => {
      await endTreeOf(4242, home.seams);
      await endTree(4242, 'SIGKILL', published.seams);
    });
    const [a, b] = [onlyCall(home.calls), onlyCall(published.calls)];
    expect(JSON.stringify([b.file, ...b.args]), 'endTree matches endTreeOf').toBe(JSON.stringify([a.file, ...a.args]));
  });
});

describe('tree: the end command', () => {
  test('node tree.js end <pid> ends a live process and exits 0', {
    skip: IS_WINDOWS && 'off Windows only; on Windows the command is one real taskkill, its arm answered above',
  }, async () => {
    // No start() watchdog: it would end the child at the deadline `until` waits on.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30);'], { detached: true, stdio: 'ignore' });
    try {
      expect(alive(child.pid), 'the process is alive before the command').toBeTruthy();
      const res = run(process.execPath, [TREE, 'end', String(child.pid)]);
      expect(res.status, `the command exits 0, output: ${res.output}`).toBe(0);
      expect(await until(() => !alive(child.pid)), `the process ${child.pid} is gone`).toBeTruthy();
    } finally {
      endTree(child.pid, 'SIGKILL');
    }
  });

  test('node tree.js with no arguments prints a usage line and exits 2', () => {
    const res = run(process.execPath, [TREE]);
    expect(res.status, `the command exits 2, output: ${res.output}`).toBe(2);
    expect(/usage/i.test(res.output), `a usage line is printed, got: ${JSON.stringify(res.output)}`).toBeTruthy();
  });
});
