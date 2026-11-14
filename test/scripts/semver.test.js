// Tests for workflow/ship/semver.js: the one version comparison the kit carries.
// The morning brief's upstream news walks Claude Code's releases with it and
// the ship's publish plan checks each version's shape, so both readings are
// the question here: semver order, and a dotted number with fewer parts.

const path = require('path');
const {
  describe, test, expect,
} = require('../lib/harness');

const { compareVersions, isSemver } = require(path.join(__dirname, '..', '..', 'workflow', 'ship', 'semver.js'));

describe('semver: compareVersions', () => {
  test('numbers compare numerically, and a prerelease sorts below its release', () => {
    expect(compareVersions('1.10.0', '1.9.0'), 'ten is past nine').toBe(1);
    expect(compareVersions('1.0.0', '1.0.0'), 'equal').toBe(0);
    expect(compareVersions('0.9.9', '1.0.0'), 'major wins').toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0'), 'a prerelease is below its release').toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1'), 'and the release is above it').toBe(1);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), 'numeric prerelease parts compare as numbers').toBe(-1);
  });

  test('prereleases order by semver: numbers below words, a longer set above its prefix', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha'), 'a numeric identifier is below an alphanumeric one').toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta'), 'words compare in ASCII order').toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), 'a longer set is above its prefix').toBe(-1);
    expect(compareVersions('1.0.0+build.5', '1.0.0'), 'build metadata carries no order').toBe(0);
  });

  test('a dotted number with missing parts reads them as 0', () => {
    expect(compareVersions('2.1', '2.1.0'), 'two parts equal three with a zero').toBe(0);
    expect(compareVersions('2.1.220', '2.1.99') > 0, '220 is newer than 99').toBeTruthy();
    expect(compareVersions('2.2', '2.1.9') > 0, 'the minor wins over a missing patch').toBeTruthy();
  });

  test('something that is no version at all is a loud error', () => {
    let threw = null;
    try { compareVersions('latest', '1.0.0'); } catch (err) { threw = err; }
    expect(threw && threw.message.includes('latest'), `names the value, got: ${threw && threw.message}`).toBeTruthy();
  });
});

describe('semver: isSemver', () => {
  test('three numbers, an optional prerelease and build, and nothing shorter', () => {
    expect(isSemver('1.2.3'), 'the plain shape').toBeTruthy();
    expect(isSemver('1.0.0-rc.1+sha.5'), 'a prerelease and a build').toBeTruthy();
    expect(!isSemver('1.0'), 'two parts are no semver').toBeTruthy();
    expect(!isSemver('v1.0.0'), 'a leading v is no semver').toBeTruthy();
  });
});
