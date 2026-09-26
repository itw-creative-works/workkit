//
// Tests for hooks/safety/commit-gate: the test suite, which must pass and runs
// only for commits carrying code (issue #151).
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { SYSTEM_BASH } = require('../../lib/platform');
const { skipWithoutDigest, HOOK, mkRepo, stage, stageDeep, touchMarker, dropMarker, runHook, cleanup, pkg, suiteRan, mkReleaseRepo } = require('./helpers');

// Check 5 (the suite, its deadline and its clamp) lives in the gate's checks/
// piece; the header that names the budget's home stays in run.sh.
const SUITE_CHECK = path.join(path.dirname(HOOK), 'checks', 'proof-suite.sh');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: tests must pass');

  await test('failing test script: exit 2 with output tail', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"echo BOOM && exit 1"}}');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'red suite must block the commit');
    assert(stderr.includes('BOOM'), 'carries the failure output');
    cleanup(dir);
  });

  await test('passing test script + marker: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `green suite + review passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('suite that outruns the gate deadline: exit 2, tree terminated (#93)', async () => {
    // The failure this pins: a suite longer than the harness's hook timeout
    // used to get the hook cancelled, and a cancelled hook is silently ALLOW.
    // The gate now ends the run at its own deadline and bounces.
    const dir = mkRepo();
    stage(dir, 'package.json',
      '{"scripts":{"test":"echo $$ > gate.pid && sleep 30"}}');
    touchMarker(dir);
    const before = Date.now();
    // Deadline 5, not 1 or 2: bash's integer SECONDS can round a 1s deadline
    // down toward the poll floor, and on a loaded machine (this suite running
    // inside the real gate's own run) npm can take past 2s to boot the fake
    // suite, either way gate.pid would not exist yet when the deadline ends
    // the run. 5s stays far under the 15s decision assertion below.
    const { code, stderr } = runHook(dir, 'git commit -m "x"', undefined,
      { WORKKIT_GATE_TEST_DEADLINE: '5' });
    assertEq(code, 2, 'an unproven suite must block, never allow');
    assert(stderr.includes('deadline'), 'names the deadline as the reason');
    assert(Date.now() - before < 15000, 'the gate decided well before the suite would have finished');
    assert(fs.existsSync(path.join(dir, 'gate.pid')), 'the suite had started before the deadline ended it');
    const pid = Number(fs.readFileSync(path.join(dir, 'gate.pid'), 'utf8').trim());
    // Ended is answered by WAITING for it, not by one instant. The gate kills
    // the tree from the leaves up, so the process it recorded loses its parent
    // in the same breath it is killed: until the kernel hands that orphan to
    // init and init reaps it, the pid is a ZOMBIE: dead, and still answering
    // kill(pid, 0). How long that gap lasts is the machine's business, and on a
    // Linux runner it outlived the assertion (#114). A suite that was genuinely
    // left running answers for its full 30 seconds, so neither exit is hidden:
    // this waits for gone-or-zombie and names the state it found if it gets
    // neither.
    const state = () => (spawnSync('ps', ['-o', 'state=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim();
    const gone = () => { try { process.kill(pid, 0); return false; } catch { return true; } };
    let ended = gone() || state().startsWith('Z');
    const until = Date.now() + 5000;
    while (!ended && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
      ended = gone() || state().startsWith('Z');
    }
    assert(ended, `the suite process tree was ended, not left running (ps state: ${state() || 'none'})`);
    cleanup(dir);
  });

  await test('the gate deadline sits under its declared hook timeout (#93)', () => {
    // The invariant: the gate must decide BEFORE the harness would cancel it:
    // a cancelled hook is a silent allow, which is the whole defect.
    const hooksJson = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entry = hooksJson.hooks.PreToolUse
      .flatMap((m) => m.hooks)
      .find((h) => h.command.includes('safety:commit-gate'));
    assert(entry && entry.timeout > 0, 'the gate declares its own timeout');
    const script = fs.readFileSync(SUITE_CHECK, 'utf8');
    const m = script.match(/WORKKIT_GATE_TEST_DEADLINE:-(\d+)/);
    assert(m, 'the gate has a default deadline');
    assert(Number(m[1]) < entry.timeout, 'and it fires before the harness cancels the hook');
  });

  await test('the hook timeout leaves headroom for a raised per-repo budget (#189)', () => {
    // Grown suites raise WORKKIT_GATE_TEST_DEADLINE in their own settings; the
    // declared timeout must sit above any such raise or the harness cancels the
    // hook mid-suite and the cancellation is a silent allow.
    const hooksJson = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entry = hooksJson.hooks.PreToolUse
      .flatMap((m) => m.hooks)
      .find((h) => h.command.includes('safety:commit-gate'));
    assertEq(entry.timeout, 3000, 'the declared timeout is 3000s');
    const script = fs.readFileSync(SUITE_CHECK, 'utf8');
    assert(/WORKKIT_GATE_TEST_DEADLINE:-1500/.test(script),
      'the default budget stays 1500s for small repos');
    assert(fs.readFileSync(HOOK, 'utf8').includes('.claude/settings.json'),
      'the header names where a repo raises its budget');
    assert(/\[ "\$deadline" -gt 2900 \].*deadline=2900/.test(script),
      'an over-raise clamps back under the hook timeout');
  });

  group('commit-gate: the suite runs only for commits carrying code (issue #151)');

  // Every case here proves the RUN, not the exit code: the fixture's test
  // script leaves a sentinel and then fails, so a suite that ran is visible as
  // the file (and as the bounce), and a suite that stood down leaves neither.
  await test('docs-only commit: the suite does not run', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'README.md', '# docs\n');
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "docs: readme"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    assert(!suiteRan(dir), 'a docs-only commit never starts the suite');
    cleanup(dir);
  });

  await test('version-only root package.json bump: the suite does not run', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "chore(release): 1.0.1"');
    assertEq(code, 0, `the release commit's shape passes, got: ${stderr}`);
    assert(!suiteRan(dir), 'the version stamp is generated bookkeeping, not code');
    cleanup(dir);
  });

  await test('version bump plus a second changed key: gates as code', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1', { description: 'now with a second change' }));
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(first.code, 2, 'any second change restores code classification');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded as today, got: ${first.stderr}`);
    assert(!suiteRan(dir), 'the review bounce comes before the suite');
    touchMarker(dir);
    const second = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(second.code, 2, 'and past the marker the suite runs and its failure blocks');
    assert(suiteRan(dir), 'the suite ran');
    cleanup(dir);
  });

  await test('a code file alongside the version bump: the suite runs', () => {
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    stage(dir, 'app.js', 'const x = 2;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: thing"');
    assertEq(code, 2, 'any staged code line still gates on the suite');
    assert(stderr.includes('test suite failed'), `for the suite reason, got: ${stderr}`);
    assert(suiteRan(dir), 'the suite ran');
    cleanup(dir);
  });

  // The other file a repo keeps its version in: a plugin repo (this one
  // included) bumps both in the same release commit.
  const manifest = (version, extra) => `${JSON.stringify({
    name: 'fixture', version, description: 'a plugin', ...extra,
  }, null, 2)}\n`;

  const mkPluginRepo = () => {
    const dir = mkReleaseRepo();
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.0'));
    execSync('git commit -q -m "manifest" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    return dir;
  };

  await test('version-only plugin.json bump: the suite does not run', () => {
    const dir = mkPluginRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.1'));
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "chore(release): 1.0.1"');
    assertEq(code, 0, `the plugin release commit's shape passes, got: ${stderr}`);
    assert(!suiteRan(dir), 'both version stamps are bookkeeping, not code');
    cleanup(dir);
  });

  await test('plugin.json version bump plus a second changed key: gates as code', () => {
    const dir = mkPluginRepo();
    stageDeep(dir, '.claude-plugin/plugin.json', manifest('1.0.1', { description: 'reworded' }));
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(first.code, 2, 'any second change restores code classification');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded, got: ${first.stderr}`);
    touchMarker(dir);
    const second = runHook(dir, 'git commit -m "chore: bump"');
    assertEq(second.code, 2, 'and past the marker the suite runs and its failure blocks');
    assert(suiteRan(dir), 'the suite ran');
    cleanup(dir);
  });

  await test('a script under a docs PATH is code: the suite runs (review finding)', () => {
    // hooks/docs/*/run.sh is executable bash living under a docs directory:
    // six of them in this repo. Classifying it as docs would let a hook change
    // commit with no suite and no review marker. Seeded first, then modified,
    // so check 1 (new source needs tests) is not what answers.
    const dir = mkReleaseRepo();
    stageDeep(dir, 'hooks/docs/x/run.sh', '#!/bin/bash\necho hi\n');
    execSync('git commit -q -m "hook" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stageDeep(dir, 'hooks/docs/x/run.sh', '#!/bin/bash\necho tweaked\n');
    dropMarker(dir);
    const first = runHook(dir, 'git commit -m "fix: the hook"');
    assertEq(first.code, 2, 'a code extension wins over the docs path');
    assert(first.stderr.includes('workkit:review'), `the review marker is demanded, got: ${first.stderr}`);
    touchMarker(dir);
    const second = runHook(dir, 'git commit -m "fix: the hook"');
    assertEq(second.code, 2, 'and the suite runs for it');
    assert(suiteRan(dir), 'the suite ran');
    cleanup(dir);
  });

  await test('a .md under a docs path is still docs: the suite does not run', () => {
    const dir = mkReleaseRepo();
    stageDeep(dir, 'docs/notes.md', '# notes\n');
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "docs: notes"');
    assertEq(code, 0, `the docs basenames are unchanged, got: ${stderr}`);
    assert(!suiteRan(dir), 'a docs file under docs/ still stands the suite down');
    cleanup(dir);
  });

  await test('-am: the working tree decides the version bump, not the index', () => {
    // The -a/--all arm of the helper: what the commit CARRIES is the working
    // tree, so an edit past the version there is code even when the index holds
    // a clean bump.
    const clean = mkReleaseRepo();
    stage(clean, 'package.json', pkg('1.0.1'));
    dropMarker(clean);
    const bump = runHook(clean, 'git commit -am "chore(release): 1.0.1"');
    assertEq(bump.code, 0, `a -am version-only bump still passes, got: ${bump.stderr}`);
    assert(!suiteRan(clean), 'and stands the suite down');
    cleanup(clean);

    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.0.1'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('1.0.1', { description: 'edited past the bump' }));
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -am "chore(release): 1.0.1"');
    assertEq(code, 2, 'the unstaged second change is what -a would carry');
    assert(suiteRan(dir), `the suite ran, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a NESTED package.json version bump is code: the suite runs', () => {
    // The carve-out is the root package.json alone; a workspace member's
    // version is not the release tooling's stamp on this repo.
    const dir = mkReleaseRepo();
    stageDeep(dir, 'sub/package.json', pkg('1.0.0'));
    execSync('git commit -q -m "sub" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stageDeep(dir, 'sub/package.json', pkg('1.0.1'));
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "chore: bump sub"');
    assertEq(code, 2, 'a nested package.json stays code');
    assert(suiteRan(dir), `the suite ran, got: ${stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
