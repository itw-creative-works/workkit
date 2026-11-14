// Tests for safety:proof-guard at the flip to status:qa, proofVerdict over the
// steps, the touched paths and the two records: it runs no test, and a touched
// test file no record covers blocks. The gathering is the wiring's, a real gh call through the shim:
// test/scripts/identity/gh-shim.test.js. The packages are ./qa-groups.test.js.

const { describe, test, expect } = require('../../lib/harness');
const {
  ROOT, viewer, packagesOf, pkgRecord, suiteRecord, step, judge, QA, QA_BLOCK, HASH_BLOCK,
  assertBlocks, passText,
} = require('./helpers');

// One qa verdict over the touched paths, `over` replacing any fact; a qa flip
// reads no issue, so the view stub must stay unasked.
const flip = async (touched, over = {}, steps = QA) => {
  const view = viewer();
  const r = await judge(steps, { touched, issueView: view.issueView, ...over });
  expect(view.calls.length, `a qa flip reads no issue, got: ${JSON.stringify(view.calls)}`).toBe(0);
  return r;
};

describe('proof-guard: the park reads the records and runs nothing', () => {
  test('no touched test file: exit 0, the notice says so', async () => {
    const msg = passText(await flip(['lib/x.js']), 'no test file');
    expect(msg.startsWith('proof-guard: no touched test files in the working diff, so the qa flip needs no test record.'),
      `the notice is about the touched test files, got: ${msg}`).toBeTruthy();
    expect(!msg.includes('lib/x.js'), `a code file is never a test file, got: ${msg}`).toBeTruthy();
  });

  test('a whole root suite record on the tree: exit 0, the notice says the suite covers the files', async () => {
    const msg = passText(await flip(['tests/a.test.js'], { suiteRecord: suiteRecord() }), 'the suite record');
    expect(msg.startsWith('proof-guard: the whole root suite is green on this tree, which covers the 1 touched test file(s).'),
      `the notice names the whole root suite and the files it covers, got: ${msg}`).toBeTruthy();
  });

  test('a touched test file with no record: exit 2, naming the root and the file', async () => {
    assertBlocks(await flip(['tests/a.test.js']), QA_BLOCK(1, 'the repo root: tests/a.test.js'), 'no record blocks');
  });

  test('a touched .test.zsh file is a test file: no record blocks, the root record passes', async () => {
    assertBlocks(await flip(['tests/x.test.zsh']), QA_BLOCK(1, 'the repo root: tests/x.test.zsh'), 'no record blocks');
    const msg = passText(await flip(['tests/x.test.zsh'], { packageRecord: pkgRecord(['.']) }), 'the root line');
    expect(msg.startsWith('proof-guard: every touched test file has a green npm test recorded on this tree: the repo root (1 file(s)).'),
      `the notice names the root, got: ${msg}`).toBeTruthy();
  });

  for (const name of ['tests/helpers.js', 'tests/x.sh']) {
    test(`${name}, under a test folder but not test-shaped: named, never required`, async () => {
      const msg = passText(await flip([name]), name);
      expect(msg.includes(`Touched under a test folder but not a test file, so not required: ${name}.`), `the helper is named, got: ${msg}`).toBeTruthy();
    });
  }

  test('a helper beside a recorded test file: the helper is named, the record alone passes', async () => {
    const msg = passText(await flip(['tests/a.test.js', 'tests/helpers.js'], { packageRecord: pkgRecord(['.']) }), 'the helper');
    expect(msg.includes('Touched under a test folder but not a test file, so not required: tests/helpers.js.'), `the helper is named, got: ${msg}`).toBeTruthy();
  });

  for (const label of ['a root with no test script']) {
    test(`${label}: exit 0, the touched file named as not provable by npm test`, async () => {
      const msg = passText(await flip(['tests/a.test.js'], { packages: packagesOf([], false) }), label);
      expect(msg.startsWith('proof-guard: no touched test file can be proved by npm test here, so the qa flip needs no test record. Cannot be proved by npm test, since the repo root has no test script, so not required: tests/a.test.js.'),
        `the file is named as one npm test cannot prove, got: ${msg}`).toBeTruthy();
    });
  }

  test('a tree that cannot be hashed: exit 2, naming the hash as the cause', async () => {
    assertBlocks(await flip(['tests/a.test.js'], { treeId: null, packageRecord: pkgRecord(['.']) }), HASH_BLOCK(ROOT), 'no tree id blocks');
  });

  test('a test file with a non-ASCII name and no record: exit 2, named as written', async () => {
    assertBlocks(await flip(['tests/café.test.js']), QA_BLOCK(1, 'the repo root: tests/café.test.js'), 'named as written');
  });
});

describe('proof-guard: the steps a qa flip names', () => {
  test('a compound flipping two issues is judged once: one notice', async () => {
    const msg = passText(await flip(['tests/a.test.js'], { packageRecord: pkgRecord(['.']) },
      [step('edit', 3, ['status:qa']), step('edit', 4, ['status:qa'])]), 'two flips');
    expect(msg.split('proof-guard:').length - 1, `one notice for the whole command, got: ${msg}`).toBe(1);
  });

  test('any other label flip reads nothing, over a touched file with no record', async () => {
    for (const s of [
      step('edit', 3, ['status:building'], ['status:specced']),
      step('edit', 3, ['status:building'], ['status:qa']),
    ]) {
      expect(passText(await flip(['tests/a.test.js'], {}, [s]), JSON.stringify(s)), `no notice: ${JSON.stringify(s)}`).toBe('');
    }
  });
});

describe('proof-guard: the park stands down out loud', () => {
  test('a session outside any git repository: exit 0, one notice', async () => {
    const msg = passText(await flip([], { root: null, cwd: '/w/plain' }), 'no repo');
    expect(msg, 'says so').toBe("proof-guard: /w/plain is inside no git repository, so the park's test-record check did not run at the qa flip.");
  });
});
