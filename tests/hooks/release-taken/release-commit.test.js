// Tests for safety:release-taken's logic, the release commit asked at npm and
// at GitHub. Each case ports the HEAD case its name quotes. The origin url is
// a fact here; the wiring suite, tests/mods/guards-release-taken.test.ts,
// reads it through the world's git.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  PKG, RELEASE, TAKEN, isOverride, judge,
} = require('./helpers');

const run = async () => {
  group('release-taken: the release commit at npm');

  await test('ports "a version npm already has bounces, naming the provider and the pair"', async () => {
    const { deny, override, calls } = await judge(RELEASE, { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, TAKEN('this release commit', 'npm already has widget@1.2.3'), 'the bounce names the trigger and the pair');
    assert(isOverride(override), `and ends on the override, got: ${override}`);
    assert(calls.npm.includes('widget@1.2.3'), `the version was asked for by name, got: ${calls.npm.join(' ')}`);
  });

  await test('the bounce names HOOK_DISABLE=1 as the override, never the loader kill switch', async () => {
    for (const [command, what] of [[RELEASE, 'the release commit'], ['npm publish', 'the publish']]) {
      const { override } = await judge(command, { npmTaken: ['widget@1.2.3'] });
      assert(typeof override === 'string' && override.includes('HOOK_DISABLE=1'), `${what}: HOOK_DISABLE=1 is the override, got: ${override}`);
      assert(!override.includes('loader kill switch'), `${what}: the loader kill switch is gone, got: ${override}`);
      assert(!/loader/i.test(override), `${what}: and no loader is named, got: ${override}`);
    }
  });

  await test('ports "a free version passes silently, in both of npm answers for free"', async () => {
    for (const world of [{}, { npmKnown: ['widget'] }]) {
      const { deny, text, calls } = await judge(RELEASE, world);
      assertEq(deny, null, `nobody has it, so the commit stands, got: ${text}`);
      assertEq(text, '', 'a provider that answered says nothing');
      assertEq(calls.npm.join(' '), 'widget@1.2.3', 'the one package was asked once');
    }
  });

  await test('ports "a private package is never asked about at npm"', async () => {
    const { deny, calls } = await judge(RELEASE, { pkg: { ...PKG, private: true }, npmTaken: ['widget@1.2.3'] });
    assertEq(deny, null, 'a private package publishes nowhere, so nothing is taken');
    assertEq(calls.npm.length, 0, `npm is never asked, got: ${calls.npm.join(' ')}`);
  });

  await test('ports "a package with no publish signal is never asked either"', async () => {
    const { deny, calls } = await judge(RELEASE, { pkg: { name: 'widget', version: '1.2.3', private: false }, npmTaken: ['widget@1.2.3'] });
    assertEq(deny, null, 'no files and no publishConfig means the package never opted into npm');
    assertEq(calls.npm.length, 0, `npm is never asked, got: ${calls.npm.join(' ')}`);
  });

  await test('ports "the heredoc idiom carries the subject on its own line"', async () => {
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      'chore(release): 1.2.3',
      '',
      'The entries this release carries.',
      'EOF',
      ')"',
    ].join('\n');
    const { deny } = await judge(command, { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, TAKEN('this release commit', 'npm already has widget@1.2.3'), 'a body line that IS the subject is the subject');
  });

  await test('ports "a package with no private key is never asked, the publish plan\'s own reading"', async () => {
    const { deny, calls } = await judge('git commit -m "chore(release): 2.0.0"', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/loose': { name: '@fam/loose', version: '2.0.0', files: ['dist'] } },
      npmTaken: ['@fam/loose@2.0.0'],
    });
    assertEq(deny, null, 'a package the plan would skip is not bounced');
    assertEq(calls.npm.length, 0, `npm is never asked, got: ${calls.npm.join(' ')}`);
  });

  group('release-taken: the release commit at GitHub');

  await test('ports "a tag the repo already carries bounces, naming the release and the repo"', async () => {
    const { deny, calls } = await judge(RELEASE, { tags: ['v1.2.3'] });
    assertEq(deny, TAKEN('this release commit', 'github-release already has v1.2.3 at acme/widgets'), 'names the provider, the tag and the repo');
    assertEq(calls.github.join(' '), 'v1.2.3', 'the tag was asked for, once');
  });

  await test('ports "an origin spelled natively on Windows still names its repo"', async () => {
    const { deny } = await judge(RELEASE, { tags: ['v1.2.3'], origin: 'C:\\Users\\x\\theirs.git' });
    assertEq(deny, TAKEN('this release commit', 'github-release already has v1.2.3 at x/theirs'), 'names the repo it asked');
  });

  await test('ports "a repo with no origin bounces with no repo clause at all"', async () => {
    const { deny } = await judge(RELEASE, { tags: ['v1.2.3'], origin: null });
    assertEq(deny, TAKEN('this release commit', 'github-release already has v1.2.3'), 'the provider and the tag, and no repo clause invented');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
