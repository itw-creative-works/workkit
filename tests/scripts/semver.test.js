//
// Tests for workflow/semver.js: the one version comparison the kit carries.
// The morning brief's upstream news walks Claude Code's releases with it and
// the ship's publish plan checks each version's shape, so both readings are
// the question here: semver order, and a dotted number with fewer parts.
//

const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');

const { compareVersions, isSemver } = require(path.join(__dirname, '..', '..', 'workflow', 'semver.js'));

const run = async () => {
  group('semver: compareVersions');

  await test('numbers compare numerically, and a prerelease sorts below its release', () => {
    assertEq(compareVersions('1.10.0', '1.9.0'), 1, 'ten is past nine');
    assertEq(compareVersions('1.0.0', '1.0.0'), 0, 'equal');
    assertEq(compareVersions('0.9.9', '1.0.0'), -1, 'major wins');
    assertEq(compareVersions('1.0.0-rc.1', '1.0.0'), -1, 'a prerelease is below its release');
    assertEq(compareVersions('1.0.0', '1.0.0-rc.1'), 1, 'and the release is above it');
    assertEq(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1, 'numeric prerelease parts compare as numbers');
  });

  await test('prereleases order by semver: numbers below words, a longer set above its prefix', () => {
    assertEq(compareVersions('1.0.0-1', '1.0.0-alpha'), -1, 'a numeric identifier is below an alphanumeric one');
    assertEq(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1, 'words compare in ASCII order');
    assertEq(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1, 'a longer set is above its prefix');
    assertEq(compareVersions('1.0.0+build.5', '1.0.0'), 0, 'build metadata carries no order');
  });

  await test('a dotted number with missing parts reads them as 0', () => {
    assertEq(compareVersions('2.1', '2.1.0'), 0, 'two parts equal three with a zero');
    assert(compareVersions('2.1.220', '2.1.99') > 0, '220 is newer than 99');
    assert(compareVersions('2.2', '2.1.9') > 0, 'the minor wins over a missing patch');
  });

  await test('something that is no version at all is a loud error', () => {
    let threw = null;
    try { compareVersions('latest', '1.0.0'); } catch (err) { threw = err; }
    assert(threw && threw.message.includes('latest'), `names the value, got: ${threw && threw.message}`);
  });

  group('semver: isSemver');

  await test('three numbers, an optional prerelease and build, and nothing shorter', () => {
    assert(isSemver('1.2.3'), 'the plain shape');
    assert(isSemver('1.0.0-rc.1+sha.5'), 'a prerelease and a build');
    assert(!isSemver('1.0'), 'two parts are no semver');
    assert(!isSemver('v1.0.0'), 'a leading v is no semver');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
