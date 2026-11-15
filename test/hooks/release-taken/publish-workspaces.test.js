// Tests for safety:release-taken's logic: the workspace members a release commit asks about.
// The shared prologue (the verdict call, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { TAKEN, judgeRelease } = require('./helpers');

describe('release-taken: workspaces', () => {
  test('a packages/* member that is taken bounces, and a private member is not asked', async () => {
    const { deny, calls } = await judgeRelease('chore(release): 2.0.0', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/core': { name: '@fam/core', version: '2.0.0', private: false, files: ['dist'] },
        'packages/secret': { name: '@fam/secret', version: '2.0.0', private: true, files: ['dist'] },
      },
      npmTaken: ['@fam/core@2.0.0'],
    });
    expect(deny, 'one taken member is a taken family release').toBe(TAKEN('this release commit', 'npm already has @fam/core@2.0.0'));
    expect(calls.npm.join(' '), 'only the publishable member is asked').toBe('@fam/core@2.0.0');
  });

  test('a pattern the plan does not expand, pkgs/*/x/*: the verdict says so, and no member under pkgs is asked', async () => {
    const { text, calls } = await judgeRelease('chore(release): 2.0.0', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['pkgs/*/x/*'] },
      members: {
        'pkgs/a/x/core': { name: '@fam/core', version: '2.0.0', private: false, files: ['dist'] },
      },
      npmTaken: ['@fam/core@2.0.0'],
    });
    const line = 'release-taken: the workspace pattern pkgs/*/x/* was not expanded, so its packages were not checked.';
    expect(text.split('\n').includes(line), `says "${line}", got: ${text}`).toBe(true);
    expect(calls.npm.some((spec) => spec.startsWith('@fam/core@')), `the member is never asked, got: ${calls.npm.join(' ')}`).toBe(false);
  });
});
