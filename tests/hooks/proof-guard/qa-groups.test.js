// Tests for hooks/safety/proof-guard at the flip to status:qa over packages:
// each package that owns a touched test file needs its own line in the package
// record on this tree, the root's `.` included, and one missing blocks naming
// the package and its files, with npm test narrowed to them as a hint.

const { group, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  dropPathWithoutGh, ranNothing, write, touch, addPkg, plantPkgRecord, recordCase, notice,
} = require('./helpers');

const CLIENT = 'packages/client';
const SERVER = 'packages/server';

// The two nested packages, each with a touched test file.
const twoPackages = (dir) => {
  addPkg(dir, CLIENT);
  addPkg(dir, SERVER);
  touch(dir, `${CLIENT}/test/a.test.js`);
  touch(dir, `${SERVER}/test/b.test.js`);
};

const run = async () => {
  group('proof-guard: every touched package needs its own record on the tree');

  await recordCase('every touched package recorded: exit 0, the notice names each package', ({ dir, tmp, flip }) => {
    twoPackages(dir);
    plantPkgRecord(tmp, dir, [CLIENT, SERVER]);
    const out = flip();
    assertEq(out.code, 0, `every package is proved, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.startsWith('proof-guard:'), `the notice carries the prefix, got: ${msg}`);
    for (const pkg of [CLIENT, SERVER]) assert(msg.includes(pkg), `names ${pkg}, got: ${msg}`);
    assert(ranNothing(dir), 'nothing ran');
  });

  await recordCase('the root and a nested package both recorded: exit 0', ({ dir, tmp, flip }) => {
    addPkg(dir, CLIENT);
    touch(dir, 'tests/a.test.js');
    touch(dir, `${CLIENT}/test/a.test.js`);
    plantPkgRecord(tmp, dir, ['.', CLIENT]);
    const out = flip();
    assertEq(out.code, 0, `both are proved, got: ${out.stderr}`);
    assert(notice(out).includes(CLIENT), `names the nested package, got: ${out.stdout}`);
  });

  await recordCase('one package missing: exit 2, naming it and its files, with the narrowed npm test as a hint', ({ dir, tmp, flip }) => {
    twoPackages(dir);
    touch(dir, `${SERVER}/test/c.test.js`);
    plantPkgRecord(tmp, dir, [CLIENT]);
    const out = flip();
    assertEq(out.code, 2, `the server package has no record, got: ${out.code} ${out.stderr}`);
    assertEq(out.stdout, '', `a block speaks on stderr alone, got: ${out.stdout}`);
    const [head, ...lines] = out.stderr.trim().split('\n');
    assert(head.startsWith('proof-guard: BLOCKED'), `the block carries the prefix, got: ${head}`);
    assert(head.includes('the 2 touched test file(s) below'), `the first line counts the missing files, got: ${head}`);
    assert(head.includes('`npm test -- <files>` from that folder'), `the first line names the narrowed run as a hint, got: ${head}`);
    assert(!head.includes('covers them all'), `a root run is refused while building, so never offered, got: ${head}`);
    // The files are the package's own, relative to the folder its npm test runs from.
    assertEq(lines.join('\n'), `${SERVER}: test/b.test.js test/c.test.js`, 'one line per missing package, never a ready command');
    assert(!out.stderr.includes(`${CLIENT}/test/a.test.js`), `the recorded package is never asked for, got: ${out.stderr}`);
    assert(ranNothing(dir), 'nothing ran');
  });

  await recordCase("a nested package's file needs its own folder's line: the root's does not cover it", ({ dir, tmp, flip }) => {
    addPkg(dir, CLIENT);
    touch(dir, `${CLIENT}/test/a.test.js`);
    plantPkgRecord(tmp, dir, ['.']);
    const out = flip();
    assertEq(out.code, 2, `the root line is not the package's, got: ${out.code} ${out.stderr}`);
    assert(out.stderr.includes(`${CLIENT}: test/a.test.js`), `names the package and its file, got: ${out.stderr}`);
    plantPkgRecord(tmp, dir, ['.', CLIENT]);
    assertEq(flip().code, 0, 'its own line passes the flip');
  });

  await recordCase('a root with no test script and a touched nested package: the package is still checked, the root file named not provable', ({ dir, tmp, flip }) => {
    write(dir, 'package.json', `${JSON.stringify({ name: 'fixture' })}\n`);
    addPkg(dir, CLIENT);
    touch(dir, 'tests/a.test.js');
    touch(dir, `${CLIENT}/test/a.test.js`);
    const out = flip();
    assertEq(out.code, 2, `the nested package has no record, got: ${out.code} ${out.stderr}`);
    assert(out.stderr.includes(`${CLIENT}: test/a.test.js`), `names the package and its file, got: ${out.stderr}`);
    assert(!out.stderr.includes('the repo root:'), `the root with no test script is never asked for, got: ${out.stderr}`);
    plantPkgRecord(tmp, dir, [CLIENT]);
    const passed = flip();
    assertEq(passed.code, 0, `the package's line passes the flip, got: ${passed.stderr}`);
    const msg = notice(passed);
    const at = msg.indexOf('Cannot be proved by npm test');
    assert(at > -1 && msg.indexOf('tests/a.test.js', at) > -1, `the root file is named as not provable by npm test, got: ${msg}`);
  });

  await recordCase('a touched file whose path holds a space: listed as is, never quoted', ({ dir, flip }) => {
    addPkg(dir, CLIENT);
    touch(dir, `${CLIENT}/test/a b.test.js`);
    touch(dir, `${CLIENT}/test/c.test.js`);
    const out = flip();
    assertEq(out.code, 2, `no record blocks, got: ${out.code} ${out.stderr}`);
    assert(out.stderr.includes(`${CLIENT}: test/a b.test.js test/c.test.js`), `both paths listed as they are, got: ${out.stderr}`);
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
