// Tests for safety:proof-guard's package ids through the real facts: proofFacts
// in hooks/mods/proof-guard.js built from the machine's io (workflow/lib/io.js)
// as the gh shim's gate builds them, so a package's record line is read against
// its own id, the tree hashed less the members it neither is nor depends on.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const {
  NODE_DIR, shellPath, joinPath, runsProgram,
} = require('../../lib/platform');
const { mkRepo } = require('../../lib/script-shell');
const { treeHash, plantPkgRecord } = require('../../lib/suite-record');
const { scratchWorkflowHome } = require('../../lib/workflow-home');
const {
  flip, QA_BLOCK, assertBlocks, passText,
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

// The repo every case reads, never edited, so one serves them all; each case plants its own record.
let world;
const repo = () => {
  if (world) return world;
  const dir = mkRepo({ private: true, workspaces: ['packages/*'] }, WORKSPACES);
  fs.mkdirSync(path.join(dir, 'packages', 'a', 'test'));
  fs.writeFileSync(path.join(dir, 'packages', 'a', 'test', 'a.test.js'), 'require("../index.js");\n');
  world = { dir, ownId: treeHash(dir, ['packages/b', 'packages/c']), wholeId: treeHash(dir) };
  expect(world.ownId !== world.wholeId, 'a\'s own id is not the whole tree\'s').toBeTruthy();
  return world;
};

// The suite's own session (HOME as it runs, node first on PATH, WORKKIT_NODE dropped) over a scratch workflow home.
const ownSession = (workflowHome) => {
  const env = { ...process.env, WORKFLOW_HOME: shellPath(workflowHome), PATH: joinPath(NODE_DIR, process.env.PATH) };
  delete env.WORKKIT_NODE;
  return env;
};

describe('proof-guard: a package\'s record line read against its own id, through the real facts', () => {
  test('in the suite\'s own session, a line on packages/a\'s own id passes the qa flip; the same line on the whole tree\'s id blocks, naming packages/a', async () => {
    const { dir, ownId, wholeId } = repo();
    const { workflowHome } = scratchWorkflowHome('pkg-tree-home-');
    const env = ownSession(workflowHome);

    plantPkgRecord(workflowHome, dir, ['packages/a'], ownId);
    const msg = passText(await flip(dir, env), 'the line on a\'s own id');
    expect(msg.includes('packages/a (1 file(s))'), `the notice names packages/a, got: ${msg}`).toBeTruthy();

    plantPkgRecord(workflowHome, dir, ['packages/a'], wholeId);
    assertBlocks(await flip(dir, env), QA_BLOCK(1, 'packages/a: test/a.test.js'), 'the line on the whole tree\'s id is stale for a');
  });

  test('the flip takes packages/a\'s id with node running tree-hash.js, and starts no bash', async () => {
    const { dir, ownId } = repo();
    const { workflowHome } = scratchWorkflowHome('pkg-tree-node-');
    plantPkgRecord(workflowHome, dir, ['packages/a'], ownId);
    const calls = [];
    passText(await flip(dir, ownSession(workflowHome), (argv) => { calls.push([...argv]); }), 'the line on a\'s own id');
    const hashes = calls.filter((argv) => argv.some((a) => a.endsWith('tree-hash.js')));
    expect(hashes.some((argv) => argv.includes('packages/a')), `a tree-hash.js child for packages/a, got: ${JSON.stringify(calls)}`).toBeTruthy();
    expect(hashes.every((argv) => runsProgram(argv, 'node')), `each tree-hash.js child is node, got: ${JSON.stringify(hashes)}`).toBeTruthy();
    expect(JSON.stringify(calls.filter((argv) => runsProgram(argv, 'bash'))), 'no child is bash').toBe('[]');
  });
});
