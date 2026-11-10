// Tests for workflow/ship/cut.js (`workkit ship cut <x.y.z>`): CI's release job
// makes the GitHub release, so the cut checks the repo's caller holds that job,
// waits for v<x.y.z> through the gh on PATH, then runs the repo's afterRelease
// hooks. A fake gh records every argv; its release views and the hooks each
// append their name to one order file. The wait's bound and poll gap come from
// WORKKIT_CUT_RELEASE_TIMEOUT and WORKKIT_CUT_RELEASE_POLL (seconds).

const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { fmtCalls, isCall } = require('../lib/argv-log');
const {
  enabledWith, mkShipRepo, runShip, lines,
} = require('../lib/ship-world');
const { commitGh } = require('../lib/git-repo');

const CHANGELOG = [
  '# Changelog', '',
  '## [Unreleased]', '',
  '## [1.2.3] - 2026-11-01', '',
  '### Fixed', '',
  '- [#8](https://github.com/o/r/issues/8) - A thing that broke.', '',
].join('\n');

const CHECKS_JOB = [
  '  checks:',
  '    uses: itw-creative-works/workkit/.github/workflows/ci.yml@main',
  '    secrets: inherit',
];

const RELEASE_JOB = [
  '  release:',
  "    if: github.event_name == 'push'",
  '    permissions:',
  '      contents: write',
  '      actions: write',
  '    uses: itw-creative-works/workkit/.github/workflows/release.yml@main',
];

/** The kit's caller, with the release job unless `release` is false. */
const caller = (release = true) => `${[
  'name: checks', '',
  'on:', '  pull_request:', '  push:', '    branches: [main]', '',
  'jobs:',
  ...CHECKS_JOB,
  ...(release ? RELEASE_JOB : []),
].join('\n')}\n`;

const RUN_URL = 'https://github.com/o/r/actions/runs/42';
const RUNS = [{
  databaseId: 42, name: 'checks', workflowName: 'checks', event: 'push', status: 'completed', conclusion: 'success', url: RUN_URL,
}];

/**
 * A repo carrying `checks` as its caller and the afterRelease hooks `hooksOf(g)`
 * (bash lines), then the commit adding the [1.2.3] section, `subject` its
 * subject: the 1.2.3 release commit the cut follows by default.
 */
const mkCutRepo = (hooksOf = (g) => [g.note('hook')], checks = caller(), subject = 'chore(release): 1.2.3') => {
  const g = mkShipRepo({ '.github/workflows/checks.yml': checks });
  g.write('.workkit/settings.json', enabledWith({ afterRelease: hooksOf(g) }));
  g.write('CHANGELOG.md', CHANGELOG);
  g.git('add', '-A');
  g.git('commit', '-q', '-m', subject);
  return g;
};

/** A CHANGELOG with a section for each of `versions`, newest first. */
const changelogOf = (versions) => `${[
  '# Changelog', '', '## [Unreleased]', '',
  ...versions.flatMap((v) => [`## [${v}] - 2026-11-01`, '', '### Fixed', '', `- [#8](https://github.com/o/r/issues/8) - A fix in ${v}.`, '']),
].join('\n')}\n`;

/**
 * A repo with the caller, one afterRelease hook noting `hook`, and one release
 * commit per `[version, body]` in order, `body` its message body or null; the
 * CHANGELOG grows a section per commit. Returns the world and each version's sha.
 */
const mkHistoryRepo = (releases) => {
  const g = mkShipRepo({ '.github/workflows/checks.yml': caller() });
  g.write('.workkit/settings.json', enabledWith({ afterRelease: [g.note('hook')] }));
  const shas = {};
  const done = [];
  for (const [version, body] of releases) {
    done.unshift(version);
    g.write('CHANGELOG.md', changelogOf(done));
    g.git('add', '-A');
    g.git('commit', '-q', '-m', `chore(release): ${version}`, ...(body === null ? [] : ['-m', body]));
    shas[version] = g.git('rev-parse', 'HEAD').trim();
  }
  return { g, shas };
};

/** The `ship-cut:` lines naming an earlier version it waits for. */
const waitLines = (err) => lines(err).filter((l) => l.includes('has a release commit but no release'));

/** The repo world with the wait bounded at `timeout` seconds and no gap between polls. */
const waiting = (g, timeout = '5') => ({
  ...g, env: { ...g.env, WORKKIT_CUT_RELEASE_TIMEOUT: timeout, WORKKIT_CUT_RELEASE_POLL: '0' },
});

/** The same repo world run as a claude.ai cloud session. */
const inCloud = (g) => ({ ...g, env: { ...g.env, CLAUDE_CODE_REMOTE: 'true' } });

const creates = (gh) => gh.calls().filter((c) => isCall(c, 'release', 'create'));
const views = (gh) => gh.calls().filter((c) => isCall(c, 'release', 'view')).length;

const cases = async () => {
  group('ship cut: refusals');

  await test('a bad or missing version is a usage line, exit 2, and gh never asked', () => {
    for (const args of [[], ['1.2'], ['latest']]) {
      const g = mkCutRepo();
      const gh = commitGh({ tags: ['v1.2.3'] });
      const { code, out, err } = runShip(waiting(g), 'cut', args, { binDirs: [gh.binDir] });
      assertEq(code, 2, `exit 2 for ${JSON.stringify(args)}, got: ${out}${err}`);
      assert(/usage/i.test(err), `a usage line for ${JSON.stringify(args)}, got: ${err}`);
      assertEq(gh.calls().length, 0, `gh never asked for ${JSON.stringify(args)}, got: ${fmtCalls(gh.calls())}`);
      assertEq(g.order(), null, `no hook for ${JSON.stringify(args)}`);
    }
  });

  await test('no [x.y.z] section in the CHANGELOG: a ship-cut line, exit 1, no gh create and no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh();
    const { code, err } = runShip(waiting(g, '1'), 'cut', ['1.2.4'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).some((l) => l.startsWith('ship-cut: ')), `a ship-cut line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  await test('a caller with no release job: the standards line, a non-zero exit, no gh create and no hook', () => {
    const g = mkCutRepo(undefined, caller(false));
    const gh = commitGh({ tags: ['v1.2.3'] });
    const { code, err } = runShip(waiting(g), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assert(code !== 0 && code !== null, `a non-zero exit, got ${code}: ${err}`);
    assert(lines(err).includes('ship-cut: .github/workflows/checks.yml has no release job; run the standards step (workkit standards) and commit the caller'),
      `the no-release-job line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  group('ship cut: the wait');

  await test('from a subfolder, the release appearing on the fourth view: the cut waits for it, then runs the hooks; exit 0, no gh create', () => {
    const g = mkCutRepo();
    const gh = commitGh({ late: { 'v1.2.3': 3 }, onView: g.note('view') });
    const { code, err } = runShip(waiting(g), 'cut', ['1.2.3'], { cwd: g.sub, binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(g.order(), 'view\nview\nview\nview\nhook\n', `three misses, the release, then the afterRelease hook, got: ${fmtCalls(gh.calls())}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
  });

  await test('no release within the wait: the line naming the run, a non-zero exit, no gh create and no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh({ runs: RUNS });
    const { code, err } = runShip(waiting(g, '1'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assert(code !== 0 && code !== null, `a non-zero exit, got ${code}: ${err}`);
    assert(lines(err).includes(`ship-cut: no release v1.2.3 after 1s; check the release job: ${RUN_URL}`), `the wait line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  await test('gh release view failing for a reason other than not found: its line at once, exit 1, no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh({ fails: true });
    const { code, err } = runShip(waiting(g, '5'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: gh release view v1.2.3 failed: gh: To get started with GitHub CLI, please run: gh auth login'),
      `the gh failure line, got: ${err}`);
    assertEq(views(gh), 1, `one release view, no wait, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  await test('no chore(release): 1.2.3 commit and no release: the no-release-commit line at once, exit 1, no hook', () => {
    const g = mkCutRepo(undefined, caller(), 'docs: add the 1.2.3 notes');
    const gh = commitGh();
    const { code, err } = runShip(waiting(g, '5'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: v1.2.3 has no release commit; nothing for CI to release'), `the no-release-commit line, got: ${err}`);
    assertEq(views(gh), 1, `one release view, no wait, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  await test('no chore(release): 1.2.3 commit but v1.2.3 already released: the hooks run, exit 0', () => {
    const g = mkCutRepo(undefined, caller(), 'docs: add the 1.2.3 notes');
    const gh = commitGh({ tags: ['v1.2.3'] });
    const { code, err } = runShip(waiting(g, '5'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(g.order(), 'hook\n', 'the afterRelease hook ran');
  });

  await test('a failing afterRelease hook after the release: its line, exit 1, the hooks after it never run', () => {
    const g = mkCutRepo((w) => ['exit 3', w.note('later')]);
    const gh = commitGh({ tags: ['v1.2.3'] });
    const { code, err } = runShip(waiting(g), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: v1.2.3 was released; an afterRelease hook failed'), `the released-but line, got: ${err}`);
    assertEq(g.order(), null, 'the hook after the failure never ran');
  });

  group('ship cut: earlier versions without a release');

  await test('an older unreleased version is waited for first, its hooks run, and the walk stops at the newest released', () => {
    const { g, shas } = mkHistoryRepo([['0.9.0', null], ['1.0.0', null], ['1.1.0', null], ['1.2.3', null]]);
    const gh = commitGh({ tags: ['v1.0.0', 'v1.2.3'], late: { 'v1.1.0': 2 } });
    const { code, err } = runShip(waiting(g), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(waitLines(err)),
      JSON.stringify([`ship-cut: v1.1.0 has a release commit but no release; waiting for CI to release it at ${shas['1.1.0'].slice(0, 7)}`]),
      `one wait line, for v1.1.0 and not v0.9.0 below the released v1.0.0, got: ${err}`);
    assertEq(g.order(), 'hook\nhook\n', 'the hooks ran for v1.1.0, then for v1.2.3');
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
  });

  await test('an older version shipped with Release: none is passed over, never waited for', () => {
    const { g } = mkHistoryRepo([['1.0.0', null], ['1.1.0', 'Release: none'], ['1.2.3', null]]);
    const gh = commitGh({ tags: ['v1.0.0', 'v1.2.3'] });
    const { code, err } = runShip(waiting(g, '1'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(waitLines(err).length, 0, `no wait line, got: ${err}`);
    assertEq(g.order(), 'hook\n', 'the hooks ran once, for v1.2.3');
  });

  await test('a history with no release at all waits for no earlier version', () => {
    const { g } = mkHistoryRepo([['1.0.0', null], ['1.1.0', null], ['1.2.3', null]]);
    const gh = commitGh({ tags: ['v1.2.3'] });
    const { code, err } = runShip(waiting(g, '1'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(waitLines(err).length, 0, `no wait line, got: ${err}`);
    assertEq(g.order(), 'hook\n', 'the hooks ran once, for v1.2.3');
  });

  await test('the version\'s own release commit carries Release: none: one line, exit 0, no release view and no hook', () => {
    const { g } = mkHistoryRepo([['1.2.3', 'Release: none']]);
    const gh = commitGh();
    const { code, err } = runShip(waiting(g, '5'), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assert(lines(err).includes('ship-cut: the chore(release): 1.2.3 commit carries Release: none, so there is no v1.2.3 to wait for and no hook ran'),
      `the Release: none line, got: ${err}`);
    assertEq(gh.calls().filter((c) => isCall(c, 'release', 'view')).length, 0, `no release view, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no hook');
  });

  group('ship cut: a cloud session');

  await test('a cloud cut waits for the release and runs the hooks as a machine does; exit 0, no gh create', () => {
    const g = mkCutRepo();
    const gh = commitGh({ late: { 'v1.2.3': 1 }, onView: g.note('view') });
    const { code, err } = runShip(inCloud(waiting(g)), 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(g.order(), 'view\nview\nhook\n', `a miss, the release, then the hook, got: ${fmtCalls(gh.calls())}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
