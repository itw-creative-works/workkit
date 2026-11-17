// Tests for workflow/lib/tree-hash.js run as a command, the one home of a tree
// id: the working tree's, a package's own in a workspaces repo, and the
// index's under -i. The expected ids come from the tests' own treeHash
// (test/lib/suite-record.js) or from git itself, never from the kit.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, until,
} = require('../lib/harness');
const { mkRepo } = require('../lib/git-repo');
const { treeHash } = require('../lib/suite-record');

const TREE_HASH = path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree-hash.js');
const ID = /^[0-9a-f]{40,64}$/;

// `node tree-hash.js <args>` in the world's env, from <cwd> (the repo by default).
const hashCmd = (w, args, { cwd = w.repo, env = {} } = {}) => run(process.execPath, [TREE_HASH, ...args], { cwd, env: { ...w.env, ...env } });

// The id the command printed, failing the case when it printed none.
const idOf = (w, args, opts) => {
  const res = hashCmd(w, args, opts);
  const id = res.stdout.trim();
  expect(res.status === 0 && ID.test(id), `tree-hash.js ${args.slice(1).join(' ')} printed a tree id, got: ${res.status} ${res.stdout}|${res.stderr}`).toBeTruthy();
  return id;
};

// git in the world's repo under <env>, its stdout trimmed.
const gitIn = (w, args, env = {}) => run('git', args, { cwd: w.repo, env: { ...w.env, ...env } }).stdout.trim();

// The tree of the index file <index> less .workkit, taken by git on a scratch copy.
const indexTree = (w, index) => {
  const copy = path.join(mkTmp('tree-hash-index-'), 'index');
  fs.copyFileSync(index, copy);
  gitIn(w, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.workkit'], { GIT_INDEX_FILE: copy });
  return gitIn(w, ['write-tree'], { GIT_INDEX_FILE: copy });
};

// A committed workspaces repo: members a, its nested member a/sub, b, and c depending on a.
const workspacesRepo = (workspaces = ['packages/*', 'packages/a/sub']) => mkRepo('tree-hash-ws-', {
  'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces }),
  'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }),
  'packages/a/index.js': 'module.exports = 1;\n',
  'packages/a/sub/package.json': JSON.stringify({ name: 'sub', version: '1.0.0' }),
  'packages/a/sub/index.js': 'module.exports = 2;\n',
  'packages/b/package.json': JSON.stringify({ name: 'b', version: '1.0.0' }),
  'packages/b/index.js': 'module.exports = 3;\n',
  'packages/c/package.json': JSON.stringify({ name: 'c', version: '1.0.0', dependencies: { a: '1.0.0' } }),
  'packages/c/index.js': 'module.exports = 4;\n',
});

describe('tree-hash.js: the working tree', () => {
  test('the id is the tests\' own treeHash: an untracked file changes it, an ignored file and one under .workkit/ do not, the real index untouched', () => {
    const w = mkRepo('tree-hash-work-', { '.gitignore': 'ignored.txt\n', 'app.js': 'one\n' });
    w.write('app.js', 'two\n');
    const edited = idOf(w, [w.repo]);
    expect(edited, 'the id the tests\' treeHash gives').toBe(treeHash(w.repo));
    w.write('ignored.txt', 'x\n');
    w.write('.workkit/suite.log', 'script-shell: exit 0\n');
    expect(idOf(w, [w.repo]), 'an ignored file and a file under .workkit/ leave the id').toBe(edited);
    w.write('new.js', 'x\n');
    const untracked = idOf(w, [w.repo]);
    expect(untracked !== edited, 'an untracked file changes the id').toBeTruthy();
    expect(untracked, 'and the id is still the tests\' treeHash').toBe(treeHash(w.repo));
    expect(gitIn(w, ['diff', '--cached', '--name-only']), 'the real index is never touched').toBe('');
  });

  test('a file edited to the same size within the index\'s own second: the id changes', async () => {
    const w = mkRepo('tree-hash-racy-', { 'seed.txt': 'x\n' });
    w.write('a.js', 'one\n');
    gitIn(w, ['add', '-A']);
    const added = Math.floor(Date.now() / 1000);
    w.write('a.js', 'two\n');
    // Past the index's second, so a copy stamped now would trust the stale stat.
    await until(() => Math.floor(Date.now() / 1000) > added);
    const now = idOf(w, [w.repo]);
    expect(now, 'the edited content, the tests\' treeHash of the edit').toBe(treeHash(w.repo));
    expect(now !== gitIn(w, ['write-tree']), 'never the tree the index\'s stale stat holds').toBeTruthy();
  });
});

describe('tree-hash.js: -i, the index', () => {
  test('the id is the real index\'s tree less .workkit: a staged edit in, an unstaged one out', () => {
    const w = mkRepo('tree-hash-index-', { 'app.js': 'one\n' });
    w.write('app.js', 'staged\n');
    w.write('.workkit/settings.json', '{ "enabled": true, "x": 1 }\n');
    gitIn(w, ['add', '-A']);
    w.write('app.js', 'unstaged\n');
    const want = indexTree(w, path.join(w.repo, '.git', 'index'));
    expect(idOf(w, [w.repo, '-i']), 'the index\'s tree less .workkit').toBe(want);
    expect(gitIn(w, ['diff', '--cached', '--name-only']), 'and the real index still holds its staged files').toBe('.workkit/settings.json\napp.js');
  });

  test('GIT_INDEX_FILE is honoured, absolute or relative to the root, from any folder', () => {
    const w = mkRepo('tree-hash-alt-', { 'app.js': 'one\n' });
    const alt = path.join(w.repo, '.git', 'alt-index');
    fs.copyFileSync(path.join(w.repo, '.git', 'index'), alt);
    w.write('extra.js', 'x\n');
    gitIn(w, ['add', 'extra.js'], { GIT_INDEX_FILE: alt });
    const want = indexTree(w, alt);
    expect(want !== indexTree(w, path.join(w.repo, '.git', 'index')), 'the other index holds another tree').toBeTruthy();
    const elsewhere = mkTmp('tree-hash-cwd-');
    expect(idOf(w, [w.repo, '-i'], { cwd: elsewhere, env: { GIT_INDEX_FILE: alt } }), 'an absolute GIT_INDEX_FILE').toBe(want);
    expect(idOf(w, [w.repo, '-i'], { cwd: elsewhere, env: { GIT_INDEX_FILE: '.git/alt-index' } }), 'a GIT_INDEX_FILE relative to the root').toBe(want);
  });
});

describe('tree-hash.js: a package\'s own id', () => {
  test('members the package neither holds, sits in, nor depends on are left out', () => {
    const w = workspacesRepo();
    expect(idOf(w, [w.repo, 'packages/a']), 'a holds sub, so b and c go').toBe(treeHash(w.repo, ['packages/b', 'packages/c']));
    expect(idOf(w, [w.repo, 'packages/a/sub']), 'sub sits in a, so b and c go').toBe(treeHash(w.repo, ['packages/b', 'packages/c']));
    expect(idOf(w, [w.repo, 'packages/c']), 'c depends on a, so b and sub go').toBe(treeHash(w.repo, ['packages/b', 'packages/a/sub']));
    expect(idOf(w, [w.repo, '.']), '`.` is the whole tree').toBe(treeHash(w.repo));
  });

  test('a workspace read that fails: its workspaces: line on stderr, the whole tree\'s id, exit 0', () => {
    const w = workspacesRepo(['packages/**']);
    const res = hashCmd(w, [w.repo, 'packages/a']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.trim(), 'the whole tree\'s id').toBe(treeHash(w.repo));
    const said = res.stderr.split('\n').filter(Boolean);
    expect(said.length === 1 && said[0].startsWith('workspaces: '), `one workspaces: line, got: ${res.stderr}`).toBeTruthy();
  });
});

describe('tree-hash.js: the forms it refuses', () => {
  test('-i beside another flag or a package: one line, exit 1, no id', () => {
    const w = mkRepo('tree-hash-refuse-', { 'app.js': 'one\n' });
    for (const args of [['-i', 'extra'], ['.', '-i'], ['packages/a', '-i'], ['-i', '--index', path.join(w.tmp, 'index')]]) {
      const res = hashCmd(w, [w.repo, ...args]);
      expect(res.status, `${args.join(' ')}: exit 1`).toBe(1);
      expect(res.stdout, `${args.join(' ')}: nothing on stdout`).toBe('');
      expect(res.stderr, `${args.join(' ')}: the one line`).toBe('tree-hash: -i takes no other flag or package\n');
    }
  });

  test('no root: one line, exit 1, no id', () => {
    const w = mkRepo('tree-hash-noroot-', { 'app.js': 'one\n' });
    const res = hashCmd(w, []);
    expect(res.status, 'exit 1').toBe(1);
    expect(res.stdout, 'nothing on stdout').toBe('');
    expect(res.stderr, 'the one line').toBe('tree-hash: a repo root is required\n');
  });
});
