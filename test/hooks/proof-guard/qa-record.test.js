// Tests for the staleness of the records safety:proof-guard reads at the flip to
// status:qa: the suite record and the root's `.` line are keyed by the working
// tree's id, so proofVerdict passes them only while they hold `treeId`. How an
// edit changes the id is tree-hash.sh's; a package's own id, ./qa-groups.test.js
// (stubbed) and ./pkg-tree.test.js (real facts).

const path = require('path');
const fs = require('fs');
const { group, test, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { mkRepo } = require('../../lib/script-shell');
const { plantPkgRecord } = require('../../lib/suite-record');
const { runLib } = require('../../lib/hook-lib');
const { scratchWorkflowHome } = require('../../lib/workflow-home');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const {
  TREE, OTHER_TREE, pkgRecord, suiteRecord, judge, QA, flip: realFlip, QA_BLOCK, assertBlocks, passText,
} = require('./helpers');

const TOUCHED = ['tests/a.test.js'];
const ON_ROOT = QA_BLOCK(1, 'the repo root: tests/a.test.js');

const flip = (over) => judge(QA, { touched: TOUCHED, ...over });

const cases = async () => {
  group('proof-guard: a record holds only the tree it was written on');

  await test('a tracked edit or a new untracked file after the record: a tree id the root line was not written on blocks', async () => {
    passText(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: TREE }), 'the record on this tree');
    assertBlocks(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: OTHER_TREE }), ON_ROOT, 'the tree changed');
  });

  await test('a whole suite record for another tree: blocks', async () => {
    passText(await flip({ suiteRecord: suiteRecord(TREE) }), 'the suite record on this tree');
    assertBlocks(await flip({ suiteRecord: suiteRecord(OTHER_TREE) }), ON_ROOT, 'the suite record is another tree\'s');
  });

  await test('the settings losing its version key and a suite log written after the record: the flip passes; a code edit then blocks', async () => {
    const dir = mkRepo({ scripts: { test: 'node test/a.test.js' } }, { '.workkit/settings.json': '{\n  "version": 9,\n  "enabled": true\n}\n' });
    fs.mkdirSync(path.join(dir, 'test'));
    fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), "require('../app.js');\n");
    const { workflowHome, env: homeEnv } = scratchWorkflowHome('qa-record-home-');
    const env = { ...process.env, ...homeEnv, WORKKIT_NODE: shellPath(process.execPath) };
    const recorded = runLib(`wk_tree_hash "${shellPath(dir)}"`, env).stdout.trim();
    plantPkgRecord(workflowHome, dir, ['.'], recorded);

    fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    fs.writeFileSync(path.join(dir, '.workkit', 'suite.log'), 'script-shell: exit 0\n');
    passText(await realFlip(dir, env), 'the record still covers the tree');

    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    assertBlocks(await realFlip(dir, env), QA_BLOCK(1, 'the repo root: test/a.test.js'), 'a code edit is a new tree');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
