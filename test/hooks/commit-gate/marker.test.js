// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: scope (only commits are gated) and the review
// marker a code commit needs. Each case ports the HEAD case its name quotes.
// Dropped with the shell mechanism: "a machine with neither shasum nor
// sha1sum" (the module digests through crypto.subtle, with no tool to miss).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, run } = require('../../lib/harness');
const {
  BASH, NO_RC, shellPath, gitPath, joinPath,
} = require('../../lib/platform');
const { mods } = require('../../lib/mods-inputs');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { gateOn } = require('../../lib/real-gate');
const { workkitBin } = require('../../lib/workkit-bin');
const {
  KIT, PREFIX, T, mkRepo, stage, write, commit, touchMarker, staleMarker, judge, blocks, passes,
} = require('./helpers');
const { daysAgo, agedFile } = require('../../lib/workflow-home');

// A kit script, by its path under workflow/, run for real in <cwd> with the world's env.
const runScript = (world, rel, args = [], cwd = world.repo) => run(BASH, [...NO_RC, shellPath(path.join(KIT, 'workflow', rel)), ...args], {
  cwd, env: world.env,
});

// Every file under <dir>, at any depth; none when it is not there.
const filesUnder = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true }).map((rel) => path.join(dir, rel)).filter((p) => fs.statSync(p).isFile())
  : []);

// The review skill's own marker line, run for real with the kit's `workkit`
// on PATH: the skill, the verb, the script and the module's marker path cannot
// drift apart.
const skillLine = () => {
  const skill = fs.readFileSync(path.join(KIT, 'skills', 'review', 'SKILL.md'), 'utf8');
  const line = skill.split('\n').find((l) => l.startsWith('workkit review mark'));
  assert(line, 'the skill carries the marker line');
  return line;
};

const cases = async () => {
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
    // As the live sides build it: the root in git's spelling, under the folder
    // the module reads for the WORKFLOW_HOME the script is handed.
    const { TMP, TEMP, LOCALAPPDATA } = process.env;
    const home = mods('markers').shellDirOf(world.env.WORKFLOW_HOME, { TMP, TEMP, LOCALAPPDATA }, process.platform);
    const marker = await mods('markers').reviewMarkerPath(gitPath(world.repo), home);
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 2;\n');
    r.headTime = Number(world.git('log', '-1', '--format=%ct').trim());
    blocks(await judge(r, 'git commit -m "feat"'), T.noReview, 'blocked before the skill runs');
    const res = run(BASH, [...NO_RC, '-c', skillLine()], {
      cwd: world.repo,
      env: { ...world.env, PATH: joinPath(workkitBin(), world.env.PATH) },
    });
    assertEq(res.status, 0, `the marker verb runs, got: ${res.stderr}`);
    assert(fs.existsSync(marker), `and writes exactly the file the module names: ${marker}`);
    r.marker = { mtimeMs: fs.statSync(marker).mtimeMs };
    passes(await judge(r, 'git commit -m "feat"'), '', 'so the commit passes');
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

  await test('ports "-a flag counts modified tracked files: exit 2 without marker"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    commit(r);
    write(r, 'app.js', 'const x = 2;\n');
    blocks(await judge(r, 'git commit -am "tweak"'), T.noReview, '-a commits are classified from modified tracked files');
  });

  group('commit-gate: the review marker under the workflow home');

  await test('the full marker read 5 days later, past another marker write: review covers and the gate both still see it', async () => {
    const world = mkGitRepo('cg-aged-', { 'app.js': 'const x = 1;\n' }, daysAgo(7));
    // HEAD and the edit predate the review, so only the markers' age is in play.
    const amend = spawnSync('git', ['commit', '--amend', '--no-edit', '-q'], {
      cwd: world.repo, env: { ...world.env, GIT_COMMITTER_DATE: daysAgo(6).toISOString() }, encoding: 'utf8',
    });
    assertEq(amend.status, 0, `HEAD is redated: ${amend.stderr}`);
    world.write('app.js', 'const x = 2;\n', daysAgo(6));
    world.git('add', 'app.js');
    const wrote = runScript(world, 'review/mark.sh', ['full']);
    assertEq(wrote.status, 0, `review/mark.sh full runs, got: ${wrote.stderr}`);
    const aged = filesUnder(path.join(world.workflowHome, 'markers'));
    assertEq(aged.length, 2, `the plain and the full marker are under the workflow home, got: ${aged}`);
    for (const file of aged) agedFile(file, 5);
    const later = runScript(world, 'triage/mark.sh', [], world.dir);
    assertEq(later.status, 0, `a later marker write runs its sweep, got: ${later.stderr}`);
    const covers = runScript(world, 'review/covers.sh');
    assertEq(covers.stdout, 'review-covers: covered\n', `review/covers.sh still sees the full marker, got: ${covers.stdout}${covers.stderr}`);
    const gate = await gateOn(world.repo, 'git commit -m "feat"', world.env);
    assertEq(gate.deny, null, 'and the gate still sees the review marker');
    fs.rmSync(world.dir, { recursive: true, force: true });
  });

  await test('an old temp-folder marker and an empty workflow home: the gate reads only the home, and blocks', async () => {
    const world = mkGitRepo('cg-old-', { 'app.js': 'const x = 1;\n' });
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const root = world.git('rev-parse', '--show-toplevel').trim();
    const old = path.join(world.tmp, 'claude-review-marker', crypto.createHash('sha1').update(root).digest('hex'));
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '');
    const gate = await gateOn(world.repo, 'git commit -m "feat"', world.env);
    assertEq((gate.deny || '').replace(/\n$/, ''), `${PREFIX}${T.noReview}`, 'the temp-folder marker opens nothing');
    fs.rmSync(world.dir, { recursive: true, force: true });
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
