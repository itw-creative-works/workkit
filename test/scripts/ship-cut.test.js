// Tests for workflow/ship/cut.js (`workkit ship cut <x.y.z>`): the GitHub
// release, cut through the gh on PATH from the repo root with the CHANGELOG's
// section as its notes, then the repo's afterRelease hooks. A fake gh records
// every argv; the hooks and gh's create each append their name to one order file.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { fmtCalls, isCall } = require('../lib/argv-log');
const {
  enabledWith, mkShipRepo, runShip, lines,
} = require('../lib/ship-world');
const { commitGh } = require('../lib/git-repo');

const SECTION = [
  '### Added',
  '',
  '- [#7](https://github.com/o/r/issues/7) - A thing that shipped.',
  '',
  '### Fixed',
  '',
  '- [#8](https://github.com/o/r/issues/8) - A thing that broke.',
].join('\n');

const CHANGELOG = [
  '# Changelog', '',
  '## [Unreleased]', '',
  '## [1.2.3] - 2026-11-01', '',
  SECTION, '',
  '## [1.2.2] - 2026-10-01', '',
  '### Fixed', '',
  '- [#6](https://github.com/o/r/issues/6) - An older thing.', '',
].join('\n');

/** A repo carrying `changelog` and, committed, the afterRelease hooks `hooksOf(g)` (bash lines). */
const mkCutRepo = (hooksOf = (g) => [g.note('hook')], changelog = CHANGELOG) => {
  const g = mkShipRepo({ 'CHANGELOG.md': changelog });
  g.write('.workkit/settings.json', enabledWith({ afterRelease: hooksOf(g) }));
  g.git('add', '-A');
  g.git('commit', '-q', '-m', 'hooks');
  return g;
};

const EMPTY_CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n';

/** The section a release commit of `version` adds to the CHANGELOG. */
const sectionOf = (version) => `### Fixed\n\n- [#9](https://github.com/o/r/issues/9) - The fix ${version} shipped.`;

/**
 * Commit `chore(release): <version>`, its `## [version]` section added under
 * [Unreleased] unless `section` is false, `body` its message body when given;
 * returns the commit's full sha.
 */
const releaseCommit = (g, version, { section = true, subject = `chore(release): ${version}`, body = null } = {}) => {
  if (section) {
    const file = path.join(g.repo, 'CHANGELOG.md');
    const text = fs.readFileSync(file, 'utf8');
    g.write('CHANGELOG.md', text.replace('## [Unreleased]\n\n', `## [Unreleased]\n\n## [${version}] - 2026-11-01\n\n${sectionOf(version)}\n\n`));
    g.git('add', '-A');
  }
  g.git('commit', '-q', '--allow-empty', '-m', subject, ...(body === null ? [] : ['-m', body]));
  return g.git('rev-parse', 'HEAD').trim();
};

/** A plain work commit, so a release commit is not HEAD. */
const workCommit = (g, name) => {
  g.write(`${name}.txt`, `${name}\n`);
  g.git('add', '-A');
  g.git('commit', '-q', '-m', `fix: ${name}`);
};

/** The same repo world run as a claude.ai cloud session. */
const inCloud = (g) => ({ ...g, env: { ...g.env, CLAUDE_CODE_REMOTE: 'true' } });

/** The order file's lines when every create notes `release-<tag>` and every hook `hook`. */
const cutOrder = (g) => lines(g.order() || '');

const creates = (gh) => gh.calls().filter((c) => isCall(c, 'release', 'create'));

/** The tag and --target of each create, in order. */
const cutTargets = (gh) => creates(gh).map((c) => [c[2], flagValue(c, '--target')]);

/** The value after `flag` in `call`, undefined when the flag is not there. */
const flagValue = (call, flag) => {
  const at = call.indexOf(flag);
  return at < 0 ? undefined : call[at + 1];
};

const cases = async () => {
  group('ship cut: refusals');

  await test('a bad or missing version is a usage line, exit 2, and gh never asked', () => {
    for (const args of [[], ['1.2'], ['latest']]) {
      const g = mkCutRepo();
      const gh = commitGh({ onCreate: g.note('release') });
      const { code, out, err } = runShip(g, 'cut', args, { binDirs: [gh.binDir] });
      assertEq(code, 2, `exit 2 for ${JSON.stringify(args)}, got: ${out}${err}`);
      assert(/usage/i.test(err), `a usage line for ${JSON.stringify(args)}, got: ${err}`);
      assertEq(gh.calls().length, 0, `gh never asked for ${JSON.stringify(args)}, got: ${fmtCalls(gh.calls())}`);
      assertEq(g.order(), null, `no release and no hook for ${JSON.stringify(args)}`);
    }
  });

  await test('a release already there: its line, exit 1, no gh create and no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh({ tags: ['v1.2.3'], onCreate: g.note('release') });
    const { code, err } = runShip(g, 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: v1.2.3 is already released'), `the already-released line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no release and no hook');
  });

  await test('no [x.y.z] section in the CHANGELOG: a ship-cut line, exit 1, no gh create and no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh({ onCreate: g.note('release') });
    const { code, err } = runShip(g, 'cut', ['1.2.4'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).some((l) => l.startsWith('ship-cut: ')), `a ship-cut line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no release and no hook');
  });

  await test('gh create failing: the command exits gh\'s code and runs no hook', () => {
    const g = mkCutRepo();
    const gh = commitGh({ createExit: 4, onCreate: g.note('release') });
    const { code, err } = runShip(g, 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 4, `gh's exit, got: ${err}`);
    assertEq(creates(gh).length, 1, `gh asked to create once, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), 'release\n', 'the create ran, no hook after it');
  });

  group('ship cut: the release');

  await test('from a subfolder: gh creates v<x.y.z> at HEAD\'s full sha with the section as notes, then the hooks; exit 0', () => {
    const g = mkCutRepo();
    const gh = commitGh({ onCreate: g.note('release') });
    const { code, err } = runShip(g, 'cut', ['1.2.3'], { cwd: g.sub, binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    const made = creates(gh);
    assertEq(made.length, 1, `one gh create, got: ${fmtCalls(gh.calls())}`);
    const [call] = made;
    assertEq(call[2], 'v1.2.3', `the tag, got: ${fmtCalls(made)}`);
    assertEq(flagValue(call, '--target'), g.git('rev-parse', 'HEAD').trim(), `the target is HEAD's 40-character sha, got: ${fmtCalls(made)}`);
    assertEq(flagValue(call, '--title'), 'v1.2.3', `the title, got: ${fmtCalls(made)}`);
    assertEq((flagValue(call, '--notes') || '').trim(), SECTION, `the notes are the [1.2.3] section's body, got: ${fmtCalls(made)}`);
    assertEq(g.order(), 'release\nhook\n', 'the release, then the afterRelease hook');
  });

  await test('a failing afterRelease hook after the release: its line, exit 1', () => {
    const g = mkCutRepo((w) => ['exit 3', w.note('later')]);
    const gh = commitGh({ onCreate: g.note('release') });
    const { code, err } = runShip(g, 'cut', ['1.2.3'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: v1.2.3 was released; an afterRelease hook failed'), `the released-but line, got: ${err}`);
    assertEq(g.order(), 'release\n', 'the release stands, the hook after the failure never ran');
  });

  group('ship cut: a cloud session');

  await test('a cloud cut prints the waits line, exits 0, and creates no release and runs no hook', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    releaseCommit(g, '0.91.0');
    releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(inCloud(g), 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assert(lines(err).includes('ship-cut: v0.92.0 waits for a release: a cloud session cannot create one; the next ship on a machine cuts it'), `the waits line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, the unreleased 0.91.0 included, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no release and no hook');
  });

  await test('in a cloud session a release already there and a missing section are still refused, exit 1', () => {
    for (const [version, tags] of [['0.92.0', ['v0.92.0']], ['0.93.0', []]]) {
      const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
      releaseCommit(g, '0.92.0');
      const gh = commitGh({ tags, onCreate: g.note('release-$3') });
      const { code, err } = runShip(inCloud(g), 'cut', [version], { binDirs: [gh.binDir] });
      assertEq(code, 1, `exit 1 for ${version}, got: ${err}`);
      assertEq(g.order(), null, `no release and no hook for ${version}`);
    }
  });

  group('ship cut: the backfill');

  await test('0.92.0 with 0.91.0 unreleased and 0.90.1 released: 0.91.0 at its own release commit, then 0.92.0, each with its hooks', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    const sha091 = releaseCommit(g, '0.91.0');
    workCommit(g, 'after-091');
    const sha092 = releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.91.0', sha091], ['v0.92.0', sha092]]), `each tag at its own release commit, got: ${fmtCalls(creates(gh))}`);
    assertEq(cutOrder(g).join(' '), 'release-v0.91.0 hook release-v0.92.0 hook', 'each release followed by its hooks');
    const [backfill] = creates(gh);
    assertEq(flagValue(backfill, '--title'), 'v0.91.0', `the backfill's title, got: ${fmtCalls([backfill])}`);
    assertEq((flagValue(backfill, '--notes') || '').trim(), sectionOf('0.91.0'), `the backfill's notes are its own section, got: ${fmtCalls([backfill])}`);
    assert(lines(err).includes(`ship-cut: v0.91.0 has a release commit but no release; cutting it at ${sha091.slice(0, 7)}`), `the backfill line, got: ${err}`);
  });

  await test('the backfill stops at the newest released version and cuts the missing ones oldest first', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.89.0');
    releaseCommit(g, '0.90.1');
    const sha091 = releaseCommit(g, '0.91.0');
    const sha0911 = releaseCommit(g, '0.91.1');
    const sha092 = releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.91.0', sha091], ['v0.91.1', sha0911], ['v0.92.0', sha092]]), `0.89.0 below the released 0.90.1 is left, the rest oldest first, got: ${fmtCalls(creates(gh))}`);
  });

  await test('a release commit with a `Release: none` trailer is never backfilled, and the walk goes on past it', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    const sha091 = releaseCommit(g, '0.91.0');
    releaseCommit(g, '0.91.1', { body: 'Release: none' });
    const sha092 = releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.91.0', sha091], ['v0.92.0', sha092]]), `0.91.1 shipped with no release is left, got: ${fmtCalls(creates(gh))}`);
    assert(!err.includes('v0.91.1'), `no line for the skipped version, got: ${err}`);
  });

  await test('a history with no release at all backfills nothing', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.0');
    releaseCommit(g, '0.91.0');
    const sha092 = releaseCommit(g, '0.92.0');
    const gh = commitGh({ onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.92.0', sha092]]), `only the asked version, got: ${fmtCalls(creates(gh))}`);
    assertEq(cutOrder(g).join(' '), 'release-v0.92.0 hook', 'one release, its hooks');
  });

  await test('only an exact chore(release) subject with a semver below the asked one is a release commit', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    releaseCommit(g, 'next', { section: false });
    releaseCommit(g, '0.91.5', { subject: 'chore(release): 0.91.5 (#12)' });
    releaseCommit(g, '0.93.0');
    const sha092 = releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.92.0', sha092]]), `no backfill from a near-miss subject or a higher version, got: ${fmtCalls(creates(gh))}`);
  });

  await test('a backfilled version with no CHANGELOG section: a ship-cut line, exit 1, nothing cut', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    releaseCommit(g, '0.91.0', { section: false });
    releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).some((l) => l.startsWith('ship-cut: ')), `a ship-cut line, got: ${err}`);
    assertEq(creates(gh).length, 0, `no gh create, 0.92.0 included, got: ${fmtCalls(gh.calls())}`);
    assertEq(g.order(), null, 'no release and no hook');
  });

  await test('a backfill create failing: gh\'s code, no hook, and the asked version never cut', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    releaseCommit(g, '0.91.0');
    releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: `${g.note('release-$3')}; [[ "$3" == v0.91.0 ]] && exit 4` });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 4, `gh's exit, got: ${err}`);
    assertEq(cutOrder(g).join(' '), 'release-v0.91.0', `the failed create alone, got: ${fmtCalls(gh.calls())}`);
  });

  await test('a backfill hook failing: its released-but line, exit 1, and the asked version never cut', () => {
    const g = mkCutRepo((w) => [w.note('hook'), 'exit 3'], EMPTY_CHANGELOG);
    releaseCommit(g, '0.90.1');
    releaseCommit(g, '0.91.0');
    releaseCommit(g, '0.92.0');
    const gh = commitGh({ tags: ['v0.90.1'], onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 1, `exit 1, got: ${err}`);
    assert(lines(err).includes('ship-cut: v0.91.0 was released; an afterRelease hook failed'), `the released-but line for 0.91.0, got: ${err}`);
    assertEq(cutOrder(g).join(' '), 'release-v0.91.0 hook', `0.91.0 and its failing hooks, nothing after, got: ${fmtCalls(gh.calls())}`);
  });

  group('ship cut: the target');

  await test('a cut whose HEAD is the merge commit targets the version\'s release commit, not the merge', () => {
    const g = mkCutRepo(undefined, EMPTY_CHANGELOG);
    g.git('checkout', '-q', '-b', 'claude/thing');
    workCommit(g, 'work');
    const sha092 = releaseCommit(g, '0.92.0');
    g.git('checkout', '-q', 'main');
    workCommit(g, 'meanwhile');
    g.git('merge', '-q', '--no-ff', '-m', 'fix: work (#12)', 'claude/thing');
    const head = g.git('rev-parse', 'HEAD').trim();
    assert(head !== sha092, 'HEAD is the merge commit');
    const gh = commitGh({ onCreate: g.note('release-$3') });
    const { code, err } = runShip(g, 'cut', ['0.92.0'], { binDirs: [gh.binDir] });
    assertEq(code, 0, `exit 0, got: ${err}`);
    assertEq(JSON.stringify(cutTargets(gh)), JSON.stringify([['v0.92.0', sha092]]), `the release commit, not the merge ${head}, got: ${fmtCalls(creates(gh))}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
