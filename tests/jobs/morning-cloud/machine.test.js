// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the machine it
// makes (the settings file, the roster, the budget rails, the unreadable repos).
// The shared prologue (world factory, no-jq PATH, job runner, case gates) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  SCRIPT, INSTRUCTION, HOME_SLUG, cleanup, mkWorld, withoutJq, runJob, composerTest,
} = require('./helpers');

const run = async () => {
  group('jobs/morning (cloud): the machine it makes');

  await test('an absent settings file is written from the repo the run belongs to', () => {
    // The workflow lives on the home repo, so GITHUB_REPOSITORY is the home and
    // nothing has to be configured to say which one it is.
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.settings().site.repo, HOME_SLUG, 'the repo the runner is standing in');
    assert(res.stdout.includes('settings: wrote'), `and it says it wrote it: ${res.stdout}`);
    cleanup(world.root);
  });

  await composerTest('an existing settings file wins over the repo the run belongs to', () => {
    const world = mkWorld({
      settings: { version: 1, site: { repo: 'configured/home' } },
      githubRepo: 'env/home',
    });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.settings().site.repo, 'configured/home', 'a configured runner is not rewritten');
    assert(world.roster().some((r) => r.slug === 'configured/home'), 'and that is the repo swept');
    cleanup(world.root);
  });

  await test('a runner without the seeded engine refuses, naming what is missing', () => {
    // The cloud branch builds its roster through the seeded engine's
    // predicates (home.sh's WK_HOME_RUNNER_FILES); without them every
    // directory reads as no repo, so a named refusal beats an empty roster.
    const world = mkWorld();
    const seeded = path.join(world.root, 'brief');
    fs.mkdirSync(path.join(seeded, 'jobs'), { recursive: true });
    fs.mkdirSync(path.join(seeded, 'workflow'), { recursive: true });
    // The seeded jobs files are all there; `brief/workflow/` is the empty half,
    // so the gap under test is the engine and nothing else.
    const copy = path.join(seeded, 'jobs', 'morning.sh');
    fs.cpSync(path.dirname(SCRIPT), path.join(seeded, 'jobs'), { recursive: true });
    const res = spawnSync(BASH, [...NO_RC, shellPath(copy)], {
      encoding: 'utf8', timeout: 60000, env: world.env,
    });
    assertEq(res.status, 1, `the run refuses, stdout: ${res.stdout} stderr: ${res.stderr}`);
    assert(/engine/.test(res.stderr), `and names the engine as what is missing: ${res.stderr}`);
    assertEq(world.calls().length, 0, 'nothing was sent');
    cleanup(world.root);
  });

  await test('a missing jq is named as a missing tool, not as a missing home repo', () => {
    // jq reads the home slug, so an absent one empties that read: the two
    // refusals have to say which of them happened.
    const world = mkWorld();
    const env = { ...world.env, PATH: withoutJq(world.root, path.join(world.root, 'bin')) };
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 1, 'the run refuses');
    assert(/jq is not installed/.test(res.stderr), `and names the tool: ${res.stderr}`);
    assert(!/names no home repo/.test(res.stderr), 'never the key, which is right there');
    cleanup(world.root);
  });

  await test('neither a settings file nor a repo to belong to refuses the run', () => {
    const world = mkWorld({ githubRepo: null });
    const res = runJob(world);
    assertEq(res.status, 1, 'there is no board to sweep and nowhere to publish');
    assert(/GITHUB_REPOSITORY/.test(res.stderr), `and it names what is missing: ${res.stderr}`);
    assertEq(world.calls().length, 0, 'nothing was sent');
    cleanup(world.root);
  });

  await test('nothing anywhere reads WORKKIT_HOME_SLUG any more', () => {
    // A leftover read would pass for a configured runner on any machine that
    // still has the variable set.
    const steps = path.join(path.dirname(SCRIPT), 'morning');
    const texts = [SCRIPT, ...fs.readdirSync(steps, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(steps, e.name))].map((f) => fs.readFileSync(f, 'utf8'));
    assert(!texts.some((t) => /WORKKIT_HOME_SLUG/.test(t)), 'neither the runner nor a step it sources names it');
  });

  await composerTest('the roster comes from the home repo’s own branch, and the composer reads it back', () => {
    // Private, and read with the cross-repo token, never from gh-pages, which
    // is public even on a private repo.
    const world = mkWorld({ siteRepos: { repos: ['a/one', 'b/two', HOME_SLUG], home: HOME_SLUG } });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const slugs = world.roster().map((r) => r.slug).sort();
    assertEq(slugs.join(','), ['a/one', 'b/two', HOME_SLUG].sort().join(','),
      `every slug on the list is on the roster: ${JSON.stringify(world.roster())}`);
    assert(world.ghCalls().some((argv) => argv.includes(`repos/${HOME_SLUG}/contents/data/repos.json?ref=main`)),
      `read from the default branch, not the public one: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await composerTest('the branch the roster is read from is asked for, never assumed to be main', () => {
    // The publish pushes whatever branch the home clone is on. A runner has no
    // site's data/home.json to read that from, so it asks GitHub for the repo
    // it is standing in.
    const world = mkWorld({
      defaultBranch: 'trunk',
      siteRepos: { repos: ['a/one', HOME_SLUG], home: HOME_SLUG },
    });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(world.ghCalls().some((argv) => argv.includes(`repos/${HOME_SLUG}/contents/data/repos.json?ref=trunk`)),
      `the roster is read from the branch GitHub named: ${fmtCalls(world.ghCalls())}`);
    assert(world.roster().some((r) => r.slug === 'a/one'),
      `and the list on it is the roster swept: ${JSON.stringify(world.roster())}`);
    assert(!res.stdout.includes('sweeping the home repo alone'), `with no fallback in sight: ${res.stdout}`);
    cleanup(world.root);
  });

  await composerTest('no slug list falls back to the home repo alone, and still composes', () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const slugs = world.roster().map((r) => r.slug);
    assertEq(slugs.join(','), HOME_SLUG, `the home repo, whose issues are the cross-project queue: ${slugs}`);
    assert(res.stdout.includes('sweeping the home repo alone'), `and it says so: ${res.stdout}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `the brief was still composed: ${fmtCalls(calls).slice(0, 200)}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'from the payload the machine rehearses with');
    cleanup(world.root);
  });

  await test('the budget rails are the machine’s, unchanged', () => {
    const world = mkWorld();
    runJob(world);
    const argv = world.calls()[0];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assertEq(argv[0], '-p', 'headless');
    assertEq(after('--model'), 'haiku', 'the cheapest model');
    assertEq(after('--effort'), 'low', 'at the lowest effort');
    assert(argv.includes('--safe-mode'), 'safe mode');
    assert(argv.includes('--no-session-persistence'), 'nothing persisted');
    assertEq(after('--tools'), '', 'no tools');
    assertEq(after('--max-budget-usd'), '0.25', 'and a hard budget');
    cleanup(world.root);
  });

  await composerTest('a repo the token cannot read is named in the log, not in the payload', () => {
    // The scope gap the Actions log has to show: the token reaches the home repo
    // and not the rest, the brief reads clean, and only this line says so.
    const world = mkWorld({ boardBroken: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    // A line that needs a person is a warning, so it rides stderr the way
    // every other warning in the kit does; the Actions log carries both streams.
    assert(`${res.stdout}${res.stderr}`.includes(`brief: 1 repos unreadable: ${HOME_SLUG}`),
      `the log names them: ${res.stdout}${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, 'the brief was still composed');
    assert(calls[0][1].startsWith(INSTRUCTION), 'and the payload is untouched: the line never entered it');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
