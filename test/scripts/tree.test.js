// Tests for workflow/lib/tree.js's treeOf: the processes under a pid by parent,
// a child in its own session included and an unrelated process left out, each
// with the processor time it has used so far.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun, skipSuite, mkTmp, until, start,
} = require('../lib/harness');
const { IS_WINDOWS } = require('../lib/platform');
const { NO_PROCESS_READ, pidIn, reap } = require('../lib/supervise');

const { treeOf } = require(path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree.js'));

const PLATFORM = path.join(__dirname, '..', 'lib', 'platform.js');

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
  assert(await until(() => names.every(pidOf)), `every process wrote its pid: ${names.filter((n) => !pidOf(n)).join(', ')} did not`);
  return { handle, pids: Object.fromEntries(names.map((name) => [name, pidOf(name)])) };
};

const cases = async () => {
  if (IS_WINDOWS) skipSuite(NO_PROCESS_READ);

  group('tree: treeOf');

  await test('a grandchild and a child in its own session are listed, each by its parent; an unrelated process is not', async () => {
    const dir = mkTmp('tree-list-');
    const other = mkTmp('tree-other-');
    const kids = [['child', false, [['grandchild', false, []]]], ['session', true, []]];
    const { handle, pids } = await startTree(dir, kids, ['root', 'child', 'grandchild', 'session']);
    const unrelated = await startTree(other, [], ['root']);
    try {
      const entries = treeOf(pids.root);
      const byPid = (pid) => entries.find((e) => e.pid === pid);
      const listed = entries.map((e) => e.pid).join(', ');
      assert(byPid(pids.grandchild), `the grandchild ${pids.grandchild} is listed, got: ${listed}`);
      assertEq(byPid(pids.grandchild).ppid, pids.child, 'the grandchild\'s parent is the child');
      assert(byPid(pids.session), `the child in its own session ${pids.session} is listed, got: ${listed}`);
      assertEq(byPid(pids.session).ppid, pids.root, 'its parent is the root');
      assert(!byPid(unrelated.pids.root), `the unrelated ${unrelated.pids.root} is not listed, got: ${listed}`);
      const named = entries.filter((e) => typeof e.command === 'string' && e.command.includes('node'));
      assertEq(named.length, entries.length, `every entry names its command, got: ${JSON.stringify(entries)}`);
    } finally {
      reap(...Object.values(pids), unrelated.pids.root);
      await Promise.all([handle.end('SIGKILL'), unrelated.handle.end('SIGKILL')]);
    }
  });

  await test('a process that keeps a processor busy shows a growing cpu', async () => {
    const dir = mkTmp('tree-busy-');
    const { handle, pids } = await startTree(dir, [['busy', false, []]], ['root', 'busy']);
    try {
      const cpuOf = () => (treeOf(pids.root).find((e) => e.pid === pids.busy) || {}).cpu;
      const first = cpuOf();
      assertEq(typeof first, 'number', `the busy process is listed with a cpu, got: ${JSON.stringify(treeOf(pids.root))}`);
      assert(await until(() => cpuOf() > first), `its cpu never grew past ${first}`);
    } finally {
      reap(...Object.values(pids));
      await handle.end('SIGKILL');
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
