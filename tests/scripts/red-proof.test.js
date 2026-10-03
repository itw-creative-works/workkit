// Tests for scripts/red-proof.sh: the tests run in a copy built from the repo's
// snapshot, where the named source paths are as the snapshot holds them and
// every other change since is live. Every case is a real throwaway git repo
// whose snapshot is made by hand in the claim's layout, in a TMPDIR of its own,
// so the worktree the script makes is seen to go; nothing is stubbed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  BASH, NO_RC, shellPath, gitPath, cygpathStub, pathWith,
} = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');
const { mkTmp } = require('../lib/scratch');
const { treeOf, takeSnapshot } = require('../lib/red-snapshot');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'red-proof.sh');
const NO_SNAPSHOT = 'red-proof: not runnable: no snapshot for this repo (the claim to status:building takes it)';

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

const TEST_OF = (value) => [
  "const x = require('../src/x');",
  `if (x !== ${value}) throw new Error('x is ' + x);`,
  '',
].join('\n');

/**
 * A scratch world: a repo holding `src/x.js` (exports 1), `src/y.js` (exports
 * 10), `src/w.js` (exports 100), `src/helper.js`, a `.gitignore` for
 * node_modules and `tests/x.test.js` asserting 1, all committed; a home and a
 * TMPDIR of its own beside it.
 */
const mkWorld = () => mkRepo('red-proof-', {
  'src/x.js': 'module.exports = 1;\n',
  'src/y.js': 'module.exports = 10;\n',
  'src/w.js': 'module.exports = 100;\n',
  'src/helper.js': 'module.exports = 0;\n',
  '.gitignore': 'node_modules/\n',
  'tests/x.test.js': TEST_OF(1),
});

// Prints where `@scope/a` resolved and the root of the tree this file sits in,
// then asserts the package's value.
const WS_TEST_OF = (value) => [
  "const fs = require('fs'), path = require('path');",
  "console.log('resolved', require.resolve('@scope/a'));",
  "console.log('root', fs.realpathSync(path.join(__dirname, '..')));",
  "const a = require('@scope/a');",
  `if (a !== ${value}) throw new Error('a is ' + a);`,
  '',
].join('\n');

/** Link each named workspace package under `node_modules/@scope`, relatively, as npm does. */
const linkPackages = (w, ...names) => {
  fs.mkdirSync(path.join(w.repo, 'node_modules', '@scope'), { recursive: true });
  for (const name of names) {
    fs.symlinkSync(path.join('..', '..', 'packages', name), path.join(w.repo, 'node_modules', '@scope', name), 'dir');
  }
};

const ROOT_WS = `${JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })}\n`;

/**
 * A scratch workspaces repo: a root package.json with `workspaces`, the package
 * `packages/a` (exports 1) behind the relative link `node_modules/@scope/a`, and
 * `packages/a/node_modules/dep` (exports 7). Both node_modules are ignored.
 */
const mkWorkspaces = () => {
  const w = mkRepo('red-proof-ws-', {
    'package.json': ROOT_WS,
    '.gitignore': 'node_modules/\n',
    'packages/a/package.json': `${JSON.stringify({ name: '@scope/a', main: 'index.js' })}\n`,
    'packages/a/index.js': 'module.exports = 1;\n',
    'packages/a/dep.test.js': "console.log('dep', require('dep'), require.resolve('dep'));\n",
    'tests/a.test.js': WS_TEST_OF(1),
  });
  linkPackages(w, 'a');
  w.write('packages/a/node_modules/dep/index.js', 'module.exports = 7;\n');
  return w;
};

// `@scope/b`'s build: a tag naming the build, and `@scope/a` as it loads.
const BUILT = (tag) => `module.exports = { built: '${tag}', a: require('@scope/a') };\n`;

// Prints which build of `@scope/b` loaded and the `@scope/a` it carries, then asserts that value.
const BUILT_TEST_OF = (value) => [
  "const b = require('@scope/b');",
  "console.log('b', b.built, b.a);",
  `if (b.a !== ${value}) throw new Error('a via b is ' + b.a);`,
  '',
].join('\n');

/**
 * A scratch workspaces repo with build output: `packages/a` (exports 1) and
 * `packages/b`, whose main is its gitignored `dist/index.js`, built `old`,
 * which requires `@scope/a`; both linked under `node_modules/@scope`.
 */
const mkBuilt = () => {
  const w = mkRepo('red-proof-built-', {
    'package.json': ROOT_WS,
    '.gitignore': 'node_modules/\npackages/*/dist/\n',
    'packages/a/package.json': `${JSON.stringify({ name: '@scope/a', main: 'index.js' })}\n`,
    'packages/a/index.js': 'module.exports = 1;\n',
    'packages/b/package.json': `${JSON.stringify({ name: '@scope/b', main: 'dist/index.js' })}\n`,
    'packages/b/src/index.js': BUILT('src'),
    'tests/ab.test.js': BUILT_TEST_OF(1),
  });
  linkPackages(w, 'a', 'b');
  w.write('packages/b/dist/index.js', BUILT('old'));
  return w;
};

const runScript = (w, args, cwd = w.repo, env = w.env) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd, env, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `the script finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** World `w`'s env as faked Git Bash sees it: `OSTYPE=msys` and a stub `cygpath` first on PATH. */
const msysEnv = (w) => {
  const cyg = mkTmp('red-proof-cygpath-');
  cygpathStub(cyg);
  return { ...w.env, OSTYPE: 'msys', PATH: pathWith(cyg) };
};

const lines = (out) => out.split('\n').filter(Boolean);

/** The value after `<tag> ` on the stdout line that starts with it. */
const field = (out, tag) => (lines(out).find((l) => l.startsWith(`${tag} `)) || '').slice(tag.length + 1);

/** The worktree is gone: one `git worktree list` line, nothing but the snapshot left in TMPDIR. */
const assertNoWorktree = (w) => {
  assertEq(lines(w.git('worktree', 'list')).length, 1, 'git worktree list is back to one entry');
  const left = fs.readdirSync(w.tmp).filter((name) => name !== 'claude-red-snapshot');
  assertEq(left.length, 0, `nothing but the snapshot left in TMPDIR: ${left}`);
};

const run = async () => {
  group('red-proof.sh: the verdict');

  await test('an edited source the new test needs: red, exit 0, the shared tree untouched', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', TEST_OF(2));
    const before = w.git('status', '--short');
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 0, `exit 0: ${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assert(err.includes('x is 1'), `the command's own stderr passed through: ${err}`);
    assertNoWorktree(w);
    assertEq(w.git('status', '--short'), before, 'git status --short is unchanged');
    assertEq(fs.readFileSync(path.join(w.repo, 'src', 'x.js'), 'utf8'), 'module.exports = 2;\n', 'the edit is still there');
    cleanup(w.dir);
  });

  await test('a test tied to nothing the source changed: green, exit 1, naming the path', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', "require('../src/x');\nconsole.log('always fine');\n");
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 1, `exit 1: ${err}`);
    assert(out.includes('always fine'), `the command's stdout passed through: ${out}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: no snapshot');

  await test('a repo with no snapshot: exit 2 with the one line, never a verdict', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', TEST_OF(2));
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red') && !out.includes('red-proof: green'), `no verdict: ${out}`);
    assertEq(lines(err).pop(), NO_SNAPSHOT, `the last stderr line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: the snapshot');

  await test('build output rebuilt after the snapshot: an untouched package\'s dist loads the old code, red on the real assertion', () => {
    const w = mkBuilt();
    takeSnapshot(w);
    w.write('packages/a/index.js', 'module.exports = 2;\n');
    w.write('packages/b/dist/index.js', BUILT('new'));
    w.write('tests/ab.test.js', BUILT_TEST_OF(2));
    const { code, out, err } = runScript(w, ['packages/a/index.js', '--', 'node', 'tests/ab.test.js']);
    assert(out.includes('b old 1'), `the snapshot's build of @scope/b loaded the snapshot's @scope/a: ${out}${err}`);
    assert(!err.includes('Cannot find module'), `no load failure: ${err}`);
    assert(err.includes('a via b is 1'), `the assertion ran: ${err}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertEq(fs.readFileSync(path.join(w.repo, 'packages', 'b', 'dist', 'index.js'), 'utf8'), BUILT('new'), 'the live build is intact');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a gitignored .env in a repo with one root package.json is in the copy', () => {
    const w = mkRepo('red-proof-env-', {
      'package.json': `${JSON.stringify({ name: 'single', private: true })}\n`,
      '.gitignore': '.env\n',
      'src/x.js': 'module.exports = 1;\n',
    });
    w.write('.env', 'KEY="root-env"\n');
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    const check = "const s = require('fs').readFileSync('.env', 'utf8'); console.log('env', s.trim());"
      + " process.exit(s === 'KEY=\"root-env\"\\n' ? 0 : 1);";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assert(out.includes('env KEY="root-env"'), `the root .env read in the copy: ${out}${err}`);
    assertEq(code, 1, `exit 1, the check passed: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a named path is as the snapshot holds it, not as HEAD or the live tree has it', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 3;\n');
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', TEST_OF(2));
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assert(err.includes('x is 3'), `the snapshot's version ran: ${err}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a named file created after the snapshot is absent: a test requiring it is red, exit 0', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/new.js', 'module.exports = 3;\n');
    w.write('tests/x.test.js', "if (require('../src/new') !== 3) throw new Error('new');\n");
    const { code, out, err } = runScript(w, ['src/new.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 0, `exit 0: ${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `red: ${out}`);
    assert(err.includes('src/new'), `node could not find it: ${err}`);
    assertEq(fs.existsSync(path.join(w.repo, 'src', 'new.js')), true, 'the shared tree keeps it');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('since the snapshot: a changed file is live, a deleted one absent, one dirty then and reverted since is HEAD\'s', () => {
    const w = mkWorld();
    w.write('src/w.js', 'module.exports = 999;\n');
    takeSnapshot(w);
    w.write('src/y.js', 'module.exports = 20;\n');
    fs.rmSync(path.join(w.repo, 'src', 'helper.js'));
    w.write('src/w.js', 'module.exports = 100;\n');
    const check = "console.log('y', require('./src/y'));"
      + " console.log('helper', require('fs').existsSync('src/helper.js'));"
      + " console.log('w', require('./src/w'));";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(field(out, 'y'), '20', `the changed file is live: ${out}${err}`);
    assertEq(field(out, 'helper'), 'false', `the deleted file is absent: ${out}${err}`);
    assertEq(field(out, 'w'), '100', `the reverted file is HEAD's: ${out}${err}`);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a commit between the snapshot and the proof: the files it changed are live', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/y.js', 'module.exports = 30;\n');
    w.write('src/added.js', 'module.exports = 4;\n');
    w.git('rm', '-q', 'src/helper.js');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'between');
    const check = "console.log('y', require('./src/y'));"
      + " console.log('added', require('./src/added'));"
      + " console.log('helper', require('fs').existsSync('src/helper.js'));";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(field(out, 'y'), '30', `the committed change is live: ${out}${err}`);
    assertEq(field(out, 'added'), '4', `the committed new file is there: ${out}${err}`);
    assertEq(field(out, 'helper'), 'false', `the committed removal is absent: ${out}${err}`);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('the copy is a git repo; after the run the real tree and the snapshot are untouched and the worktree is gone', () => {
    const w = mkWorld();
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    const snap = takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    const tree = treeOf(w.repo);
    const status = w.git('status', '--short', '--ignored');
    const held = treeOf(snap);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'git', 'rev-parse', '--show-toplevel']);
    assertEq(code, 1, `exit 1, git answered in the copy: ${out}${err}`);
    const top = lines(out)[0] || '';
    assert(top !== '' && top !== gitPath(w.repo) && !top.startsWith(`${gitPath(w.repo)}/`),
      `the copy's own toplevel, not the live repo: ${out}`);
    assertEq(JSON.stringify(treeOf(w.repo)), JSON.stringify(tree), 'no file in the real tree added, removed or altered');
    assertEq(w.git('status', '--short', '--ignored'), status, 'git status --short --ignored is unchanged');
    assertEq(JSON.stringify(treeOf(snap)), JSON.stringify(held), 'the snapshot is unchanged');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('Windows (Git Bash): a snapshot with no node_modules, the copy reaches each live one', () => {
    const w = mkWorld();
    w.write('pkg/use.js', "module.exports = require('dep');\n");
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'pkg');
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    w.write('pkg/node_modules/dep/index.js', 'module.exports = 7;\n');
    const snap = takeSnapshot(w, { skipModules: true });
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', `console.log('tiny', require('tiny'));\nconsole.log('dep', require('../pkg/use'));\n${TEST_OF(2)}`);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js'], w.repo, msysEnv(w));
    assertEq(field(out, 'tiny'), '5', `the root node_modules reached: ${out}${err}`);
    assertEq(field(out, 'dep'), '7', `the nested node_modules reached: ${out}${err}`);
    assert(err.includes('x is 1'), `the assertion ran: ${err}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertEq(Object.keys(treeOf(snap)).filter((k) => k.split(path.sep).includes('node_modules')).join(','), '',
      'the snapshot still holds no node_modules');
    assertEq(fs.readFileSync(path.join(w.repo, 'node_modules', 'tiny', 'index.js'), 'utf8'),
      'module.exports = 5;\n', 'the real node_modules is intact');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('Windows (Git Bash): a workspace link reaches the copy\'s package, a plain and a scoped entry the live repo; rebuilt output is red', () => {
    const w = mkBuilt();
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    w.write('node_modules/@scope/ext/index.js', 'module.exports = 6;\n');
    takeSnapshot(w, { skipModules: true });
    w.write('packages/a/index.js', 'module.exports = 2;\n');
    w.write('packages/b/dist/index.js', BUILT('new'));
    w.write('tests/ab.test.js', [
      "const fs = require('fs'), path = require('path');",
      "console.log('root', fs.realpathSync(path.join(__dirname, '..')));",
      "for (const name of ['@scope/a', 'tiny', '@scope/ext']) console.log(name, require.resolve(name), require(name));",
      BUILT_TEST_OF(2),
    ].join('\n'));
    const { code, out, err } = runScript(w, ['packages/a/index.js', '--', 'node', 'tests/ab.test.js'], w.repo, msysEnv(w));
    const live = fs.realpathSync(w.repo);
    const root = field(out, 'root');
    assert(root !== '' && root !== live, `the test ran in a copy, not the live root: ${out}${err}`);
    const [a, tiny, ext] = ['@scope/a', 'tiny', '@scope/ext'].map((name) => field(out, name).split(' '));
    assert(a[0].startsWith(`${root}${path.sep}`), `the workspace link resolved inside the copy ${root}: ${a[0]}`);
    assertEq(a[1], '1', `the copy's package loaded, not the live one: ${out}`);
    assertEq(tiny[1], '5', `the plain entry reached: ${out}${err}`);
    assert(tiny[0].startsWith(`${live}${path.sep}`), `the plain entry is the live repo's: ${tiny[0]}`);
    assertEq(ext[1], '6', `the scoped entry reached: ${out}${err}`);
    assert(ext[0].startsWith(`${live}${path.sep}`), `the scoped entry is the live repo's: ${ext[0]}`);
    assert(out.includes('b old 1'), `the snapshot's build of @scope/b loaded the copy's @scope/a: ${out}${err}`);
    assert(err.includes('a via b is 1'), `the assertion ran: ${err}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertEq(fs.readFileSync(path.join(w.repo, 'packages', 'b', 'dist', 'index.js'), 'utf8'), BUILT('new'), 'the live build is intact');
    assert(fs.lstatSync(path.join(w.repo, 'node_modules', '@scope', 'a')).isSymbolicLink(), 'the live workspace link is intact');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: the copy');

  await test('a named directory: every file under it is the snapshot\'s in the copy', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('src/y.js', 'module.exports = 20;\n');
    const check = "const x = require('./src/x'), y = require('./src/y'); console.log('pair', x, y);"
      + ' process.exit(x === 1 && y === 10 ? 0 : 1);';
    const { code, out, err } = runScript(w, ['src/', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the check passed on the snapshot's values: ${out}${err}`);
    assert(out.includes('pair 1 10'), `both the snapshot's: ${out}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('the root node_modules is reachable from the copy', () => {
    const w = mkWorld();
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', `console.log('tiny', require('tiny'));\n${TEST_OF(2)}`);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 0, `exit 0: ${err}`);
    assert(out.includes('tiny 5'), `the package resolved: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `red on the edited source: ${out}`);
    assertEq(fs.readFileSync(path.join(w.repo, 'node_modules', 'tiny', 'index.js'), 'utf8'),
      'module.exports = 5;\n', 'the real node_modules is intact');
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a tracked file deleted in the working tree, not named, is deleted in the copy', () => {
    const w = mkWorld();
    takeSnapshot(w);
    fs.rmSync(path.join(w.repo, 'src', 'helper.js'));
    const check = "process.exit(require('fs').existsSync('src/helper.js') ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(code, 0, `exit 0, the copy lacks it: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `red: ${out}`);
    cleanup(w.dir);
  });

  await test('an edited path with a space in its name, not named, reaches the copy', () => {
    const w = mkWorld();
    w.write('src/a b.txt', 'old\n');
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'spaced');
    takeSnapshot(w);
    w.write('src/a b.txt', 'new\n');
    const check = "process.exit(require('fs').readFileSync('src/a b.txt', 'utf8') === 'new\\n' ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the edit: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a renamed file, not named: the copy has the new name and lacks the old', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.git('mv', 'src/helper.js', 'src/moved.js');
    const check = "const fs = require('fs'); process.exit(fs.existsSync('src/moved.js') && !fs.existsSync('src/helper.js') ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the rename whole: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a live symlink in the working diff arrives as a symlink', () => {
    const w = mkWorld();
    takeSnapshot(w);
    fs.symlinkSync('x.js', path.join(w.repo, 'src', 'link.js'));
    const check = "process.exit(require('fs').lstatSync('src/link.js').isSymbolicLink() ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/y.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the link: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/y.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a dangling symlink in the working diff arrives as one, never a stop', () => {
    const w = mkWorld();
    takeSnapshot(w);
    fs.symlinkSync('nowhere.js', path.join(w.repo, 'src', 'dead.js'));
    const check = "process.exit(require('fs').lstatSync('src/dead.js').isSymbolicLink() ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/y.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the dangling link: ${out}${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: workspaces');

  await test('a workspace package name loads the copy\'s files: red on its named source, exit 0', () => {
    const w = mkWorkspaces();
    takeSnapshot(w);
    w.write('packages/a/index.js', 'module.exports = 2;\n');
    w.write('tests/a.test.js', WS_TEST_OF(2));
    const { code, out, err } = runScript(w, ['packages/a/index.js', '--', 'node', 'tests/a.test.js']);
    const resolved = field(out, 'resolved');
    const root = field(out, 'root');
    assert(root !== '' && root !== w.repo, `the test ran in a copy, not the live root: ${out}`);
    assert(resolved.startsWith(`${root}${path.sep}`), `@scope/a resolved under the copy ${root}: ${resolved}`);
    assert(!resolved.startsWith(`${w.repo}${path.sep}`), `never under the live root ${w.repo}: ${resolved}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assert(err.includes('a is 1'), `the snapshot's package source ran: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a package\'s own node_modules is reachable from the copy: dep resolves, green, exit 1', () => {
    const w = mkWorkspaces();
    takeSnapshot(w);
    w.write('packages/a/index.js', 'module.exports = 2;\n');
    const { code, out, err } = runScript(w, ['packages/a/index.js', '--', 'node', 'packages/a/dep.test.js']);
    assert(out.includes('dep 7 '), `dep resolved through packages/a/node_modules: ${out}${err}`);
    assert(field(out, 'dep').endsWith(path.join('packages', 'a', 'node_modules', 'dep', 'index.js')),
      `the nested package's file: ${out}`);
    assertEq(code, 1, `exit 1: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without packages/a/index.js', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: a command that cannot run');

  await test('a command not on PATH: exit 2, never red', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'definitely-not-a-command']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red') && !out.includes('red-proof: green'), `no verdict: ${out}`);
    assertEq(lines(err).pop(), 'red-proof: command not runnable: definitely-not-a-command', `the last stderr line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a node test file the copy lacks: exit 2, naming it, never red', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '--test', 'nope.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red'), `no verdict: ${out}`);
    assertEq(lines(err).pop(), 'red-proof: test file not in the copy: nope.test.js', `the last stderr line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: naming a path');

  await test('an absolute path to the source: red, exit 0', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', TEST_OF(2));
    const abs = shellPath(path.join(w.repo, 'src', 'x.js'));
    const { code, out, err } = runScript(w, [abs, '--', 'node', 'tests/x.test.js']);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a ../ path from a nested directory: red, exit 0', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', TEST_OF(2));
    const { code, out, err } = runScript(w, ['../src/x.js', '--', 'node', 'x.test.js'], path.join(w.repo, 'tests'));
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a path in neither the tree nor the working diff: exit 2, naming it', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const { code, out, err } = runScript(w, ['src/typo.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assertEq(out, '', 'nothing on stdout, the command never ran');
    assertEq(err, "red-proof: src/typo.js is not in this repo's tree or working diff\n", `the one line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a path outside the repo: exit 2, naming it', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const outside = shellPath(w.tmp);
    const { code, out, err } = runScript(w, [outside, '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assertEq(err, `red-proof: ${outside} is not in this repo's tree or working diff\n`, `the one line: ${err}`);
    cleanup(w.dir);
  });

  group('red-proof.sh: usage');

  await test('no --, no path, no command: exit 2 with one red-proof: line', () => {
    const w = mkWorld();
    takeSnapshot(w);
    for (const args of [['src/x.js', 'node', 'tests/x.test.js'], ['--', 'node', 'tests/x.test.js'], ['src/x.js', '--']]) {
      const { code, out, err } = runScript(w, args);
      assertEq(code, 2, `exit 2 for ${args.join(' ')}: ${err}`);
      assertEq(out, '', `nothing on stdout for ${args.join(' ')}`);
      assertEq(lines(err).length, 1, `one stderr line for ${args.join(' ')}: ${err}`);
      assert(err.startsWith('red-proof: '), `a red-proof: line: ${err}`);
    }
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('outside a git repo: exit 2 with a red-proof: line', () => {
    const w = mkWorld();
    const { code, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js'], w.tmp);
    assertEq(code, 2, `exit 2: ${err}`);
    assert(lines(err).length === 1 && err.startsWith('red-proof: '), `one red-proof: line: ${err}`);
    cleanup(w.dir);
  });

  await test('a directory the copy cannot enter: exit 2 with a red-proof: line, never a verdict', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const only = path.join(w.repo, 'new');
    fs.mkdirSync(only);
    const { code, out, err } = runScript(w, ['../src/x.js', '--', 'false'], only);
    assertEq(code, 2, `exit 2, an internal failure: ${out}${err}`);
    assert(!out.includes('red-proof: green') && !out.includes('red-proof: red'), `no verdict: ${out}`);
    assert(lines(err).pop().startsWith('red-proof: '), `a red-proof: line last: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: a module that fails to load');

  await test('a test failing on Cannot find module: exit 2 naming the module, never red', () => {
    const w = mkWorld();
    takeSnapshot(w);
    w.write('tests/x.test.js', `require('nope-missing');\n${TEST_OF(1)}`);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red') && !out.includes('red-proof: green'), `no verdict: ${out}`);
    assert(err.includes("Cannot find module 'nope-missing'"), `the command's output still printed: ${err}`);
    assertEq(lines(err).pop(), 'red-proof: not runnable: a module failed to load: nope-missing', `the last stderr line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('load-error text naming paths outside the copy, beside a real assertion failure: red, exit 0', () => {
    const w = mkWorld();
    takeSnapshot(w);
    const elsewhere = path.join(w.dir, 'elsewhere');
    const quoted = [
      `Error: Cannot find module '${path.join(elsewhere, 'x.js')}'`,
      'Require stack:',
      `- ${path.join(elsewhere, 'y.js')}`,
      "  code: 'MODULE_NOT_FOUND',",
    ].join('\n');
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', `console.error(${JSON.stringify(quoted)});\n${TEST_OF(2)}`);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assert(err.includes('MODULE_NOT_FOUND') && err.includes('x is 1'), `both the quoted text and the assertion printed: ${err}`);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: red', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('an ESM import failing with ERR_MODULE_NOT_FOUND: exit 2, never red', () => {
    const w = mkWorld();
    w.write('tests/esm.test.mjs', "import '../src/gone.mjs';\n");
    w.git('add', '-A');
    w.git('commit', '-q', '-m', 'esm');
    takeSnapshot(w);
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/esm.test.mjs']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red') && !out.includes('red-proof: green'), `no verdict: ${out}`);
    assert(err.includes('ERR_MODULE_NOT_FOUND'), `the command's output still printed: ${err}`);
    const last = lines(err).pop();
    assert(last.startsWith('red-proof: not runnable: a module failed to load: ') && last.endsWith('gone.mjs'),
      `the last stderr line names the module: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
