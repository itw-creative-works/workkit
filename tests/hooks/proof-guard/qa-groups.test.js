// Tests for safety:proof-guard at the flip to status:qa over packages,
// proofGuardVerdict's `packages` and `rootOnly` facts: each package owning a
// touched test file needs its own line in the package record on this tree,
// the root's `.` included; a package the settings declare in proof.rootOnly
// is proved by the root run alone. Each case ports the HEAD case its name quotes.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  packagesOf, pkgRecord, judge, QA, QA_BLOCK, SHAPE_NOTE, ROOT_ONLY, assertBlocks, passText,
} = require('./helpers');

const CLIENT = 'packages/client';
const SERVER = 'packages/server';
const BACKEND = 'packages/backend';

const flip = (touched, pkgs, over = {}) => judge(QA, { touched, packages: packagesOf(pkgs), ...over });

const run = async () => {
  group('proof-guard: every touched package needs its own record on the tree');

  await test('ports "every touched package recorded: exit 0, the notice names each package"', async () => {
    const msg = passText(await flip([`${CLIENT}/test/a.test.js`, `${SERVER}/test/b.test.js`], [CLIENT, SERVER],
      { packageRecord: pkgRecord([CLIENT, SERVER]) }), 'both recorded');
    assert(msg.startsWith(`proof-guard: every touched test file has a green npm test recorded on this tree: ${CLIENT} (1 file(s)), ${SERVER} (1 file(s)).`),
      `names each package, got: ${msg}`);
  });

  await test('ports "the root and a nested package both recorded: exit 0"', async () => {
    const msg = passText(await flip([`${CLIENT}/test/a.test.js`, 'tests/a.test.js'], [CLIENT],
      { packageRecord: pkgRecord(['.', CLIENT]) }), 'both recorded');
    assert(msg.includes(CLIENT) && msg.includes('the repo root (1 file(s))'), `names both, got: ${msg}`);
  });

  await test('ports "one package missing: exit 2, naming it and its files, with the narrowed npm test as a hint"', async () => {
    const r = await flip([`${CLIENT}/test/a.test.js`, `${SERVER}/test/b.test.js`, `${SERVER}/test/c.test.js`], [CLIENT, SERVER],
      { packageRecord: pkgRecord([CLIENT]) });
    assertBlocks(r, QA_BLOCK(2, `${SERVER}: test/b.test.js test/c.test.js`), 'one line per missing package, the files its own');
  });

  await test('ports "a nested package\'s file needs its own folder\'s line: the root\'s does not cover it"', async () => {
    const touched = [`${CLIENT}/test/a.test.js`];
    assertBlocks(await flip(touched, [CLIENT], { packageRecord: pkgRecord(['.']) }),
      QA_BLOCK(1, `${CLIENT}: test/a.test.js`), 'the root line is not the package\'s');
    passText(await flip(touched, [CLIENT], { packageRecord: pkgRecord(['.', CLIENT]) }), 'its own line');
  });

  await test('ports "a root with no test script and a touched nested package: the package is still checked, the root file named not provable"', async () => {
    const touched = [`${CLIENT}/test/a.test.js`, 'tests/a.test.js'];
    const packages = packagesOf([CLIENT], false);
    assertBlocks(await judge(QA, { touched, packages }), QA_BLOCK(1, `${CLIENT}: test/a.test.js`), 'the root is never asked for');
    const msg = passText(await judge(QA, { touched, packages, packageRecord: pkgRecord([CLIENT]) }), 'the package line');
    assert(msg.includes('Cannot be proved by npm test, since the repo root has no test script, so not required: tests/a.test.js.'),
      `the root file is named as not provable by npm test, got: ${msg}`);
  });

  await test('ports "a touched file whose path holds a space: listed as is, never quoted"', async () => {
    assertBlocks(await flip([`${CLIENT}/test/a b.test.js`, `${CLIENT}/test/c.test.js`], [CLIENT]),
      QA_BLOCK(2, `${CLIENT}: test/a b.test.js test/c.test.js`), 'both paths as they are');
  });

  group('proof-guard: a package declared in settings proof.rootOnly');

  await test('ports "a touched test file in a declared package with no record: exit 0, the notice names it as proved by the root run"', async () => {
    const msg = passText(await flip([`${BACKEND}/test/a.test.js`], [BACKEND], { rootOnly: [BACKEND] }), 'declared');
    assertEq(msg.startsWith(`proof-guard: no touched test file needs a package record on this tree. The root npm test before the commit is the proof of the package(s) the settings declare: ${ROOT_ONLY}: ${BACKEND}.`),
      true, `the notice names the declared package, got: ${msg}`);
  });

  await test('ports "a declared package beside an undeclared one, neither recorded: exit 2, naming only the undeclared one"', async () => {
    assertBlocks(await flip([`${BACKEND}/test/a.test.js`, `${CLIENT}/test/b.test.js`], [BACKEND, CLIENT], { rootOnly: [BACKEND] }),
      QA_BLOCK(1, `${CLIENT}: test/b.test.js`), 'the declared package is never asked for');
  });

  await test('ports "settings with no proof key: a touched package with no record blocks, as with no settings"', async () => {
    assertBlocks(await flip([`${BACKEND}/test/a.test.js`], [BACKEND], { rootOnly: undefined }),
      QA_BLOCK(1, `${BACKEND}: test/a.test.js`), 'nothing is declared');
  });

  await test('ports "\\".\\" declared covers a test file the root owns: exit 0, the notice names the root"', async () => {
    const msg = passText(await flip(['tests/a.test.js'], [], { rootOnly: ['.'] }), 'the root declared');
    assert(msg.includes(`${ROOT_ONLY}: .`), `the notice names the root, got: ${msg}`);
  });

  for (const rootOnly of [BACKEND, [BACKEND, 7]]) {
    await test(`ports "a rootOnly that is not an array of strings (${JSON.stringify(rootOnly)}): one notice naming the key, checked as if nothing were declared"`, async () => {
      const touched = [`${BACKEND}/test/a.test.js`];
      assertBlocks(await flip(touched, [BACKEND], { rootOnly }), QA_BLOCK(1, `${BACKEND}: test/a.test.js`, SHAPE_NOTE),
        'the package is not declared, the note under the block');
      const msg = passText(await flip(touched, [BACKEND], { rootOnly, packageRecord: pkgRecord([BACKEND]) }), 'its own line');
      assertEq(msg.split('proof.rootOnly').length - 1, 1, `one mention of the key, got: ${msg}`);
      assert(msg.includes(SHAPE_NOTE), `the note itself, got: ${msg}`);
      assert(!msg.includes(ROOT_ONLY), `nothing is named as proved by the root run, got: ${msg}`);
    });
  }
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
