// Tests for safety:release-taken's logic, the release commit asked at npm and
// at GitHub: releaseCommitVerdict({ subject, root, facts }), the commit-msg
// hook's call, over a scratch repo whose origin git reads.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const {
  PKG, RELEASE, TAKEN, isOverride, judgeRelease,
} = require('./helpers');

describe('release-taken: the release commit at npm', () => {
  test('a version npm already has bounces, naming the provider and the pair', async () => {
    const { deny, override, calls } = await judgeRelease(RELEASE, { npmTaken: ['widget@1.2.3'] });
    expect(deny, 'the bounce names the trigger and the pair').toBe(TAKEN('this release commit', 'npm already has widget@1.2.3'));
    expect(isOverride(override), `and ends on the override, got: ${override}`).toBeTruthy();
    expect(calls.npm.includes('widget@1.2.3'), `the version was asked for by name, got: ${calls.npm.join(' ')}`).toBeTruthy();
  });

  test('a free version passes silently, in both of npm answers for free', async () => {
    for (const world of [{}, { npmKnown: ['widget'] }]) {
      const { deny, text, calls } = await judgeRelease(RELEASE, world);
      expect(deny, `nobody has it, so the commit stands, got: ${text}`).toBe(null);
      expect(text, 'a provider that answered says nothing').toBe('');
      expect(calls.npm.join(' '), 'the one package was asked once').toBe('widget@1.2.3');
    }
  });

  test('a private package is never asked about at npm', async () => {
    const { deny, calls } = await judgeRelease(RELEASE, { pkg: { ...PKG, private: true }, npmTaken: ['widget@1.2.3'] });
    expect(deny, 'a private package publishes nowhere, so nothing is taken').toBe(null);
    expect(calls.npm.length, `npm is never asked, got: ${calls.npm.join(' ')}`).toBe(0);
  });

  test('a package with no publish signal is never asked either', async () => {
    const { deny, calls } = await judgeRelease(RELEASE, { pkg: { name: 'widget', version: '1.2.3', private: false }, npmTaken: ['widget@1.2.3'] });
    expect(deny, 'no files and no publishConfig means the package never opted into npm').toBe(null);
    expect(calls.npm.length, `npm is never asked, got: ${calls.npm.join(' ')}`).toBe(0);
  });

  test('a package with no private key is never asked, the publish plan\'s own reading', async () => {
    const { deny, calls } = await judgeRelease('chore(release): 2.0.0', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/loose': { name: '@fam/loose', version: '2.0.0', files: ['dist'] } },
      npmTaken: ['@fam/loose@2.0.0'],
    });
    expect(deny, 'a package the plan would skip is not bounced').toBe(null);
    expect(calls.npm.length, `npm is never asked, got: ${calls.npm.join(' ')}`).toBe(0);
  });
});

describe('release-taken: the release commit at GitHub', () => {
  test('a tag the repo already carries bounces, naming the release and the repo', async () => {
    const { deny, calls } = await judgeRelease(RELEASE, { tags: ['v1.2.3'] });
    expect(deny, 'names the provider, the tag and the repo').toBe(TAKEN('this release commit', 'github-release already has v1.2.3 at acme/widgets'));
    expect(calls.github.join(' '), 'the tag was asked for, once').toBe('v1.2.3');
  });

  test('an origin spelled natively on Windows still names its repo', async () => {
    const { deny } = await judgeRelease(RELEASE, { tags: ['v1.2.3'], origin: 'C:\\Users\\x\\theirs.git' });
    expect(deny, 'names the repo it asked').toBe(TAKEN('this release commit', 'github-release already has v1.2.3 at x/theirs'));
  });

  test('a repo with no origin bounces with no repo clause at all', async () => {
    const { deny } = await judgeRelease(RELEASE, { tags: ['v1.2.3'], origin: null });
    expect(deny, 'the provider and the tag, and no repo clause invented').toBe(TAKEN('this release commit', 'github-release already has v1.2.3'));
  });
});
