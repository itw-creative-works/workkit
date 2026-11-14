// Tests for jobs/morning.sh as a GitHub Actions runner runs it: the machine it
// makes (the settings file, the roster, the budget rails, the unreadable repos).
// The shared prologue (world factory, no-jq PATH, job runner) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, SPAWN_DEADLINE } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath, skipWithoutNodeStub } = require('../../lib/platform');
const {
  SCRIPT, INSTRUCTION, HOME_SLUG, cleanup, mkWorld, withoutJq, runJob,
} = require('./helpers');

describe('jobs/morning (cloud): the machine it makes', () => {
  test('an absent settings file is written from the repo the run belongs to', () => {
    // The workflow lives on the home repo, so GITHUB_REPOSITORY is the home and
    // nothing has to be configured to say which one it is.
    const world = mkWorld();
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.settings().site.repo, 'the repo the runner is standing in').toBe(HOME_SLUG);
    expect(res.stdout.includes('settings: wrote'), `and it says it wrote it: ${res.stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('an existing settings file wins over the repo the run belongs to', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld({
      settings: { version: 1, site: { repo: 'configured/home' } },
      githubRepo: 'env/home',
    });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.settings().site.repo, 'a configured runner is not rewritten').toBe('configured/home');
    expect(world.roster().some((r) => r.slug === 'configured/home'), 'and that is the repo swept').toBeTruthy();
    cleanup(world.root);
  });

  test('a runner without the seeded engine refuses, naming what is missing', () => {
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
      encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env,
    });
    expect(res.status, `the run refuses, stdout: ${res.stdout} stderr: ${res.stderr}`).toBe(1);
    expect(/engine/.test(res.stderr), `and names the engine as what is missing: ${res.stderr}`).toBeTruthy();
    expect(world.calls().length, 'nothing was sent').toBe(0);
    cleanup(world.root);
  });

  test('a missing jq is named as a missing tool, not as a missing home repo', () => {
    // jq reads the home slug, so an absent one empties that read: the two
    // refusals have to say which of them happened.
    const world = mkWorld();
    const env = { ...world.env, PATH: withoutJq(world.root, path.join(world.root, 'bin')) };
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
    expect(res.status, 'the run refuses').toBe(1);
    expect(/jq is not installed/.test(res.stderr), `and names the tool: ${res.stderr}`).toBeTruthy();
    expect(!/names no home repo/.test(res.stderr), 'never the key, which is right there').toBeTruthy();
    cleanup(world.root);
  });

  test('neither a settings file nor a repo to belong to refuses the run', () => {
    const world = mkWorld({ githubRepo: null });
    const res = runJob(world);
    expect(res.status, 'there is no board to sweep and nowhere to publish').toBe(1);
    expect(/GITHUB_REPOSITORY/.test(res.stderr), `and it names what is missing: ${res.stderr}`).toBeTruthy();
    expect(world.calls().length, 'nothing was sent').toBe(0);
    cleanup(world.root);
  });

  test('the roster comes from the home repo’s own branch, and the composer reads it back', { skip: skipWithoutNodeStub() }, () => {
    // Private, and read with the cross-repo token, never from gh-pages, which
    // is public even on a private repo.
    const world = mkWorld({ siteRepos: { repos: ['a/one', 'b/two', HOME_SLUG], home: HOME_SLUG } });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const slugs = world.roster().map((r) => r.slug).sort();
    expect(slugs.join(','),
      `every slug on the list is on the roster: ${JSON.stringify(world.roster())}`).toBe(['a/one', 'b/two', HOME_SLUG].sort().join(','));
    expect(world.ghCalls().some((argv) => argv.includes(`repos/${HOME_SLUG}/contents/data/repos.json?ref=main`)),
      `read from the default branch, not the public one: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the branch the roster is read from is asked for, never assumed to be main', { skip: skipWithoutNodeStub() }, () => {
    // The publish pushes whatever branch the home clone is on. A runner has no
    // site's data/home.json to read that from, so it asks GitHub for the repo
    // it is standing in.
    const world = mkWorld({
      defaultBranch: 'trunk',
      siteRepos: { repos: ['a/one', HOME_SLUG], home: HOME_SLUG },
    });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.ghCalls().some((argv) => argv.includes(`repos/${HOME_SLUG}/contents/data/repos.json?ref=trunk`)),
      `the roster is read from the branch GitHub named: ${fmtCalls(world.ghCalls())}`).toBeTruthy();
    expect(world.roster().some((r) => r.slug === 'a/one'),
      `and the list on it is the roster swept: ${JSON.stringify(world.roster())}`).toBeTruthy();
    expect(!res.stdout.includes('sweeping the home repo alone'), `with no fallback in sight: ${res.stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('no slug list falls back to the home repo alone, and still composes', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld();
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const slugs = world.roster().map((r) => r.slug);
    expect(slugs.join(','), `the home repo, whose issues are the cross-project queue: ${slugs}`).toBe(HOME_SLUG);
    expect(res.stdout.includes('sweeping the home repo alone'), `and it says so: ${res.stdout}`).toBeTruthy();
    const calls = world.calls();
    expect(calls.length, `the brief was still composed: ${fmtCalls(calls).slice(0, 200)}`).toBe(1);
    expect(calls[0][1].startsWith(INSTRUCTION), 'from the payload the machine rehearses with').toBeTruthy();
    cleanup(world.root);
  });

  test('the budget rails are the machine’s, unchanged', () => {
    const world = mkWorld();
    runJob(world);
    const argv = world.calls()[0];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    expect(argv[0], 'headless').toBe('-p');
    expect(after('--model'), 'the cheapest model').toBe('haiku');
    expect(after('--effort'), 'at the lowest effort').toBe('low');
    expect(argv.includes('--safe-mode'), 'safe mode').toBeTruthy();
    expect(argv.includes('--no-session-persistence'), 'nothing persisted').toBeTruthy();
    expect(after('--tools'), 'no tools').toBe('');
    expect(after('--max-budget-usd'), 'and a hard budget').toBe('0.25');
    cleanup(world.root);
  });

  test('a repo the token cannot read is named in the log, not in the payload', { skip: skipWithoutNodeStub() }, () => {
    // The scope gap the Actions log has to show: the token reaches the home repo
    // and not the rest, the brief reads clean, and only this line says so.
    const world = mkWorld({ boardBroken: true });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    // A line that needs a person is a warning, so it rides stderr the way
    // every other warning in the kit does; the Actions log carries both streams.
    expect(`${res.stdout}${res.stderr}`.includes(`brief: 1 repos unreadable: ${HOME_SLUG}`),
      `the log names them: ${res.stdout}${res.stderr}`).toBeTruthy();
    const calls = world.calls();
    expect(calls.length, 'the brief was still composed').toBe(1);
    expect(calls[0][1].startsWith(INSTRUCTION), 'and the payload is untouched: the line never entered it').toBeTruthy();
    cleanup(world.root);
  });
});
