// Tests for workflow/ship/cut.js (`workkit ship cut <x.y.z>`): the GitHub
// release, cut through the gh on PATH from the repo root with the CHANGELOG's
// section as its notes, then the repo's afterRelease hooks. A fake gh records
// every argv; the hooks and gh's create each append their name to one order file.

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

/** A repo carrying the CHANGELOG and, committed, the afterRelease hooks `hooksOf(g)` (bash lines). */
const mkCutRepo = (hooksOf = (g) => [g.note('hook')]) => {
  const g = mkShipRepo({ 'CHANGELOG.md': CHANGELOG });
  g.write('.workkit/settings.json', enabledWith({ afterRelease: hooksOf(g) }));
  g.git('add', '-A');
  g.git('commit', '-q', '-m', 'hooks');
  return g;
};

const creates = (gh) => gh.calls().filter((c) => isCall(c, 'release', 'create'));

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

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
