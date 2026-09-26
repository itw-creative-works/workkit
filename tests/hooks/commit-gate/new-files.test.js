//
// Tests for hooks/safety/commit-gate: new source files need tests (the test-TYPE proxy).
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { SYSTEM_BASH } = require('../../lib/platform');
const { skipWithoutDigest, mkRepo, stage, touchMarker, runHook, cleanup } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: new source files need tests (test-TYPE proxy)');

  await test('new .js file, no test file staged: exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'new source without tests must block');
    assert(stderr.includes('test file'), 'names the missing tests');
    assert(stderr.includes('thing.js'), 'names the offending file');
    cleanup(dir);
  });

  await test('new .js file WITH a test file staged: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    stage(dir, 'thing.test.js', 'require("./thing");\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `test file present → passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('new .js file in a repo with NO test script: proxy skipped, exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, 'repos without a test script are not asked to start here');
    cleanup(dir);
  });

  await test('MODIFIED .js file (not added): proxy skipped, exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    execSync('git commit -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'thing.js', 'module.exports = 2;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `only ADDED files trigger the proxy, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('commit from a SUBDIRECTORY is gated identically (review regression)', () => {
    // package.json and npm test are judged at the repo ROOT, not the session
    // cwd: a session sitting in repo/src must not slip past the proxy.
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    fs.mkdirSync(path.join(dir, 'src'));
    touchMarker(dir);
    const { code, stderr } = runHook(path.join(dir, 'src'), 'git commit -m "x"');
    assertEq(code, 2, 'subdir cwd must not skip the proxy');
    assert(stderr.includes('test file'), 'same proxy message as from the root');
    cleanup(dir);
  });

  await test('staged test-file DELETION does not satisfy the proxy (review regression)', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    fs.mkdirSync(path.join(dir, 'tests'));
    stage(dir, 'tests/old.test.js', 'x;\n');
    execSync('git commit -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    execSync('git rm -q tests/old.test.js', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'a deleted test file is not "touching tests"');
    cleanup(dir);
  });

  await test('new config/test-named files are exempt: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'eslint.config.mjs', 'export default [];\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `config files need no tests, stderr: ${stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
