// Tests for hooks/mods/suite.js, the one home of the record reads the suite,
// proof and commit guards share: factOf, suiteProved and pkgProved over the
// record text as workflow/lib/suite.sh writes it, hasTestScript over a parsed
// package.json, and testPackageDir over a `tested` predicate.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

// Two tree ids a record can hold, neither a real tree.
const ID = '1111111111111111111111111111111111111111';
const OTHER_ID = '2222222222222222222222222222222222222222';

const suite = () => mods('suite');

const cases = async () => {
  group('suite.js: treeHash');

  await test('treeHash runs bash <kit>/workflow/lib/tree-hash.sh <root> [flags] with the long timeout, answering the trimmed id or null', async () => {
    const { treeHash, LONG_RUN_MS } = suite();
    const calls = [];
    const answerer = (answer) => async (argv, init) => { calls.push({ argv: [...argv], init }); return answer; };
    const ok = { exitCode: 0, stdout: `${ID}\n`, stderr: '' };
    assertEq(await treeHash(answerer(ok), '/k', '/w/repo'), ID, 'the id, trimmed');
    assertEq(JSON.stringify(calls[0].argv), JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo']), 'the entry over the root');
    assertEq(calls[0].init?.timeoutMs, LONG_RUN_MS, 'under the long-run timeout');
    await treeHash(answerer(ok), '/k', '/w/repo', '-u');
    assertEq(JSON.stringify(calls[1].argv), JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo', '-u']), 'the flags after the root');
    assertEq(await treeHash(answerer({ exitCode: 1, stdout: '', stderr: 'fatal\n' }), '/k', '/w/repo'), null, 'a failed hash is null');
  });

  group('suite.js: the suite record');

  await test('suiteProved is true only when the record holds the tree it is handed', () => {
    const { suiteProved } = suite();
    assertEq(suiteProved(null, ID), false, 'no record proves nothing');
    assertEq(suiteProved(`${ID}\n`, ID), true, 'the recorded tree is proved');
    assertEq(suiteProved(`${ID}\n`, OTHER_ID), false, 'another tree is not');
    assertEq(suiteProved(`${ID}\n`, ''), false, 'an empty tree (a failed hash) is never a match');
  });

  await test('suiteProved reads the first line of a record carrying the run\'s ms', () => {
    const { suiteProved } = suite();
    assertEq(suiteProved(`${ID}\nms=312000\n`, ID), true, 'the tree, then ms=, proves the tree');
    assertEq(suiteProved(`${OTHER_ID}\nms=312000\n`, ID), false, 'another tree first proves nothing');
  });

  group('suite.js: the package record');

  await test('pkgProved: the first package line and a later one, on the recorded tree only', () => {
    const { pkgProved } = suite();
    const record = `${ID}\n.\npackages/foo\n`;
    assertEq(pkgProved(null, ID, '.'), false, 'no record proves nothing');
    assertEq(pkgProved(record, ID, '.'), true, 'the first package line is proved');
    assertEq(pkgProved(record, ID, 'packages/foo'), true, 'a later package line is proved');
    assertEq(pkgProved(record, ID, 'packages/bar'), false, 'a package never recorded is not');
    assertEq(pkgProved(record, ID, 'packages/fo'), false, 'a prefix of a recorded folder is not');
    assertEq(pkgProved(record, OTHER_ID, '.'), false, 'another tree is not');
    assertEq(pkgProved(record, '', '.'), false, 'an empty tree is never a match');
    assertEq(pkgProved(`${ID}\n.\n`, ID, 'packages/foo'), false, "the root's line never covers a nested package");
  });

  group('suite.js: the test script and the package it owns');

  await test('hasTestScript: a package.json whose scripts.test is a non-empty string, and nothing else', () => {
    const { hasTestScript } = suite();
    assertEq(hasTestScript({ scripts: { test: 'node --test' } }), true, 'a test script');
    assertEq(hasTestScript({ scripts: { test: '' } }), false, 'an empty one is none');
    assertEq(hasTestScript({ name: 'bare', scripts: { lint: 'x' } }), false, 'no test script');
    assertEq(hasTestScript(null), false, 'no package.json');
  });

  await test('testPackageDir: the nearest tested folder below the root, the root\'s as \'\', node_modules never', async () => {
    const { testPackageDir } = suite();
    const tested = async (dir) => ['pkg', 'node_modules/x'].includes(dir);
    assertEq(await testPackageDir('pkg/src/deep/a.js', tested), 'pkg', 'a file under a tested package names it');
    assertEq(await testPackageDir('other/x.js', tested), '', 'a file under no tested package is the root\'s');
    assertEq(await testPackageDir('app.js', tested), '', 'a root file is the root\'s');
    assertEq(await testPackageDir('node_modules/x/index.js', tested), '', 'a vendored package is the root\'s, tested or not');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
