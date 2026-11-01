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

  await test('treeHash runs bash <kit>/workflow/lib/tree-hash.sh <root> [flags] in the root, under the env handed in and the long timeout', async () => {
    const { treeHash, LONG_RUN_MS } = suite();
    const env = { HOME: '/h/me', PATH: '/usr/bin:/bin', TMPDIR: '/t' };
    const calls = [];
    const answerer = (answer) => async (argv, init) => { calls.push({ argv: [...argv], init }); return answer; };
    const ok = { exitCode: 0, stdout: `${ID}\n`, stderr: '' };
    assertEq(JSON.stringify(await treeHash(answerer(ok), '/k', '/w/repo', env)), JSON.stringify({ id: ID, note: null }), 'the id, trimmed, and no note');
    assertEq(JSON.stringify(calls[0].argv), JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo']), 'the entry over the root');
    assertEq(calls[0].init?.cwd, '/w/repo', 'run in the root');
    assertEq(JSON.stringify(calls[0].init?.env), JSON.stringify(env), 'under the env handed in');
    assertEq(calls[0].init?.timeoutMs, LONG_RUN_MS, 'under the long-run timeout');
    await treeHash(answerer(ok), '/k', '/w/repo', env, '-i');
    assertEq(JSON.stringify(calls[1].argv), JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo', '-i']), 'the flags after the root');
  });

  await test("treeHash's note is every stderr line of the child starting tree-hash:, trimmed, in order; a failed or empty hash has no id", async () => {
    const { treeHash } = suite();
    const answer = (res) => async () => res;
    const said = 'tree-hash: no node 22.12 or newer found; packages/a keyed to the whole tree';
    const fellBack = { exitCode: 0, stdout: `${ID}\n`, stderr: `npm warn something else\n${said}  \ntree-hash: a later line\n` };
    assertEq(JSON.stringify(await treeHash(answer(fellBack), '/k', '/w/repo', {}, 'packages/a')), JSON.stringify({ id: ID, note: `${said}\ntree-hash: a later line` }),
      'the id and both tree-hash lines');
    assertEq(JSON.stringify(await treeHash(answer({ exitCode: 1, stdout: '', stderr: 'fatal\n' }), '/k', '/w/repo', {})), JSON.stringify({ id: null, note: null }),
      'a failed hash is no id and no note');
    assertEq((await treeHash(answer({ exitCode: 0, stdout: '\n', stderr: '' }), '/k', '/w/repo', {})).id, null, 'an empty answer is no id');
  });

  await test("treeHash's note carries a workspaces: line too, in its place among the tree-hash: lines", async () => {
    const { treeHash } = suite();
    const reason = 'workspaces: package.json does not parse; packages/a keyed to the whole tree';
    const res = { exitCode: 0, stdout: `${ID}\n`, stderr: `tree-hash: first\nnpm warn other\n${reason}\n` };
    assertEq(JSON.stringify(await treeHash(async () => res, '/k', '/w/repo', {}, 'packages/a')), JSON.stringify({ id: ID, note: `tree-hash: first\n${reason}` }),
      'the id, and the workspaces fallback beside the tree-hash line');
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

  await test('pkgProved: a package is proved only by its own `<tree> <pkg>` line, each line its own id', () => {
    const { pkgProved } = suite();
    const record = `${ID} .\n${OTHER_ID} packages/foo\n`;
    assertEq(pkgProved(null, ID, '.'), false, 'no record proves nothing');
    assertEq(pkgProved(record, ID, '.'), true, 'the first line proves its package on its id');
    assertEq(pkgProved(record, OTHER_ID, 'packages/foo'), true, 'a later line proves its package on its own, other id');
    assertEq(pkgProved(record, ID, 'packages/foo'), false, "another package's id is not this one's");
    assertEq(pkgProved(record, OTHER_ID, '.'), false, "nor is a later line's id the root's");
    assertEq(pkgProved(record, ID, 'packages/bar'), false, 'a package never recorded is not');
    assertEq(pkgProved(record, OTHER_ID, 'packages/fo'), false, 'a prefix of a recorded folder is not');
    assertEq(pkgProved(record, '', '.'), false, 'an empty tree is never a match');
    assertEq(pkgProved(`${ID} .\n`, ID, 'packages/foo'), false, "the root's line never covers a nested package");
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
