// Tests for the staleness of the records hooks/safety/proof-guard reads at the
// flip to status:qa: both are keyed by the working tree's id, so a record
// written for one tree never passes a flip after the tree changed, and the
// hook reads them and never writes one.
// The shared prologue (the hook runner, the gh stub, the fixtures) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  dropPathWithoutGh, write, touch, treeHash, plantRecord, plantPkgRecord, recordCase, notice,
} = require('./helpers');

// A touched root test file with the root's line recorded on this tree, the
// flip passing on it; hands back the record's path and its bytes.
const recordedRoot = (dir, tmp, flip) => {
  touch(dir, 'tests/a.test.js');
  const marker = plantPkgRecord(tmp, dir, ['.']);
  const before = fs.readFileSync(marker, 'utf8');
  assertEq(flip().code, 0, 'the record on this tree passes the flip');
  return { marker, before };
};

const blocksOnRoot = (out) => {
  assertEq(out.code, 2, `the record is another tree's, got: ${out.code} ${out.stderr}`);
  assert(out.stderr.includes('the repo root: tests/a.test.js'), `asks for the run again, got: ${out.stderr}`);
};

const run = async () => {
  group('proof-guard: a record holds only the tree it was written on');

  await recordCase('a tracked edit after the record: the package line no longer passes', ({ dir, tmp, flip }) => {
    recordedRoot(dir, tmp, flip);
    write(dir, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { test: 'node --test' } })}\n`);
    blocksOnRoot(flip());
  });

  await recordCase('a new untracked file after the record: the package line no longer passes', ({ dir, tmp, flip }) => {
    recordedRoot(dir, tmp, flip);
    write(dir, 'notes.txt', 'new\n');
    blocksOnRoot(flip());
  });

  await recordCase('an edit undone byte for byte: the record holds the tree again', ({ dir, tmp, flip }) => {
    recordedRoot(dir, tmp, flip);
    const pkg = path.join(dir, 'package.json');
    const before = fs.readFileSync(pkg);
    fs.writeFileSync(pkg, `${before}\n`);
    blocksOnRoot(flip());
    fs.writeFileSync(pkg, before);
    assertEq(flip().code, 0, 'the tree id is the content, not its history');
  });

  await recordCase('a package record whose first line is another tree: blocks, though it lists the package', ({ dir, tmp, flip }) => {
    touch(dir, 'tests/a.test.js');
    const stale = treeHash(dir);
    write(dir, 'notes.txt', 'new\n');
    plantPkgRecord(tmp, dir, ['.'], stale);
    blocksOnRoot(flip());
  });

  await recordCase('a whole suite record for another tree: blocks', ({ dir, tmp, flip }) => {
    touch(dir, 'tests/a.test.js');
    plantRecord(tmp, dir);
    assertEq(flip().code, 0, 'the suite record on this tree passes the flip');
    write(dir, 'notes.txt', 'new\n');
    blocksOnRoot(flip());
  });

  await recordCase('the flip writes no record: a passing flip leaves the package record as it was', ({ dir, tmp, flip }) => {
    const { marker, before } = recordedRoot(dir, tmp, flip);
    assert(notice(flip()).startsWith('proof-guard:'), 'a second flip passes the same way');
    assertEq(fs.readFileSync(marker, 'utf8'), before, 'the record is the script shell\'s, never the hook\'s');
    assert(!fs.existsSync(path.join(tmp, 'claude-suite-marker')), 'and no suite record is written');
    assert(!fs.existsSync(path.join(tmp, 'claude-qa-marker')), 'and no second record');
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
