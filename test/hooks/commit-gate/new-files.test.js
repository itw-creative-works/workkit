// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in
// hooks/mods/commit-gate.js: new source files need tests (the test-type
// proxy, check 1).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const path = require('path');
const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const {
  PREFIX, T, NOTICE, mkRepo, stage, gitRm, commit, touchMarker, proveTree, judge, denyOf, blocks, passes,
} = require('./helpers');

const TEST_SCRIPT = '{"scripts":{"test":"exit 0"}}';

const cases = async () => {
  group('commit-gate: new source files need tests (test-TYPE proxy)');

  await test('new .js file, no test file staged: exit 2', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'x'), T.newFiles('thing.js'), 'new source without tests must block, naming the file');
  });

  await test('the new-files read failing or not starting: the commit is held naming the read, never passed', async () => {
    const answers = [['exited 128', { exitCode: 128, stderr: 'fatal: the stub cannot list\n' }], ['did not start', { isStarted: false, stderr: 'spawn git ENOENT' }]];
    for (const [said, answer] of answers) {
      const r = mkRepo();
      stage(r, 'package.json', TEST_SCRIPT);
      stage(r, 'thing.js', 'module.exports = 1;\n');
      stage(r, 'thing.test.js', 'require("./thing");\n');
      touchMarker(r);
      proveTree(r);
      r.failOn = (argv) => (path.basename(argv[0]) === 'git' && argv.includes('--cached') && argv.some((a) => /^--diff-filter=.*A/.test(a)) ? answer : null);
      const deny = denyOf(await judge(r, 'x'));
      assert(deny !== null && deny.startsWith(PREFIX), `${said}: the commit is held, got: ${deny}`);
      assert(new RegExp(`could not run: \`git [^\`]*--diff-filter=[^\`]*\` ${said}`).test(deny), `${said}: naming the read, got: ${deny}`);
    }
  });

  await test('new .js file WITH a test file staged: exit 0', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    stage(r, 'thing.test.js', 'require("./thing");\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'x'), NOTICE.proved, 'a test file present passes');
  });

  await test('new .js file in a repo with NO test script: proxy skipped, exit 0', async () => {
    const r = mkRepo();
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'x'), '', 'repos without a test script are not asked to start here');
  });

  await test('MODIFIED .js file (not added): proxy skipped, exit 0', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'thing.js', 'module.exports = 1;\n');
    commit(r);
    stage(r, 'thing.js', 'module.exports = 2;\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'x'), NOTICE.proved, 'only ADDED files trigger the proxy');
  });

  await test('staged test-file DELETION does not satisfy the proxy', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'tests/old.test.js', 'x;\n');
    commit(r);
    gitRm(r, 'tests/old.test.js');
    stage(r, 'thing.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'x'), T.newFiles('thing.js'), 'a deleted test file is not "touching tests"');
  });

  await test('new config/test-named files are exempt: exit 0', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'eslint.config.mjs', 'export default [];\n');
    touchMarker(r);
    proveTree(r);
    passes(await judge(r, 'x'), NOTICE.proved, 'config files need no tests');
  });

  await test('a new non-ASCII file name is named unquoted: exit 2', async () => {
    const r = mkRepo();
    stage(r, 'package.json', TEST_SCRIPT);
    stage(r, 'café.js', 'module.exports = 1;\n');
    touchMarker(r);
    blocks(await judge(r, 'x'), T.newFiles('café.js'), 'names the file as spelled');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
