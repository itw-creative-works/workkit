// Tests for scripts/red-proof.sh: the tests run in a copy of the tree where the
// named source paths are as HEAD has them. Every case is a real throwaway git
// repo with a tiny source and a plain-node test; nothing is stubbed. TMPDIR is
// the case's own, so the worktree the script makes is seen to go.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, NO_RC, shellPath } = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'red-proof.sh');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

const TEST_OF = (value) => [
  "const x = require('../src/x');",
  `if (x !== ${value}) throw new Error('x is ' + x);`,
  '',
].join('\n');

/**
 * A scratch world: a repo holding `src/x.js` (exports 1), `src/y.js` (exports
 * 10), `src/helper.js`, a `.gitignore` for node_modules and `tests/x.test.js`
 * asserting 1, all committed; a home and a TMPDIR of its own beside it.
 */
const mkWorld = () => mkRepo('red-proof-', {
  'src/x.js': 'module.exports = 1;\n',
  'src/y.js': 'module.exports = 10;\n',
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

/**
 * A scratch workspaces repo: a root package.json with `workspaces`, the package
 * `packages/a` (exports 1) behind the relative link `node_modules/@scope/a`, and
 * `packages/a/node_modules/dep` (exports 7). Both node_modules are ignored.
 */
const mkWorkspaces = () => {
  const w = mkRepo('red-proof-ws-', {
    'package.json': `${JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })}\n`,
    '.gitignore': 'node_modules/\n',
    'packages/a/package.json': `${JSON.stringify({ name: '@scope/a', main: 'index.js' })}\n`,
    'packages/a/index.js': 'module.exports = 1;\n',
    'packages/a/dep.test.js': "console.log('dep', require('dep'), require.resolve('dep'));\n",
    'tests/a.test.js': WS_TEST_OF(1),
  });
  fs.mkdirSync(path.join(w.repo, 'node_modules', '@scope'), { recursive: true });
  fs.symlinkSync(path.join('..', '..', 'packages', 'a'), path.join(w.repo, 'node_modules', '@scope', 'a'), 'dir');
  w.write('packages/a/node_modules/dep/index.js', 'module.exports = 7;\n');
  return w;
};

const runScript = (w, args, cwd = w.repo) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
    cwd, env: w.env, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `the script finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const lines = (out) => out.split('\n').filter(Boolean);

/** The value after `<tag> ` on the stdout line that starts with it. */
const field = (out, tag) => (lines(out).find((l) => l.startsWith(`${tag} `)) || '').slice(tag.length + 1);

/** The worktree is gone: one `git worktree list` line, nothing left in TMPDIR. */
const assertNoWorktree = (w) => {
  assertEq(lines(w.git('worktree', 'list')).length, 1, 'git worktree list is back to one entry');
  assertEq(fs.readdirSync(w.tmp).length, 0, `nothing left in TMPDIR: ${fs.readdirSync(w.tmp)}`);
};

const run = async () => {
  group('red-proof.sh: the verdict');

  await test('an edited source the new test needs: red, exit 0, the shared tree untouched', () => {
    const w = mkWorld();
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
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('tests/x.test.js', "require('../src/x');\nconsole.log('always fine');\n");
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 1, `exit 1: ${err}`);
    assert(out.includes('always fine'), `the command's stdout passed through: ${out}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: the copy');

  await test('an untracked named source is absent from the copy', () => {
    const w = mkWorld();
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

  await test('a named directory: every file under it is HEAD\'s in the copy', () => {
    const w = mkWorld();
    w.write('src/x.js', 'module.exports = 2;\n');
    w.write('src/y.js', 'module.exports = 20;\n');
    const check = "const x = require('./src/x'), y = require('./src/y'); console.log('pair', x, y);"
      + ' process.exit(x === 1 && y === 10 ? 0 : 1);';
    const { code, out, err } = runScript(w, ['src/', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the check passed on HEAD's values: ${out}${err}`);
    assert(out.includes('pair 1 10'), `both HEAD's: ${out}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('the root node_modules is reachable from the copy', () => {
    const w = mkWorld();
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
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
    w.write('src/a b.txt', 'new\n');
    const check = "process.exit(require('fs').readFileSync('src/a b.txt', 'utf8') === 'new\\n' ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the edit: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a renamed file, not named: the copy has the new name and lacks the old', () => {
    const w = mkWorld();
    w.git('mv', 'src/helper.js', 'src/moved.js');
    const check = "const fs = require('fs'); process.exit(fs.existsSync('src/moved.js') && !fs.existsSync('src/helper.js') ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the rename whole: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/x.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a live symlink in the working diff arrives as a symlink', () => {
    const w = mkWorld();
    fs.symlinkSync('x.js', path.join(w.repo, 'src', 'link.js'));
    const check = "process.exit(require('fs').lstatSync('src/link.js').isSymbolicLink() ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/y.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the link: ${out}${err}`);
    assertEq(lines(out).pop(), 'red-proof: green: the tests pass without src/y.js', `the last stdout line: ${out}`);
    cleanup(w.dir);
  });

  await test('a dangling symlink in the working diff arrives as one, never a stop', () => {
    const w = mkWorld();
    fs.symlinkSync('nowhere.js', path.join(w.repo, 'src', 'dead.js'));
    const check = "process.exit(require('fs').lstatSync('src/dead.js').isSymbolicLink() ? 0 : 1)";
    const { code, out, err } = runScript(w, ['src/y.js', '--', 'node', '-e', check]);
    assertEq(code, 1, `exit 1, the copy holds the dangling link: ${out}${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  group('red-proof.sh: workspaces');

  await test('a workspace package name loads the copy\'s files: red on its edited source, exit 0', () => {
    const w = mkWorkspaces();
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
    assert(err.includes('a is 1'), `HEAD's package source ran: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a package\'s own node_modules is reachable from the copy: dep resolves, green, exit 1', () => {
    const w = mkWorkspaces();
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
    const { code, out, err } = runScript(w, ['src/x.js', '--', 'definitely-not-a-command']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assert(!out.includes('red-proof: red') && !out.includes('red-proof: green'), `no verdict: ${out}`);
    assertEq(lines(err).pop(), 'red-proof: command not runnable: definitely-not-a-command', `the last stderr line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a node test file the copy lacks: exit 2, naming it, never red', () => {
    const w = mkWorld();
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
    const { code, out, err } = runScript(w, ['src/typo.js', '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assertEq(out, '', 'nothing on stdout, the command never ran');
    assertEq(err, "red-proof: src/typo.js is not in this repo's tree or working diff\n", `the one line: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  await test('a path outside the repo: exit 2, naming it', () => {
    const w = mkWorld();
    const outside = shellPath(w.tmp);
    const { code, out, err } = runScript(w, [outside, '--', 'node', 'tests/x.test.js']);
    assertEq(code, 2, `exit 2: ${out}${err}`);
    assertEq(err, `red-proof: ${outside} is not in this repo's tree or working diff\n`, `the one line: ${err}`);
    cleanup(w.dir);
  });

  group('red-proof.sh: usage');

  await test('no --, no path, no command: exit 2 with one red-proof: line', () => {
    const w = mkWorld();
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
    const only = path.join(w.repo, 'new');
    fs.mkdirSync(only);
    const { code, out, err } = runScript(w, ['../src/x.js', '--', 'false'], only);
    assertEq(code, 2, `exit 2, an internal failure: ${out}${err}`);
    assert(!out.includes('red-proof: green') && !out.includes('red-proof: red'), `no verdict: ${out}`);
    assert(lines(err).pop().startsWith('red-proof: '), `a red-proof: line last: ${err}`);
    assertNoWorktree(w);
    cleanup(w.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
