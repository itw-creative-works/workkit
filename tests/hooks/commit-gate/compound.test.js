//
// Tests for hooks/safety/commit-gate: stage-and-commit compounds fail closed,
// check 5 never stands down silently (issue #155), and the loader wiring.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { skipWithoutDigest, TMP, mkRepo, stage, dropMarker, runHook, standDownMessage, cleanup, suiteRan, mkReleaseRepo } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: stage-and-commit compounds fail closed (issue #155)');

  await test('git add -A && git commit over a CLEAN index: exit 2', () => {
    // The regression this pins: the gate is PreToolUse, so it read the index
    // BEFORE the `add` ran. Over a clean index the empty file list hit the
    // fail-open and every check stood down, silently.
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git add -A && git commit -m "feat(x): y"');
    assertEq(code, 2, 'a command that stages its own content is ungateable and must fail closed');
    assert(stderr.includes('stages and commits'), `names the rule, got: ${stderr}`);
    cleanup(dir);
  });

  await test('the same compound with the change ALREADY staged: still exit 2', () => {
    // A populated index is no answer: the `add` may stage more than the gate saw.
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git add -A && git commit -m "docs: readme"');
    assertEq(code, 2, 'the add could still widen what the commit carries');
    assert(stderr.includes('stages and commits'), `names the rule, got: ${stderr}`);
    cleanup(dir);
  });

  await test('rm / mv / stage compounds are the same shape: exit 2', () => {
    for (const c of ['git rm old.js && git commit -m "chore: drop it"',
      'git mv a.js b.js && git commit -m "chore: move it"',
      'git stage app.js; git commit -m "feat: thing"']) {
      const dir = mkRepo();
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `must fail closed: ${c}, got: ${stderr}`);
      assert(stderr.includes('stages and commits'), `names the rule: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a staging clause AFTER the commit is not the rule: exit 0', () => {
    // The clause walk breaks at the commit, so only what precedes it can change
    // what the commit carries.
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git commit -m "docs: readme" && git add -A');
    assertEq(code, 0, `staging after the commit changes nothing it carries, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a quoted MENTION of staging does not trigger the rule: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git commit -m "then git add -A"');
    assertEq(code, 0, `the quote strip hides the mention, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: check 5 never stands down silently (issue #155)');

  await test('docs-only commit in a repo with a test script: exit 0, and says why', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'README.md', '# docs\n');
    dropMarker(dir);
    const out = runHook(dir, 'git commit -m "docs: readme"');
    assertEq(out.code, 0, `allowed, got: ${out.stderr}`);
    assert(!suiteRan(dir), 'the suite still stands down');
    const msg = standDownMessage(out);
    assert(msg.includes('suite not run'), `and names the stand-down, got: ${out.stdout}`);
    assert(msg.includes('no code'), `with its classification, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('nothing staged in a repo with a test script: exit 0, and says why', () => {
    const dir = mkReleaseRepo();
    dropMarker(dir);
    const out = runHook(dir, 'git commit -m "chore: nothing"');
    assertEq(out.code, 0, `an empty index passes through, got: ${out.stderr}`);
    const msg = standDownMessage(out);
    assert(msg.includes('nothing to judge'), `names what stood down, got: ${out.stdout}`);
    assert(msg.includes('nothing staged'), `with its reason, got: ${out.stdout}`);
    cleanup(dir);
  });

  await test('a repo with NO test script is never told about a suite: exit 0, silent', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const out = runHook(dir, 'git commit -m "docs: readme"');
    assertEq(out.code, 0, 'docs-only commit passes');
    assertEq(standDownMessage(out), '', `a repo without tests is not asked about them, got: ${out.stdout}`);
    cleanup(dir);
  });

  group('commit-gate: wiring (loader + settings)');

  const LOADER = path.join(__dirname, '..', '..', '..', 'hooks', 'loader.sh');

  await test('loader routes safety:commit-gate to the script (colon spelling)', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const input = JSON.stringify({ cwd: shellPath(dir), tool_input: { command: 'git commit -m "x"' } });
    const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), 'safety:commit-gate'], {
      input,
      env: { ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 60000,
    });
    assertEq(res.status, 2, 'the loader must reach the gate and propagate its block');
    assert((res.stderr || '').includes('workkit:review'), 'the gate answered, not the loader fail-open');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
