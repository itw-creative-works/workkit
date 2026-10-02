// Tests for hooks/safety/commit-gate: a repo with no origin remote is a
// throwaway (a fixture, a scratch repo), outside the pipeline, so the gate
// stands aside there; the cd and -C blocks hold in every repo.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath } = require('../../lib/platform');
const { skipWithoutDigest, HOOK, WORKFLOW_DIR, TMP, mkRepo, stage, markerPath, touchMarker, dropMarker, runHook, cleanup } = require('./helpers');

// A throwaway repo: the fixture repo with its origin taken away.
const mkThrowawayRepo = () => {
  const dir = mkRepo();
  execSync('git remote remove origin', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
  return dir;
};

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: a repo with no origin');

  await test('no origin, staged code, no review marker: exit 0 and silent', () => {
    const dir = mkThrowawayRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const out = runHook(dir, 'git commit -m "pub 1"');
    assertEq(out.code, 0, `a throwaway repo is not held to the gate, got: ${out.stderr}`);
    assertEq(out.stderr, '', 'no stderr');
    assertEq(out.stdout, '', 'no stdout either');
    cleanup(dir);
  });

  await test('no origin, staged code, stale review marker: exit 0 and silent', () => {
    const dir = mkThrowawayRepo();
    touchMarker(dir);
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(markerPath(dir), past, past);
    stage(dir, 'app.js', 'const x = 1;\n');
    const out = runHook(dir, 'git commit -m "pub 1"');
    assertEq(out.code, 0, `a bad marker in a throwaway repo is not judged, got: ${out.stderr}`);
    assertEq(out.stderr, '', 'no stderr');
    assertEq(out.stdout, '', 'no stdout either');
    cleanup(dir);
  });

  await test('with an origin, staged code, no review marker: exit 2 as today', () => {
    // The control: the skip is scoped to a missing origin.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "pub 1"');
    assertEq(code, 2, 'a project repo still needs its review');
    assert(stderr.includes('workkit:review'), `names the fix, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: stage and commit in one call');

  await test('no origin, git add -A && git commit: exit 0 and silent', () => {
    const dir = mkThrowawayRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    const out = runHook(dir, 'git add -A && git commit -m "pub 1"');
    assertEq(out.code, 0, `a throwaway repo may stage and commit at once, got: ${out.stderr}`);
    assertEq(out.stderr, '', 'no stderr');
    assertEq(out.stdout, '', 'no stdout either');
    cleanup(dir);
  });

  await test('with an origin, git add -A && git commit: exit 2 naming the stage-first rule', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git add -A && git commit -m "pub 1"');
    assertEq(code, 2, 'a project repo still stages first');
    assert(stderr.includes('stages and commits'), `names the rule, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: cd and -C still block in a repo with no origin');

  await test('cd x && git commit: exit 2', () => {
    const dir = mkThrowawayRepo();
    const { code, stderr } = runHook(dir, 'cd pub-src && git commit -qm "pub 1"');
    assertEq(code, 2, 'a directory change before a commit still fails closed');
    assert(stderr.includes('changes directory'), `explains the cd rule, got: ${stderr}`);
    cleanup(dir);
  });

  await test('git -C x commit: exit 2', () => {
    const dir = mkThrowawayRepo();
    const { code, stderr } = runHook(dir, 'git -C pub-src commit -qm "pub 1"');
    assertEq(code, 2, 'a commit aimed elsewhere still fails closed');
    assert(stderr.includes('-C'), `explains the -C rule, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: no cwd in the payload');

  await test('no cwd: exit 0, even run from a project repo with unreviewed code', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ tool_input: { command: 'git commit -m "pub 1"' } }),
      cwd: dir,
      env: { ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP), WORKFLOW_DIR: shellPath(WORKFLOW_DIR) },
      encoding: 'utf8',
      timeout: 60000,
    });
    assertEq(res.status, 0, `no cwd → fail open, got: ${res.stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
