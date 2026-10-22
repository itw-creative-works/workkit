// Tests for safety:release-taken's logic: failing open out loud, and its place
// in the module's Bash chain. Each case ports the HEAD case its name quotes;
// "malformed JSON, exit 0" is dropped with the shell spawn.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const { RELEASE, judge } = require('./helpers');

const run = async () => {
  group('release-taken: fail-open');

  await test('ports "a provider that cannot tell stands down out loud, and the commit stands"', async () => {
    const { deny, text } = await judge(RELEASE, { npmFails: true, ghFails: true });
    assertEq(deny, null, 'an unanswerable check never blocks a release');
    for (const line of [
      'release-taken: the npm check stood down for widget@1.2.3: npm error code ENOTFOUND request to https://registry.npmjs.org failed',
      'release-taken: the github-release check stood down for v1.2.3: gh: To get started with GitHub CLI, please run: gh auth login',
    ]) {
      assert(text.split('\n').includes(line), `says "${line}", got: ${text}`);
    }
  });

  await test('ports "a publish behind a cd cannot be placed, so it stands down out loud"', async () => {
    const { deny, text, calls } = await judge('cd /other && npm publish', { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, null, 'the package the command would publish is not the one here');
    assertEq(text, 'release-taken: the command changes directory, so the package being published could not be placed and the check stood down.',
      'says the check did not run');
    assertEq(calls.npm.length, 0, `the session directory package is never judged instead, got: ${calls.npm.join(' ')}`);
  });

  await test('ports "a message in a file leaves no subject to read, and says so"', async () => {
    for (const c of ['git commit -F msg.txt', 'git commit --file=msg.txt']) {
      const { deny, text, calls } = await judge(c, { npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
      assertEq(deny, null, `an unreadable subject never blocks: ${c}`);
      assertEq(text, 'release-taken: the commit message is in a file, so the release subject could not be read and the check stood down.',
        `says the check did not run for ${c}`);
      assertEq(calls.npm.length + calls.github.length, 0, `nothing is asked for ${c}`);
    }
  });

  await test('ports "a workspace member that is not there is named, never skipped in silence"', async () => {
    const { deny, text } = await judge('git commit -m "chore(release): 2.0.0"', {
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

  group('release-taken: wiring');

  await test('ports "hooks.json registers the hook under PreToolUse Bash, after commit-language": BASH_GUARDS order', () => {
    const hooks = mods('guards').BASH_GUARDS.map((g) => g.hook);
    const mine = hooks.indexOf('safety:release-taken');
    assert(mine > 0, `BASH_GUARDS names safety:release-taken, got: ${hooks.join(' ')}`);
    assertEq(hooks[mine - 1], 'safety:commit-language', 'it sits right after safety:commit-language');
    assertEq(typeof mods('guards').BASH_GUARDS[mine].run, 'function', 'its entry carries a run function');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
