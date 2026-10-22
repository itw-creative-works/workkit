// Tests for safety:proof-guard at the flip to status:qa, proofGuardVerdict over
// the touched paths and the two records: it runs no test, and a touched test
// file no record covers blocks. Each case ports the HEAD case its name quotes.
// The gathering (the untracked and committed legs, a deleted file, the repo a
// --repo names on the roster, a multi-repo command) is the wiring's:
// tests/mods/guards-proof-guard.test.ts. The packages are ./qa-groups.test.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  ROOT, viewer, packagesOf, pkgRecord, suiteRecord, judge, QA, UNREAD, CD_BOUNCE, QA_BLOCK, HASH_BLOCK,
  assertBlocks, passText,
} = require('./helpers');

// One qa verdict over the touched paths, `over` replacing any fact; a qa flip
// reads no issue, so the view stub must stay unasked.
const flip = async (touched, over = {}, command = QA) => {
  const view = viewer();
  const r = await judge(command, { touched, issueView: view.issueView, ...over });
  assertEq(view.calls.length, 0, `a qa flip reads no issue, got: ${JSON.stringify(view.calls)}`);
  return r;
};

const run = async () => {
  group('proof-guard: the park reads the records and runs nothing');

  await test('ports "no touched test file: exit 0, the notice says so"', async () => {
    const msg = passText(await flip(['lib/x.js']), 'no test file');
    assert(msg.startsWith('proof-guard: no touched test files in the working diff, so the qa flip needs no test record.'),
      `the notice is about the touched test files, got: ${msg}`);
    assert(!msg.includes('lib/x.js'), `a code file is never a test file, got: ${msg}`);
  });

  await test('ports "a whole root suite record on the tree: exit 0, the notice says the suite covers the files"', async () => {
    const msg = passText(await flip(['tests/a.test.js'], { suiteRecord: suiteRecord() }), 'the suite record');
    assert(msg.startsWith('proof-guard: the whole root suite is green on this tree, which covers the 1 touched test file(s).'),
      `the notice names the whole root suite and the files it covers, got: ${msg}`);
  });

  await test('ports "a touched test file with no record: exit 2, naming the root and the file"', async () => {
    assertBlocks(await flip(['tests/a.test.js']), QA_BLOCK(1, 'the repo root: tests/a.test.js'), 'no record blocks');
  });

  await test('ports "a touched .test.zsh file is a test file: no record blocks, the root record passes"', async () => {
    assertBlocks(await flip(['tests/x.test.zsh']), QA_BLOCK(1, 'the repo root: tests/x.test.zsh'), 'no record blocks');
    const msg = passText(await flip(['tests/x.test.zsh'], { packageRecord: pkgRecord(['.']) }), 'the root line');
    assert(msg.startsWith('proof-guard: every touched test file has a green npm test recorded on this tree: the repo root (1 file(s)).'),
      `the notice names the root, got: ${msg}`);
  });

  for (const name of ['tests/helpers.js', 'tests/x.sh']) {
    await test(`ports "${name}, under a test folder but not test-shaped: named, never required"`, async () => {
      const msg = passText(await flip([name]), name);
      assert(msg.includes(`Touched under a test folder but not a test file, so not required: ${name}.`), `the helper is named, got: ${msg}`);
    });
  }

  await test('ports "a helper beside a recorded test file: the helper is named, the record alone passes"', async () => {
    const msg = passText(await flip(['tests/a.test.js', 'tests/helpers.js'], { packageRecord: pkgRecord(['.']) }), 'the helper');
    assert(msg.includes('Touched under a test folder but not a test file, so not required: tests/helpers.js.'), `the helper is named, got: ${msg}`);
  });

  for (const label of ['a root with no test script', 'a root with no package.json']) {
    await test(`ports "${label}: exit 0, the touched file named as not provable by npm test"`, async () => {
      const msg = passText(await flip(['tests/a.test.js'], { packages: packagesOf([], false) }), label);
      assert(msg.startsWith('proof-guard: no touched test file can be proved by npm test here, so the qa flip needs no test record. Cannot be proved by npm test, since the repo root has no test script, so not required: tests/a.test.js.'),
        `the file is named as one npm test cannot prove, got: ${msg}`);
    });
  }

  await test('ports "a tree that cannot be hashed: exit 2, naming the hash as the cause"', async () => {
    assertBlocks(await flip(['tests/a.test.js'], { treeId: null, packageRecord: pkgRecord(['.']) }), HASH_BLOCK(ROOT), 'no tree id blocks');
  });

  await test('ports "a test file with a non-ASCII name and no record: exit 2, named as written"', async () => {
    assertBlocks(await flip(['tests/café.test.js']), QA_BLOCK(1, 'the repo root: tests/café.test.js'), 'named as written');
  });

  group('proof-guard: the repo a qa flip names');

  for (const value of ['"$R"', '$D', '"$(cat repo.txt)"', '`cat repo.txt`']) {
    await test(`ports "--repo ${value} on the qa flip: exit 2, asking for the repo as owner/name"`, async () => {
      assertBlocks(await flip(['tests/a.test.js'], {}, `gh issue edit 3 --repo ${value} --add-label status:qa`), UNREAD, value);
    });
  }

  const DIR_CHANGES = [
    'cd /w/other && gh issue edit 3 --repo owner/name --add-label status:qa',
    'cd /w/other && gh issue edit 3 --add-label status:qa',
    '(cd /w/other && gh issue edit 3 --add-label status:qa)',
    'pushd /w/other >/dev/null && gh issue edit 3 --add-label status:qa',
    'popd && gh issue edit 3 --add-label status:qa',
  ];
  for (const c of DIR_CHANGES) {
    await test(`ports "a directory change before the flip bounces: ${c.replace('/w/other', '<dir>')}"`, async () => {
      assertBlocks(await flip(['tests/a.test.js'], {}, c), CD_BOUNCE, c);
    });
  }

  await test('ports "a directory change after the flip is not its tree: the file with no record still blocks"', async () => {
    assertBlocks(await flip(['tests/a.test.js'], {}, `${QA} && cd /`), QA_BLOCK(1, 'the repo root: tests/a.test.js'), 'never a directory change');
  });

  await test('ports "a body that mentions -R is not the flag: the file with no record still blocks"', async () => {
    assertBlocks(await flip(['tests/a.test.js'], {}, 'gh issue edit 3 --body "pass it with -R when needed" --add-label status:qa'),
      QA_BLOCK(1, 'the repo root: tests/a.test.js'), 'the session repo is judged');
  });

  await test('ports "a body naming --add-label status:qa is no flip: no notice, no block"', async () => {
    assertEq(passText(await flip(['tests/a.test.js'], {}, 'gh issue edit 3 --body "run --add-label status:qa later"'), 'no flip'), '', 'no notice');
  });

  await test('ports "a compound flipping two issues is judged once: one notice"', async () => {
    const msg = passText(await flip(['tests/a.test.js'], { packageRecord: pkgRecord(['.']) },
      'gh issue edit 3 --add-label status:qa && gh issue edit 4 --add-label status:qa'), 'two flips');
    assertEq(msg.split('proof-guard:').length - 1, 1, `one notice for the whole command, got: ${msg}`);
  });

  await test('ports "any other label flip reads nothing, over a touched file with no record"', async () => {
    for (const c of [
      'gh issue edit 3 --remove-label status:specced --add-label status:building',
      'gh issue edit 3 --remove-label status:qa --add-label status:building',
    ]) {
      assertEq(passText(await flip(['tests/a.test.js'], {}, c), c), '', `no notice: ${c}`);
    }
  });

  group('proof-guard: the park stands down out loud');

  await test('ports "a session outside any git repository: exit 0, one notice"', async () => {
    const msg = passText(await flip([], { root: null, cwd: '/w/plain' }), 'no repo');
    assertEq(msg, "proof-guard: /w/plain is inside no git repository, so the park's test-record check did not run at the qa flip.", 'says so');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
