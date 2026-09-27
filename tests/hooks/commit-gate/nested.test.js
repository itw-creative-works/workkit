//
// Tests for hooks/safety/commit-gate: the nested pass of check 5, where a
// nested package whose folder holds a change in the commit runs its own test
// script after the root's, under the same budget.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { SYSTEM_BASH } = require('../../lib/platform');
const {
  skipWithoutDigest, mkRepo, stage, stageDeep, touchMarker, runHook, standDownMessage, cleanup, pkg, suiteRan,
} = require('./helpers');

// The root's own suite, green, so every case is about the nested pass alone.
const GREEN_ROOT = '{"scripts":{"test":"exit 0"}}\n';
// A nested suite that leaves a line per run in its own folder, then passes.
const greenPkg = () => pkg('1.0.0', { scripts: { test: 'echo ran >> suite-ran' } });

// Every file seeded in one commit first, so each case stages only EDITS: check
// 1 (new source needs tests) is never what answers.
const mkNested = (files, root = GREEN_ROOT) => {
  const dir = mkRepo();
  stage(dir, 'package.json', root);
  stage(dir, 'app.js', 'const x = 1;\n');
  for (const [name, content] of Object.entries(files)) stageDeep(dir, name, content);
  execSync('git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
  touchMarker(dir);
  return dir;
};

const runs = (dir) => (suiteRan(dir) ? fs.readFileSync(path.join(dir, 'suite-ran'), 'utf8').trim().split('\n').length : 0);

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: a nested package with a change runs its own suite (issue #337)');

  await test('a change inside sub/: its suite runs, and red blocks naming sub', () => {
    const dir = mkNested({ 'sub/package.json': pkg('1.0.0'), 'sub/index.js': 'const y = 1;\n' });
    stageDeep(dir, 'sub/index.js', 'const y = 2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, `a red nested suite blocks, got: ${stderr}`);
    assert(suiteRan(path.join(dir, 'sub')), 'the nested suite ran in its own folder');
    assert(stderr.includes('the test suite of sub failed'), `the bounce names the package, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a change outside every nested package: no nested run', () => {
    const dir = mkNested({ 'sub/package.json': pkg('1.0.0'), 'sub/index.js': 'const y = 1;\n' });
    stage(dir, 'app.js', 'const x = 2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `the root suite covered it, got: ${stderr}`);
    assert(!suiteRan(path.join(dir, 'sub')), 'an untouched package never runs');
    cleanup(dir);
  });

  await test('two nested packages touched: both run, each once', () => {
    const dir = mkNested({
      'a/package.json': greenPkg(), 'a/one.js': '1;\n', 'a/lib/two.js': '2;\n',
      'b/package.json': greenPkg(), 'b/index.js': '3;\n',
    });
    stageDeep(dir, 'a/one.js', '10;\n');
    stageDeep(dir, 'a/lib/two.js', '20;\n');
    stageDeep(dir, 'b/index.js', '30;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `both green, got: ${stderr}`);
    assertEq(runs(path.join(dir, 'a')), 1, 'a ran once for its two changed files');
    assertEq(runs(path.join(dir, 'b')), 1, 'b ran');
    cleanup(dir);
  });

  await test('a nested package with no test script: nothing extra runs', () => {
    const dir = mkNested({ 'sub/package.json': '{"name":"sub"}\n', 'sub/index.js': 'const y = 1;\n' });
    stageDeep(dir, 'sub/index.js', 'const y = 2;\n');
    const out = runHook(dir, 'git commit -m "x"');
    assertEq(out.code, 0, `no script, no run, got: ${out.stderr}`);
    assertEq(standDownMessage(out), '', `and nothing to say, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('a red root and a change in sub/: the root bounces, sub never runs', () => {
    const dir = mkNested({ 'sub/package.json': pkg('1.0.0'), 'sub/index.js': 'const y = 1;\n' }, pkg('1.0.0'));
    stageDeep(dir, 'sub/index.js', 'const y = 2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'the root red blocks');
    assert(stderr.includes('the test suite failed'), `the root's bounce, got: ${stderr}`);
    assert(suiteRan(dir), 'the root suite ran');
    assert(!suiteRan(path.join(dir, 'sub')), 'the nested suite never runs after a red root');
    cleanup(dir);
  });

  await test('a change under node_modules/: that package never runs', () => {
    const dir = mkNested({ 'node_modules/x/package.json': pkg('1.0.0'), 'node_modules/x/index.js': '1;\n' });
    stageDeep(dir, 'node_modules/x/index.js', '2;\n');
    stage(dir, 'app.js', 'const x = 2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `a vendored package is not the repo's, got: ${stderr}`);
    assert(!suiteRan(path.join(dir, 'node_modules', 'x')), 'node_modules/x never ran');
    cleanup(dir);
  });

  await test('a pathspec commit: no nested run, and says so in one line', () => {
    const dir = mkNested({ 'sub/package.json': pkg('1.0.0'), 'sub/index.js': 'const y = 1;\n' });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    const out = runHook(dir, 'git commit -m x app.js');
    assertEq(out.code, 0, `the green root decides it, got: ${out.stderr}`);
    assert(!suiteRan(path.join(dir, 'sub')), 'the nested pass cannot know the files, so it runs nothing');
    const msg = standDownMessage(out);
    assert(msg.includes('nested'), `names the nested pass, got: ${out.stdout}`);
    assert(msg.includes('pathspec'), `and why it stood down, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('a pathspec commit with the tested package under a non-ASCII folder: still says so', () => {
    const dir = mkNested({ 'caf\u00e9/package.json': pkg('1.0.0'), 'caf\u00e9/index.js': 'const y = 1;\n' });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    const out = runHook(dir, 'git commit -m x app.js');
    assertEq(out.code, 0, `the green root decides it, got: ${out.stderr}`);
    assert(standDownMessage(out).includes('nested'), `the folder reaches the walk unquoted, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('a nested suite past the deadline: exit 2, naming sub and the deadline', () => {
    // Deadline 5, decided under 15s: the same timing as the root's deadline case.
    const dir = mkNested({
      'sub/package.json': '{"scripts":{"test":"sleep 30"}}\n', 'sub/index.js': 'const y = 1;\n',
    });
    stageDeep(dir, 'sub/index.js', 'const y = 2;\n');
    const before = Date.now();
    const { code, stderr } = runHook(dir, 'git commit -m "x"', undefined, { WORKKIT_GATE_TEST_DEADLINE: '5' });
    assertEq(code, 2, 'an unproven nested suite blocks, never allows');
    assert(stderr.includes('of sub'), `names the package, got: ${stderr}`);
    assert(stderr.includes('5s deadline'), `names the deadline, got: ${stderr}`);
    assert(Date.now() - before < 15000, 'the one budget ended the run');
    cleanup(dir);
  });

  await test("a package without a test script never hides the tested one above it", () => {
    const dir = mkNested({ 'a/package.json': pkg('1.0.0'), 'a/b/package.json': '{"name":"b"}\n', 'a/b/index.js': '1;\n' });
    stageDeep(dir, 'a/b/index.js', '2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, `a's red suite gates the change, got: ${stderr}`);
    assert(suiteRan(path.join(dir, 'a')), "a's suite ran in its own folder");
    assert(stderr.includes('the test suite of a failed'), `the bounce names a, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a non-ASCII file name reaches the package walk unquoted', () => {
    const dir = mkNested({ 'sub/package.json': greenPkg(), 'sub/caf\u00e9.js': '1;\n' });
    stageDeep(dir, 'sub/caf\u00e9.js', '2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `green, got: ${stderr}`);
    assertEq(runs(path.join(dir, 'sub')), 1, "sub's suite ran for sub/caf\u00e9.js");
    cleanup(dir);
  });

  await test('a deadline that is not a number bounces, naming the value', () => {
    const dir = mkNested({ 'sub/package.json': greenPkg(), 'sub/index.js': '1;\n' });
    stageDeep(dir, 'sub/index.js', '2;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "x"', undefined, { WORKKIT_GATE_TEST_DEADLINE: 'abc' });
    assertEq(code, 2, 'an untimeable suite blocks, never allows');
    assert(stderr.includes("WORKKIT_GATE_TEST_DEADLINE is 'abc'"), `names the value, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a deadline with a leading zero is read in base ten', () => {
    // 09 is not octal: it must time the run at 9s, never crash into an allow.
    const dir = mkNested({ 'sub/package.json': '{"scripts":{"test":"sleep 30"}}\n', 'sub/index.js': '1;\n' });
    stageDeep(dir, 'sub/index.js', '2;\n');
    const before = Date.now();
    const { code, stderr } = runHook(dir, 'git commit -m "x"', undefined, { WORKKIT_GATE_TEST_DEADLINE: '09' });
    const took = Date.now() - before;
    assertEq(code, 2, `the 9s limit ended the run, got: ${stderr}`);
    assert(stderr.includes('of sub') && stderr.includes('s deadline'), `names sub and the deadline, got: ${stderr}`);
    assert(took >= 8000 && took < 20000, `decided at the 9s limit, took ${took}ms`);
    cleanup(dir);
  });

  await test('the root and nested runs share one budget', () => {
    // Each fits the deadline alone; together they do not, so only a shared budget bounces.
    const dir = mkNested({ 'sub/package.json': '{"scripts":{"test":"sleep 4"}}\n', 'sub/index.js': '1;\n' },
      '{"scripts":{"test":"sleep 3"}}\n');
    stageDeep(dir, 'sub/index.js', '2;\n');
    const before = Date.now();
    const { code, stderr } = runHook(dir, 'git commit -m "x"', undefined, { WORKKIT_GATE_TEST_DEADLINE: '5' });
    assertEq(code, 2, `the budget ran out inside sub, got: ${stderr}`);
    assert(stderr.includes('of sub'), `names the package, got: ${stderr}`);
    assert(stderr.includes('5s deadline'), `names the deadline, got: ${stderr}`);
    assert(Date.now() - before < 15000, 'decided inside the one budget');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
