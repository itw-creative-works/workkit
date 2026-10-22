// Tests for the staleness of the records safety:proof-guard reads at the flip
// to status:qa: both are keyed by the working tree's id, so proofGuardVerdict
// passes a record only while its first line is `treeId`. Each case ports the
// HEAD case its name quotes; how an edit changes the id is tree-hash.sh's, and
// "the flip writes no record" is tests/mods/guards-proof-guard.test.ts.

const { group, test, summary, selfRun } = require('../../lib/harness');
const {
  TREE, OTHER_TREE, pkgRecord, suiteRecord, judge, QA, QA_BLOCK, assertBlocks, passText,
} = require('./helpers');

const TOUCHED = ['tests/a.test.js'];
const ON_ROOT = QA_BLOCK(1, 'the repo root: tests/a.test.js');

const flip = (over) => judge(QA, { touched: TOUCHED, ...over });

const run = async () => {
  group('proof-guard: a record holds only the tree it was written on');

  await test('ports "a tracked edit after the record" and "a new untracked file after the record": a tree id the root line was not written on blocks', async () => {
    passText(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: TREE }), 'the record on this tree');
    assertBlocks(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: OTHER_TREE }), ON_ROOT, 'the tree changed');
  });

  await test('ports "an edit undone byte for byte: the record holds the tree again"', async () => {
    assertBlocks(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: OTHER_TREE }), ON_ROOT, 'the edited tree');
    passText(await flip({ packageRecord: pkgRecord(['.'], TREE), treeId: TREE }), 'the tree id is the content, not its history');
  });

  await test('ports "a package record whose first line is another tree: blocks, though it lists the package"', async () => {
    assertBlocks(await flip({ packageRecord: pkgRecord(['.'], OTHER_TREE) }), ON_ROOT, 'the record is another tree\'s');
  });

  await test('ports "a whole suite record for another tree: blocks"', async () => {
    passText(await flip({ suiteRecord: suiteRecord(TREE) }), 'the suite record on this tree');
    assertBlocks(await flip({ suiteRecord: suiteRecord(OTHER_TREE) }), ON_ROOT, 'the suite record is another tree\'s');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
