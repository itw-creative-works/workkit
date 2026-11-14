// Tests for safety:release-taken's logic: failing open out loud.
// The shared prologue (the verdict call, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { RELEASE, judgeRelease } = require('./helpers');

describe('release-taken: fail-open', () => {
  test('a provider that cannot tell stands down out loud, and the commit stands', async () => {
    const { deny, text } = await judgeRelease(RELEASE, { npmFails: true, ghFails: true });
    expect(deny, 'an unanswerable check never blocks a release').toBe(null);
    for (const line of [
      'release-taken: the npm check stood down for widget@1.2.3: npm error code ENOTFOUND request to https://registry.npmjs.org failed',
      'release-taken: the github-release check stood down for v1.2.3: gh: To get started with GitHub CLI, please run: gh auth login',
    ]) {
      expect(text.split('\n').includes(line), `says "${line}", got: ${text}`).toBeTruthy();
    }
  });

  test('a workspace member that is not there is named, never skipped in silence', async () => {
    const { deny, text } = await judgeRelease('chore(release): 2.0.0', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/gone', 'apps/*'] },
    });
    expect(deny, 'a member that is not there takes nothing with it').toBe(null);
    for (const line of [
      'release-taken: the workspace member packages/gone holds no package.json, so it was not checked.',
      'release-taken: the workspace pattern apps/* matched no package, so nothing under it was checked.',
    ]) {
      expect(text.split('\n').includes(line), `says "${line}", got: ${text}`).toBeTruthy();
    }
  });
});
