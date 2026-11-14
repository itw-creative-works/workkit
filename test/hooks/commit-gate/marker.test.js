// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in
// hooks/mods/commit-gate.js: the review marker a code commit needs.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { describe, test, expect, run } = require('../../lib/harness');
const {
  BASH, NO_RC, shellPath, gitPath, joinPath,
} = require('../../lib/platform');
const { mods } = require('../../lib/mods-inputs');
const { mkRepo: mkGitRepo } = require('../../lib/git-repo');
const { gateOn } = require('../../lib/real-gate');
const { workkitBin } = require('../../lib/workkit-bin');
const {
  KIT, PREFIX, T, mkRepo, stage, touchMarker, staleMarker, judge, blocks, passes,
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
  expect(line, 'the skill carries the marker line').toBeTruthy();
  return line;
};

describe('commit-gate: scope', () => {
  test('commit with nothing staged: exit 0 (git will fail it anyway)', async () => {
    passes(await judge(mkRepo(), 'chore: x'), '', 'empty commits pass through');
  });
});

describe('commit-gate: review marker', () => {
  test('staged code, no review marker: exit 2 naming workkit:review', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'feat: thing'), T.noReview, 'unreviewed code commit must block');
  });

  test('staged code + fresh marker: exit 0', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    passes(await judge(r, 'feat: thing'), '', 'reviewed commit passes');
  });

  test('the review skill\'s own line writes the marker this gate checks: at the path markers.js names', async () => {
    const world = mkGitRepo('cg-skill-', { 'app.js': 'const x = 1;\n' });
    // As the live sides build it: the root in git's spelling, under the folder
    // the module reads for the WORKFLOW_HOME the script is handed.
    const { TMP, TEMP, LOCALAPPDATA } = process.env;
    const home = mods('markers').shellDirOf(world.env.WORKFLOW_HOME, { TMP, TEMP, LOCALAPPDATA }, process.platform);
    const marker = await mods('markers').reviewMarkerPath(gitPath(world.repo), home);
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 2;\n');
    r.headTime = Number(world.git('log', '-1', '--format=%ct').trim());
    blocks(await judge(r, 'feat: thing'), T.noReview, 'blocked before the skill runs');
    const res = run(BASH, [...NO_RC, '-c', skillLine()], {
      cwd: world.repo,
      env: { ...world.env, PATH: joinPath(workkitBin(), world.env.PATH) },
    });
    expect(res.status, `the marker verb runs, got: ${res.stderr}`).toBe(0);
    expect(fs.existsSync(marker), `and writes exactly the file the module names: ${marker}`).toBeTruthy();
    r.marker = { mtimeMs: fs.statSync(marker).mtimeMs };
    passes(await judge(r, 'feat: thing'), '', 'so the commit passes');
  });

  test('docs-only staged, no marker: exit 0 (review not required)', async () => {
    const r = mkRepo();
    stage(r, 'README.md', '# docs\n');
    passes(await judge(r, 'docs: readme'), '', 'docs-only commits skip the review requirement');
  });

  test('marker OLDER than the last commit: exit 2 (stale review)', async () => {
    const r = mkRepo();
    staleMarker(r);
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'feat: thing'), T.stale, 'a marker from before the last commit must not count');
  });
});

describe('commit-gate: the review marker under the workflow home', () => {
  test('the full marker read 5 days later, past another marker write: review covers and the gate both still see it', async () => {
    const world = mkGitRepo('cg-aged-', { 'app.js': 'const x = 1;\n' }, daysAgo(7));
    // HEAD and the edit predate the review, so only the markers' age is in play.
    const amend = spawnSync('git', ['commit', '--amend', '--no-edit', '-q'], {
      cwd: world.repo, env: { ...world.env, GIT_COMMITTER_DATE: daysAgo(6).toISOString() }, encoding: 'utf8',
    });
    expect(amend.status, `HEAD is redated: ${amend.stderr}`).toBe(0);
    world.write('app.js', 'const x = 2;\n', daysAgo(6));
    world.git('add', 'app.js');
    const wrote = runScript(world, 'review/mark.sh', ['full']);
    expect(wrote.status, `review/mark.sh full runs, got: ${wrote.stderr}`).toBe(0);
    const aged = filesUnder(path.join(world.workflowHome, 'markers'));
    expect(aged.length, `the plain and the full marker are under the workflow home, got: ${aged}`).toBe(2);
    for (const file of aged) agedFile(file, 5);
    const later = runScript(world, 'triage/mark.sh', [], world.dir);
    expect(later.status, `a later marker write runs its sweep, got: ${later.stderr}`).toBe(0);
    const covers = runScript(world, 'review/covers.sh');
    expect(covers.stdout, `review/covers.sh still sees the full marker, got: ${covers.stdout}${covers.stderr}`).toBe('review-covers: covered\n');
    const gate = await gateOn(world.repo, world.env);
    expect(gate.deny, 'and the gate still sees the review marker').toBe(null);
    fs.rmSync(world.dir, { recursive: true, force: true });
  });

  test('an old temp-folder marker and an empty workflow home: the gate reads only the home, and blocks', async () => {
    const world = mkGitRepo('cg-old-', { 'app.js': 'const x = 1;\n' });
    world.write('app.js', 'const x = 2;\n');
    world.git('add', 'app.js');
    const root = world.git('rev-parse', '--show-toplevel').trim();
    const old = path.join(world.tmp, 'claude-review-marker', crypto.createHash('sha1').update(root).digest('hex'));
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, '');
    const gate = await gateOn(world.repo, world.env);
    expect((gate.deny || '').replace(/\n$/, ''), 'the temp-folder marker opens nothing').toBe(`${PREFIX}${T.noReview}`);
    fs.rmSync(world.dir, { recursive: true, force: true });
  });
});
