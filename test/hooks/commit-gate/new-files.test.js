// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: new source files need tests (the test-type
// proxy, check 1). Each case ports the HEAD case its name quotes; every HEAD
// case's mechanism survives.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, summary, selfRun } = require('../../lib/harness');
const {
  ROOT, T, NOTICE, mkRepo, stage, gitRm, commit, touchMarker, proveTree, judge, blocks, passes,
} = require('./helpers');

const TEST_SCRIPT = '{"scripts":{"test":"exit 0"}}';

const run = async () => {
  group('commit-gate: new source files need tests (test-TYPE proxy)');

  await test('ports "new .js file, no test file staged: exit 2"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'git commit -m "x"'), T.newFiles('thing.js'), 'new source without tests must block, naming the file');
  });

  await test('ports "new .js file WITH a test file staged: exit 0"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    stage(r, 'thing.test.js', 'require("./thing");\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'git commit -m "x"'), NOTICE.proved, 'a test file present passes');
  });

  await test('ports "new .js file in a repo with NO test script: proxy skipped, exit 0"', async () => {
    const r = mkRepo();
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'git commit -m "x"'), '', 'repos without a test script are not asked to start here');
  });

  await test('ports "MODIFIED .js file (not added): proxy skipped, exit 0"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    commit(r);
    stage(r, 'thing.js', 'module.exports = 2;\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'git commit -m "x"'), NOTICE.proved, 'only ADDED files trigger the proxy');
  });

  await test('ports "commit from a SUBDIRECTORY is gated identically (review regression)"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'git commit -m "x"', { cwd: `${ROOT}/src` }), T.newFiles('thing.js'), 'a subdirectory cwd must not skip the proxy');
  });

  await test('ports "staged test-file DELETION does not satisfy the proxy (review regression)"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'tests/old.test.js', 'x;\n');
    commit(r);
    gitRm(r, 'tests/old.test.js');
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'git commit -m "x"'), T.newFiles('thing.js'), 'a deleted test file is not "touching tests"');
  });

  await test('ports "new config/test-named files are exempt: exit 0"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'eslint.config.mjs', 'export default [];\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'git commit -m "x"'), NOTICE.proved, 'config files need no tests');
  });

  await test('ports "a new non-ASCII file name is named unquoted: exit 2"', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'café.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'git commit -m "x"'), T.newFiles('café.js'), 'names the file as spelled');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
