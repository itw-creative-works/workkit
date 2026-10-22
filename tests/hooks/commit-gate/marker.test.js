// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: scope (only commits are gated) and the review
// marker a code commit needs. Each case ports the HEAD case its name quotes.
// Dropped with the shell mechanism: "a machine with neither shasum nor
// sha1sum" (the module digests through crypto.subtle, with no tool to miss).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { mods } = require('../../lib/mods-inputs');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const {
  KIT, T, mkRepo, stage, write, commit, touchMarker, staleMarker, judge, blocks, passes,
} = require('./helpers');

// The marker script the review skill calls, and the skill's own line calling
// it, run for real: the skill, the script and the module's marker path cannot
// drift apart. CLAUDE_PLUGIN_ROOT is handed over the way a hook command does.
const skillLine = () => {
  const skill = fs.readFileSync(path.join(KIT, 'skills', 'review', 'SKILL.md'), 'utf8');
  const line = skill.split('\n').find((l) => l.includes('scripts/review-marker.sh') && l.startsWith('bash '));
  assert(line, 'the skill carries the marker line');
  return line;
};

const run = async () => {
  group('commit-gate: scope');

  await test('ports "non-commit command: exit 0"', async () => {
    passes(await judge(mkRepo(), 'git status && npm test'), '', 'only commits are gated');
  });

  await test('ports "commit with nothing staged: exit 0 (git will fail it anyway)"', async () => {
    passes(await judge(mkRepo(), 'git commit -m "x"'), '', 'empty commits pass through');
  });

  group('commit-gate: review marker');

  await test('ports "staged code, no review marker: exit 2 naming workkit:review"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "feat"'), T.noReview, 'unreviewed code commit must block');
  });

  await test('ports "staged code + fresh marker: exit 0"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'git commit -m "feat"'), '', 'reviewed commit passes');
  });

  await test('ports "the review skill\'s own line writes the marker this gate checks": at the path markers.js names', async () => {
    const world = mkGitRepo('cg-skill-', { 'app.js': 'const x = 1;\n' });
    const tmp = mkTmp('cg-skill-tmp-');
    const marker = await mods('markers').reviewMarkerPath(world.repo, tmp);
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 2;\n');
    r.headTime = Number(world.git('log', '-1', '--format=%ct').trim());
    blocks(await judge(r, 'git commit -m "feat"'), T.noReview, 'blocked before the skill runs');
    const res = spawnSync(BASH, [...NO_RC, '-c', skillLine()], {
      cwd: world.repo,
      env: { ...world.env, CLAUDE_PLUGIN_ROOT: shellPath(KIT), TMPDIR: shellPath(tmp) },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, `the marker script runs, got: ${res.stderr}`);
    assert(fs.existsSync(marker), `and writes exactly the file the module names: ${marker}`);
    r.marker = { mtimeMs: fs.statSync(marker).mtimeMs };
    passes(await judge(r, 'git commit -m "feat"'), '', 'so the commit passes');
  });

  await test('ports "the review skill names the script and spells no digest itself"', () => {
    const skill = fs.readFileSync(path.join(KIT, 'skills', 'review', 'SKILL.md'), 'utf8');
    assert(skill.includes('scripts/review-marker.sh'), 'the skill calls the marker script');
    assert(!skill.includes('shasum'), 'and carries no platform-bound command of its own');
    assert(fs.existsSync(path.join(KIT, 'scripts', 'review-marker.sh')), 'the script exists');
  });

  await test('ports "docs-only staged, no marker: exit 0 (review not required)"', async () => {
    const r = mkRepo();
    stage(r, 'README.md', '# docs\n');
    passes(await judge(r, 'git commit -m "docs"'), '', 'docs-only commits skip the review requirement');
  });

  await test('ports "marker OLDER than the last commit: exit 2 (stale review)"', async () => {
    const r = mkRepo();
    staleMarker(r);
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "feat"'), T.stale, 'a marker from before the last commit must not count');
  });

  await test('given a review marker older than the newest staged code file: the stale-marker deny', async () => {
    const r = mkRepo();
    stage(r, 'lib.js', 'const y = 1;\n');
    commit(r);
    staleMarker(r);
    stage(r, 'lib.js', 'const y = 2;\n');
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "feat: thing"'), T.stale, 'the marker predates the code it would cover');
  });

  await test('ports "-a flag counts modified tracked files: exit 2 without marker"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    commit(r);
    write(r, 'app.js', 'const x = 2;\n');
    blocks(await judge(r, 'git commit -am "tweak"'), T.noReview, '-a commits are classified from modified tracked files');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
