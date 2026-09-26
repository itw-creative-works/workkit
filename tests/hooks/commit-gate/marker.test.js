//
// Tests for hooks/safety/commit-gate: scope (only commits are gated) and the
// review marker a code commit needs.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath, which, linkTool } = require('../../lib/platform');
const { skipWithoutDigest, HOOK, TMP, PLUGIN_ROOT, mkRepo, stage, markerPath, runSkillLine, touchMarker, dropMarker, runHook, cleanup } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: scope');

  await test('non-commit command: exit 0', () => {
    const dir = mkRepo();
    const { code } = runHook(dir, 'git status && npm test');
    assertEq(code, 0, 'only commits are gated');
    cleanup(dir);
  });

  await test('commit with nothing staged: exit 0 (git will fail it anyway)', () => {
    const dir = mkRepo();
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, 'empty commits pass through');
    cleanup(dir);
  });

  group('commit-gate: review marker');

  await test('staged code, no review marker: exit 2 naming workkit:review', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 2, 'unreviewed code commit must block');
    assert(stderr.includes('workkit:review'), 'tells the agent what to run');
    cleanup(dir);
  });

  await test('staged code + fresh marker: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 0, `reviewed commit passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test("the review skill's own line writes the marker this gate checks", () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    assertEq(runHook(dir, 'git commit -m "feat"').code, 2, 'blocked before the skill runs');
    const res = runSkillLine(dir);
    assertEq(res.status, 0, `the marker script runs, got: ${res.stderr}`);
    assert(fs.existsSync(markerPath(dir)), 'and writes exactly the file this gate looks for');
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 0, `so the commit passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('the review skill names the script and spells no digest itself', () => {
    const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
    assert(skill.includes('scripts/review-marker.sh'), 'the skill calls the marker script');
    assert(!skill.includes('shasum'), 'and carries no platform-bound command of its own');
    assert(fs.existsSync(path.join(PLUGIN_ROOT, 'scripts', 'review-marker.sh')), 'the script exists');
  });

  await test('a machine with neither shasum nor sha1sum: exit 2 naming both spellings', () => {
    // No digest tool means the marker cannot be NAMED. The alternative to
    // saying so is an empty key, which is one marker shared by every repo on
    // the machine: a review of any repo would open a commit in all of them.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-nosha-'));
    for (const tool of ['bash', 'jq', 'git', 'dirname', 'basename', 'cat', 'grep', 'sed', 'tr', 'awk', 'perl', 'date', 'stat', 'node']) {
      const real = which(tool);
      if (real) linkTool(bin, real);
    }
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    stage(dir, 'app.test.js', 'test();\n');
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ cwd: shellPath(dir), tool_input: { command: 'git commit -m "feat: a thing"' } }),
      env: { PATH: bin, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 60000,
    });
    assertEq(res.status, 2, `blocked, never allowed on an empty key, got: ${res.stdout}${res.stderr}`);
    assert(/neither shasum nor sha1sum/.test(res.stderr),
      `and names both spellings, got: ${res.stderr}`);
    cleanup(dir);
    fs.rmSync(bin, { recursive: true, force: true });
  });

  await test('docs-only staged, no marker: exit 0 (review not required)', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code } = runHook(dir, 'git commit -m "docs"');
    assertEq(code, 0, 'docs-only commits skip the review requirement');
    cleanup(dir);
  });

  await test('marker OLDER than the last commit: exit 2 (stale review)', () => {
    const dir = mkRepo();
    touchMarker(dir);
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(markerPath(dir), past, past);
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 2, 'a marker from before the last commit must not count');
    assert(stderr.includes('predates'), 'explains staleness');
    cleanup(dir);
  });

  await test('-a flag counts modified tracked files: exit 2 without marker', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    execSync('git commit -m "add app"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    dropMarker(dir);
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    const { code } = runHook(dir, 'git commit -am "tweak"');
    assertEq(code, 2, '-a commits are classified from modified tracked files');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
