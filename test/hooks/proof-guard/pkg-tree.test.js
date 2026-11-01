// Tests for safety:proof-guard's package ids through the real facts: proofFacts
// in hooks/mods/proof-guard.js built from the machine's io (workflow/lib/io.js)
// as the gh shim's gate builds them, so a package's record line is read against
// its own id, the tree hashed less the members it neither is nor depends on.

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, mkTmp, summary, selfRun,
} = require('../../lib/harness');
const { shellPath, basePathWithout } = require('../../lib/platform');
const { mkRepo } = require('../../lib/script-shell');
const { treeHash, plantPkgRecord } = require('../../lib/suite-record');
const { scratchWorkflowHome } = require('../../lib/workflow-home');
const {
  flip, QA_BLOCK, WHOLE_TREE, assertBlocks, passText, denyOf,
} = require('./helpers');

// A committed workspaces repo: members a, b and c under packages/, c depending on a, a with a test script.
const WORKSPACES = {
  'packages/a/package.json': { name: 'a', version: '1.0.0', scripts: { test: 'node test/a.test.js' } },
  'packages/a/index.js': 'module.exports = 1;\n',
  'packages/b/package.json': { name: 'b', version: '1.0.0' },
  'packages/b/index.js': 'module.exports = 2;\n',
  'packages/c/package.json': { name: 'c', version: '1.0.0', dependencies: { a: '1.0.0' } },
  'packages/c/index.js': 'module.exports = 3;\n',
};

// The child's own line when it finds no node and keys packages/a to the whole tree.
const NO_NODE = 'tree-hash: no node 22.12 or newer found; packages/a keyed to the whole tree';

// The repo every case reads, never edited, so one serves them all; each case plants its own record.
let world;
const repo = () => {
  if (world) return world;
  const dir = mkRepo({ private: true, workspaces: ['packages/*'] }, WORKSPACES);
  fs.mkdirSync(path.join(dir, 'packages', 'a', 'test'));
  fs.writeFileSync(path.join(dir, 'packages', 'a', 'test', 'a.test.js'), 'require("../index.js");\n');
  world = { dir, ownId: treeHash(dir, ['packages/b', 'packages/c']), wholeId: treeHash(dir) };
  assert(world.ownId !== world.wholeId, 'a\'s own id is not the whole tree\'s');
  return world;
};

// The suite's own session (HOME and PATH as it runs, WORKKIT_NODE dropped) over a scratch workflow home.
const ownSession = (workflowHome) => {
  const env = { ...process.env, WORKFLOW_HOME: shellPath(workflowHome) };
  delete env.WORKKIT_NODE;
  return env;
};

// A session whose node is out of reach: the system PATH mirrored less node, a scratch HOME with no nvm.
const noNodeSession = (homeEnv) => {
  const env = { ...process.env, ...homeEnv, PATH: basePathWithout(mkTmp('pkg-tree-'), 'node') };
  delete env.WORKKIT_NODE;
  return env;
};

const cases = async () => {
  group('proof-guard: a package\'s record line read against its own id, through the real facts');

  await test('in the suite\'s own session, a line on packages/a\'s own id passes the qa flip; the same line on the whole tree\'s id blocks, naming packages/a', async () => {
    const { dir, ownId, wholeId } = repo();
    const { workflowHome } = scratchWorkflowHome('pkg-tree-home-');
    const env = ownSession(workflowHome);

    plantPkgRecord(workflowHome, dir, ['packages/a'], ownId);
    const msg = passText(await flip(dir, env), 'the line on a\'s own id');
    assert(msg.includes('packages/a (1 file(s))'), `the notice names packages/a, got: ${msg}`);

    plantPkgRecord(workflowHome, dir, ['packages/a'], wholeId);
    assertBlocks(await flip(dir, env), QA_BLOCK(1, 'packages/a: test/a.test.js'), 'the line on the whole tree\'s id is stale for a');
  });

  await test('a session that cannot reach node keys packages/a to the whole tree: the flip on a\'s own id is denied, the denial saying why and naming the fix', async () => {
    const { dir, ownId } = repo();
    const { workflowHome, env: homeEnv } = scratchWorkflowHome('pkg-tree-nonode-');
    plantPkgRecord(workflowHome, dir, ['packages/a'], ownId);
    const deny = denyOf(await flip(dir, noNodeSession(homeEnv)));
    assert(deny !== null, 'the flip is denied');
    const [head] = QA_BLOCK(1).split('\n');
    assert(deny.split('\n')[0].startsWith(head), `the qa denial's head first, got: ${deny}`);
    assert(deny.includes(WHOLE_TREE(NO_NODE)), `the sentence carries the child's line, got: ${deny}`);
    assert(deny.indexOf(WHOLE_TREE(NO_NODE)) < deny.indexOf('packages/a: test/a.test.js'), `the sentence comes after the head, before the files, got: ${deny}`);
  });

  await test('the whole-tree fallback on both sides, the record written on the whole tree\'s id and read by a session that cannot reach node: the flip passes, no sentence', async () => {
    const { dir, wholeId } = repo();
    const { workflowHome, env: homeEnv } = scratchWorkflowHome('pkg-tree-both-');
    plantPkgRecord(workflowHome, dir, ['packages/a'], wholeId);
    const msg = passText(await flip(dir, noNodeSession(homeEnv)), 'the writer and the gate agree on the whole tree');
    assert(msg.includes('packages/a (1 file(s))'), `the notice names packages/a, got: ${msg}`);
    assert(!msg.includes('keyed to the whole tree'), `no fallback sentence on a pass, got: ${msg}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
