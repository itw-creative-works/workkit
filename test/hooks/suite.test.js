// Tests for hooks/mods/suite.js, the one home of the record reads the suite,
// proof and commit guards share: factOf, suiteProved and pkgProved over the
// record text as workflow/lib/suite.sh writes it, hasTestScript over a parsed
// package.json, and testPackageDir over a `tested` predicate.

const { describe, test, expect } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

// Two tree ids a record can hold, neither a real tree.
const ID = '1111111111111111111111111111111111111111';
const OTHER_ID = '2222222222222222222222222222222222222222';

const suite = () => mods('suite');

describe('suite.js: treeHash', () => {
  test('treeHash runs bash <kit>/workflow/lib/tree-hash.sh <root> [flags] in the root, under the env handed in and the long timeout', async () => {
    const { treeHash, LONG_RUN_MS } = suite();
    const env = { HOME: '/h/me', PATH: '/usr/bin:/bin', TMPDIR: '/t' };
    const calls = [];
    const answerer = (answer) => async (argv, init) => { calls.push({ argv: [...argv], init }); return answer; };
    const ok = { exitCode: 0, stdout: `${ID}\n`, stderr: '' };
    expect(JSON.stringify(await treeHash(answerer(ok), '/k', '/w/repo', env)), 'the id, trimmed, and no note').toBe(JSON.stringify({ id: ID, note: null }));
    expect(JSON.stringify(calls[0].argv), 'the entry over the root').toBe(JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo']));
    expect(calls[0].init?.cwd, 'run in the root').toBe('/w/repo');
    expect(JSON.stringify(calls[0].init?.env), 'under the env handed in').toBe(JSON.stringify(env));
    expect(calls[0].init?.timeoutMs, 'under the long-run timeout').toBe(LONG_RUN_MS);
    await treeHash(answerer(ok), '/k', '/w/repo', env, '-i');
    expect(JSON.stringify(calls[1].argv), 'the flags after the root').toBe(JSON.stringify(['bash', '/k/workflow/lib/tree-hash.sh', '/w/repo', '-i']));
  });

  test("treeHash's note is every stderr line of the child starting tree-hash:, trimmed, in order; a failed or empty hash has no id", async () => {
    const { treeHash } = suite();
    const answer = (res) => async () => res;
    const said = 'tree-hash: no node 22.12 or newer found; packages/a keyed to the whole tree';
    const fellBack = { exitCode: 0, stdout: `${ID}\n`, stderr: `npm warn something else\n${said}  \ntree-hash: a later line\n` };
    expect(JSON.stringify(await treeHash(answer(fellBack), '/k', '/w/repo', {}, 'packages/a')), 'the id and both tree-hash lines').toBe(JSON.stringify({ id: ID, note: `${said}\ntree-hash: a later line` }));
    expect(JSON.stringify(await treeHash(answer({ exitCode: 1, stdout: '', stderr: 'fatal\n' }), '/k', '/w/repo', {})), 'a failed hash is no id and no note').toBe(JSON.stringify({ id: null, note: null }));
    expect((await treeHash(answer({ exitCode: 0, stdout: '\n', stderr: '' }), '/k', '/w/repo', {})).id, 'an empty answer is no id').toBe(null);
  });

  test("treeHash's note carries a workspaces: line too, in its place among the tree-hash: lines", async () => {
    const { treeHash } = suite();
    const reason = 'workspaces: package.json does not parse; packages/a keyed to the whole tree';
    const res = { exitCode: 0, stdout: `${ID}\n`, stderr: `tree-hash: first\nnpm warn other\n${reason}\n` };
    expect(JSON.stringify(await treeHash(async () => res, '/k', '/w/repo', {}, 'packages/a')), 'the id, and the workspaces fallback beside the tree-hash line').toBe(JSON.stringify({ id: ID, note: `tree-hash: first\n${reason}` }));
  });
});

describe('suite.js: the suite record', () => {
  test('suiteProved is true only when the record holds the tree it is handed', () => {
    const { suiteProved } = suite();
    expect(suiteProved(null, ID), 'no record proves nothing').toBe(false);
    expect(suiteProved(`${ID}\n`, ID), 'the recorded tree is proved').toBe(true);
    expect(suiteProved(`${ID}\n`, OTHER_ID), 'another tree is not').toBe(false);
    expect(suiteProved(`${ID}\n`, ''), 'an empty tree (a failed hash) is never a match').toBe(false);
  });

  test('suiteProved reads the first line of a record carrying the run\'s ms', () => {
    const { suiteProved } = suite();
    expect(suiteProved(`${ID}\nms=312000\n`, ID), 'the tree, then ms=, proves the tree').toBe(true);
    expect(suiteProved(`${OTHER_ID}\nms=312000\n`, ID), 'another tree first proves nothing').toBe(false);
  });
});

describe('suite.js: the package record', () => {
  test('pkgProved: a package is proved only by its own `<tree> <pkg>` line, each line its own id', () => {
    const { pkgProved } = suite();
    const record = `${ID} .\n${OTHER_ID} packages/foo\n`;
    expect(pkgProved(null, ID, '.'), 'no record proves nothing').toBe(false);
    expect(pkgProved(record, ID, '.'), 'the first line proves its package on its id').toBe(true);
    expect(pkgProved(record, OTHER_ID, 'packages/foo'), 'a later line proves its package on its own, other id').toBe(true);
    expect(pkgProved(record, ID, 'packages/foo'), "another package's id is not this one's").toBe(false);
    expect(pkgProved(record, OTHER_ID, '.'), "nor is a later line's id the root's").toBe(false);
    expect(pkgProved(record, ID, 'packages/bar'), 'a package never recorded is not').toBe(false);
    expect(pkgProved(record, OTHER_ID, 'packages/fo'), 'a prefix of a recorded folder is not').toBe(false);
    expect(pkgProved(record, '', '.'), 'an empty tree is never a match').toBe(false);
    expect(pkgProved(`${ID} .\n`, ID, 'packages/foo'), "the root's line never covers a nested package").toBe(false);
  });
});

describe('suite.js: the test script and the package it owns', () => {
  test('hasTestScript: a package.json whose scripts.test is a non-empty string, and nothing else', () => {
    const { hasTestScript } = suite();
    expect(hasTestScript({ scripts: { test: 'node --test' } }), 'a test script').toBe(true);
    expect(hasTestScript({ scripts: { test: '' } }), 'an empty one is none').toBe(false);
    expect(hasTestScript({ name: 'bare', scripts: { lint: 'x' } }), 'no test script').toBe(false);
    expect(hasTestScript(null), 'no package.json').toBe(false);
  });

  test('testPackageDir: the nearest tested folder below the root, the root\'s as \'\', node_modules never', async () => {
    const { testPackageDir } = suite();
    const tested = async (dir) => ['pkg', 'node_modules/x'].includes(dir);
    expect(await testPackageDir('pkg/src/deep/a.js', tested), 'a file under a tested package names it').toBe('pkg');
    expect(await testPackageDir('other/x.js', tested), 'a file under no tested package is the root\'s').toBe('');
    expect(await testPackageDir('app.js', tested), 'a root file is the root\'s').toBe('');
    expect(await testPackageDir('node_modules/x/index.js', tested), 'a vendored package is the root\'s, tested or not').toBe('');
  });
});
