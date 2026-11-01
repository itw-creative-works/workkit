// Tests for safety:release-taken's logic: failing open out loud.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { RELEASE, judge, judgeRelease } = require('./helpers');

const cases = async () => {
  group('release-taken: fail-open');

  await test('a provider that cannot tell stands down out loud, and the commit stands', async () => {
    const { deny, text } = await judgeRelease(RELEASE, { npmFails: true, ghFails: true });
    assertEq(deny, null, 'an unanswerable check never blocks a release');
    for (const line of [
      'release-taken: the npm check stood down for widget@1.2.3: npm error code ENOTFOUND request to https://registry.npmjs.org failed',
      'release-taken: the github-release check stood down for v1.2.3: gh: To get started with GitHub CLI, please run: gh auth login',
    ]) {
      assert(text.split('\n').includes(line), `says "${line}", got: ${text}`);
    }
  });

  await test('a publish behind a cd cannot be placed, so it stands down out loud', async () => {
    const { deny, text, calls } = await judge('cd /other && npm publish', { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, null, 'the package the command would publish is not the one here');
    assertEq(text, 'release-taken: the command changes directory, so the package being published could not be placed and the check stood down.',
      'says the check did not run');
    assertEq(calls.npm.length, 0, `the session directory package is never judged instead, got: ${calls.npm.join(' ')}`);
  });

  await test('a workspace member that is not there is named, never skipped in silence', async () => {
    const { deny, text } = await judgeRelease('chore(release): 2.0.0', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/gone', 'apps/*'] },
    });
    assertEq(deny, null, 'a member that is not there takes nothing with it');
    for (const line of [
      'release-taken: the workspace member packages/gone holds no package.json, so it was not checked.',
      'release-taken: the workspace pattern apps/* matched no package, so nothing under it was checked.',
    ]) {
      assert(text.split('\n').includes(line), `says "${line}", got: ${text}`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
