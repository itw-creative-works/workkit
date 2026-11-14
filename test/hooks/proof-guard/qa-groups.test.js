// Tests for safety:proof-guard's flip to status:qa over packages (proofVerdict's
// `packages`, `pkgTree` and `rootOnly` facts): each package owning a touched test
// file needs its own package-record line on its own id, the root's `.` on the
// whole tree's, and a proof.rootOnly package is proved by the root run alone.

const { describe, test, expect } = require('../../lib/harness');
const {
  TREE, OTHER_TREE, packagesOf, pkgRecord, judge, denyOf, QA, QA_BLOCK, ROOT_ONLY, assertBlocks, passText,
} = require('./helpers');

const CLIENT = 'packages/client';
const SERVER = 'packages/server';
const BACKEND = 'packages/backend';

const flip = (touched, pkgs, over = {}) => judge(QA, { touched, packages: packagesOf(pkgs), ...over });

describe('proof-guard: every touched package needs its own record on the tree', () => {
  test('every touched package recorded: exit 0, the notice names each package', async () => {
    const msg = passText(await flip([`${CLIENT}/test/a.test.js`, `${SERVER}/test/b.test.js`], [CLIENT, SERVER],
      { packageRecord: pkgRecord([CLIENT, SERVER]) }), 'both recorded');
    expect(msg.startsWith(`proof-guard: every touched test file has a green npm test recorded on this tree: ${CLIENT} (1 file(s)), ${SERVER} (1 file(s)).`),
      `names each package, got: ${msg}`).toBeTruthy();
  });

  test('the root and a nested package both recorded: exit 0', async () => {
    const msg = passText(await flip([`${CLIENT}/test/a.test.js`, 'tests/a.test.js'], [CLIENT],
      { packageRecord: pkgRecord(['.', CLIENT]) }), 'both recorded');
    expect(msg.includes(CLIENT) && msg.includes('the repo root (1 file(s))'), `names both, got: ${msg}`).toBeTruthy();
  });

  test('one package missing: exit 2, naming it and its files, with the narrowed npm test as a hint', async () => {
    const r = await flip([`${CLIENT}/test/a.test.js`, `${SERVER}/test/b.test.js`, `${SERVER}/test/c.test.js`], [CLIENT, SERVER],
      { packageRecord: pkgRecord([CLIENT]) });
    assertBlocks(r, QA_BLOCK(2, `${SERVER}: test/b.test.js test/c.test.js`), 'one line per missing package, the files its own');
  });

  test('a nested package\'s file needs its own folder\'s line: the root\'s does not cover it', async () => {
    const touched = [`${CLIENT}/test/a.test.js`];
    assertBlocks(await flip(touched, [CLIENT], { packageRecord: pkgRecord(['.']) }),
      QA_BLOCK(1, `${CLIENT}: test/a.test.js`), 'the root line is not the package\'s');
    passText(await flip(touched, [CLIENT], { packageRecord: pkgRecord(['.', CLIENT]) }), 'its own line');
  });

  test('a root with no test script and a touched nested package: the package is still checked, the root file named not provable', async () => {
    const touched = [`${CLIENT}/test/a.test.js`, 'tests/a.test.js'];
    const packages = packagesOf([CLIENT], false);
    assertBlocks(await judge(QA, { touched, packages }), QA_BLOCK(1, `${CLIENT}: test/a.test.js`), 'the root is never asked for');
    const msg = passText(await judge(QA, { touched, packages, packageRecord: pkgRecord([CLIENT]) }), 'the package line');
    expect(msg.includes('Cannot be proved by npm test, since the repo root has no test script, so not required: tests/a.test.js.'),
      `the root file is named as not provable by npm test, got: ${msg}`).toBeTruthy();
  });

  test('a touched file whose path holds a space: listed as is, never quoted', async () => {
    assertBlocks(await flip([`${CLIENT}/test/a b.test.js`, `${CLIENT}/test/c.test.js`], [CLIENT]),
      QA_BLOCK(2, `${CLIENT}: test/a b.test.js test/c.test.js`), 'both paths as they are');
  });
});

describe('proof-guard: each package line is read against that package\'s own id', () => {
  // Each package's own id, apart from the whole tree's and from each other's.
  const CLIENT_ID = 'c'.repeat(40);
  const SERVER_ID = 'd'.repeat(40);
  const ownId = async (root, pkg) => ({ id: ({ [CLIENT]: CLIENT_ID, [SERVER]: SERVER_ID })[pkg] ?? OTHER_TREE, note: null });
  const twoTouched = [`${CLIENT}/test/a.test.js`, `${SERVER}/test/b.test.js`];

  test('two packages touched, one line on its own id and one on a stale id: the block names the stale one only, a workspaces: note printed unchanged', async () => {
    const record = `${CLIENT_ID} ${CLIENT}\n${TREE} ${SERVER}\n`;
    const note = `workspaces: package.json does not parse; ${SERVER} keyed to the whole tree`;
    const pkgTree = async (root, pkg) => ({ ...(await ownId(root, pkg)), note: pkg === SERVER ? note : null });
    const [head, ...files] = QA_BLOCK(1, `${SERVER}: test/b.test.js`).split('\n');
    assertBlocks(await flip(twoTouched, [CLIENT, SERVER], { pkgTree, packageRecord: record }),
      [`${head} ${note}`, ...files].join('\n'), 'a line on the whole tree\'s id is stale for a package with its own; the note carries no node fix');
  });

  test('two packages touched, each line on its own id: the flip passes, though the whole tree is another id', async () => {
    const record = `${SERVER_ID} ${SERVER}\n${CLIENT_ID} ${CLIENT}\n`;
    passText(await flip(twoTouched, [CLIENT, SERVER], { pkgTree: ownId, packageRecord: record }), 'both on their own ids');
  });

  test('a root test file proved as `.` on the whole tree passes, whatever a package id would be', async () => {
    passText(await flip(['tests/a.test.js'], [CLIENT], { pkgTree: ownId, packageRecord: `${TREE} .\n` }), 'the root on the whole tree');
  });
});

describe('proof-guard: a package declared in settings proof.rootOnly', () => {
  test('a touched test file in a declared package with no record: exit 0, the notice names it as proved by the root run', async () => {
    const msg = passText(await flip([`${BACKEND}/test/a.test.js`], [BACKEND], { rootOnly: [BACKEND] }), 'declared');
    expect(msg.startsWith(`proof-guard: no touched test file needs a package record on this tree. The root npm test before the commit is the proof of the package(s) the settings declare: ${ROOT_ONLY}: ${BACKEND}.`),
      `the notice names the declared package, got: ${msg}`).toBe(true);
  });

  test('a declared package beside an undeclared one, neither recorded: exit 2, naming only the undeclared one', async () => {
    assertBlocks(await flip([`${BACKEND}/test/a.test.js`, `${CLIENT}/test/b.test.js`], [BACKEND, CLIENT], { rootOnly: [BACKEND] }),
      QA_BLOCK(1, `${CLIENT}: test/b.test.js`), 'the declared package is never asked for');
  });

  test('settings with no proof key: a touched package with no record blocks, as with no settings', async () => {
    assertBlocks(await flip([`${BACKEND}/test/a.test.js`], [BACKEND], { rootOnly: undefined }),
      QA_BLOCK(1, `${BACKEND}: test/a.test.js`), 'nothing is declared');
  });

  test('\\".\\" declared covers a test file the root owns: exit 0, the notice names the root', async () => {
    const msg = passText(await flip(['tests/a.test.js'], [], { rootOnly: ['.'] }), 'the root declared');
    expect(msg.includes(`${ROOT_ONLY}: .`), `the notice names the root, got: ${msg}`).toBeTruthy();
  });

  for (const rootOnly of [BACKEND, [BACKEND, 7]]) {
    test(`a rootOnly that is not an array of strings (${JSON.stringify(rootOnly)}): one notice naming the key, checked as if nothing were declared`, async () => {
      const touched = [`${BACKEND}/test/a.test.js`];
      const block = denyOf(await flip(touched, [BACKEND], { rootOnly })) || '';
      const [blocked, note, ...rest] = block.split(`${QA_BLOCK(1, `${BACKEND}: test/a.test.js`)}\n`);
      expect(blocked === '' && note && !rest.length && note.includes('proof.rootOnly') && !note.includes('\n'),
        `the package is not declared, one note naming the key under the block, got: ${block}`).toBeTruthy();
      const msg = passText(await flip(touched, [BACKEND], { rootOnly, packageRecord: pkgRecord([BACKEND]) }), 'its own line');
      expect(msg.split('proof.rootOnly').length - 1, `one mention of the key, got: ${msg}`).toBe(1);
      expect(!msg.includes(ROOT_ONLY), `nothing is named as proved by the root run, got: ${msg}`).toBeTruthy();
    });
  }
});
