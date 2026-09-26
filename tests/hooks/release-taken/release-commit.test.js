//
// Tests for hooks/safety/release-taken, the PreToolUse hook that refuses a
// release whose version a provider already has: the release commit, asked at npm
// and at GitHub.
// The shared prologue (the npm and gh stubs, the repo factory, the hook runner, the release command) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { isCall, fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeStubs, npmCalls, ghCalls, PKG, mkRepo, runHook, RELEASE,
} = require('./helpers');

const run = async () => {
  group('release-taken: the release commit at npm');

  await test('a version npm already has bounces, naming the provider and the pair', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'a taken version must not reach the release commit');
    assert(stderr.includes('release-taken'), 'names itself');
    assert(stderr.includes('this release commit'), `names the trigger, got: ${stderr}`);
    assert(stderr.includes('npm already has widget@1.2.3'), `names the provider and the pair, got: ${stderr}`);
    assert(stderr.includes('HOOK_DISABLE=1'), `names the override, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assert(calls.some((c) => isCall(c, 'view') && c.includes('widget@1.2.3')),
      `the version was asked for by name, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a free version passes silently, in both of npm answers for free', () => {
    // A package npm never heard of (E404), and a package it knows without this
    // version (exit 0, nothing printed).
    for (const world of [{}, { npmKnown: ['widget'] }]) {
      const stubs = makeStubs(world);
      const dir = mkRepo();
      const { code, stderr } = runHook(RELEASE, dir, stubs);
      assertEq(code, 0, `nobody has it, so the commit stands, got: ${stderr}`);
      assertEq(stderr.trim(), '', 'a provider that answered says nothing');
      assertEq(npmCalls(stubs).length, 1, `the one package was asked once, got: ${fmtCalls(npmCalls(stubs))}`);
      cleanup(dir);
      cleanup(stubs.dir);
    }
  });

  await test('a private package is never asked about at npm', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo({ pkg: { ...PKG, private: true } });
    const { code } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'a private package publishes nowhere, so nothing is taken');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a package with no publish signal is never asked either', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo({ pkg: { name: 'widget', version: '1.2.3', private: false } });
    const { code } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'no files and no publishConfig means the package never opted into npm');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the heredoc idiom carries the subject on its own line', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      'chore(release): 1.2.3',
      '',
      'The entries this release carries.',
      'EOF',
      ')"',
    ].join('\n');
    const { code, stderr } = runHook(command, dir, stubs);
    assertEq(code, 2, 'a body line that IS the subject is the subject');
    assert(stderr.includes('npm already has widget@1.2.3'), `names the pair, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a package with no private key is never asked, the publish plan\'s own reading', () => {
    // Publish intent is workflow/publish-plan.js's rule: `private` explicitly
    // false. A member that never said so is a skip there, so it is not asked
    // about here either.
    const stubs = makeStubs({ npmTaken: ['@fam/loose@2.0.0'] });
    const dir = mkRepo({
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: { 'packages/loose': { name: '@fam/loose', version: '2.0.0', files: ['dist'] } },
    });
    const { code, stderr } = runHook('git commit -m "chore(release): 2.0.0"', dir, stubs);
    assertEq(code, 0, `a package the plan would skip is not bounced, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: the release commit at GitHub');

  await test('a tag the repo already carries bounces, naming the release and the repo', () => {
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('github-release already has v1.2.3'), `names the provider and the tag, got: ${stderr}`);
    assert(stderr.includes('acme/widgets'), `names the repo it asked, got: ${stderr}`);
    const calls = ghCalls(stubs);
    assert(calls.some((c) => isCall(c, 'release', 'view', 'v1.2.3')),
      `the tag was asked for, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('an origin spelled natively on Windows still names its repo', () => {
    // The slug comes from the engine's one rule (workflow/slug.sh), which takes
    // a remote in either separator: git stores a path exactly as it was typed,
    // so a Windows checkout's origin comes back with backslashes and a reader
    // that took only a forward slash left the clause off the bounce.
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo({ origin: 'C:\\Users\\x\\theirs.git' });
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('x/theirs'), `names the repo it asked, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a repo with no origin bounces with no repo clause at all', () => {
    // The slug is left empty rather than guessed at, and the clause rides only
    // when it is known: the bounce still names the provider and the tag, and
    // says nothing about a repo nothing could name.
    const stubs = makeStubs({ tags: ['v1.2.3'] });
    const dir = mkRepo({ origin: null });
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 2, 'the tag this release would cut already exists');
    assert(stderr.includes('github-release already has v1.2.3'),
      `names the provider and the tag, got: ${stderr}`);
    assert(!/already has v1\.2\.3 at /.test(stderr),
      `and no repo clause is invented, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
