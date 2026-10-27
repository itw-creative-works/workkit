// Tests for safety:release-taken's logic: `npm publish`, and the workspace
// members a release or a publish asks about. Each case ports the HEAD case its
// name quotes.
// The shared prologue (the lookups, the verdict call, the texts) is ./helpers.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { TAKEN, judge } = require('./helpers');

const PUBLISH = 'this npm publish';

// A family published one member at a time: the member published a moment
// ago is taken by then, and must not bounce the next one's publish.
const member = (name) => ({ name, version: '0.5.0', private: false, files: ['dist'] });
const FAMILY = (extra = {}) => ({
  pkg: { name: 'family', version: '0.5.0', private: true, workspaces: ['packages/*'] },
  members: { 'packages/a': member('@s/a'), 'packages/b': member('@s/b'), ...extra },
});

const cases = async () => {
  group('release-taken: npm publish');

  await test('ports "a taken version bounces the publish, and GitHub is not asked"', async () => {
    const { deny, calls } = await judge('npm publish --access public', { npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    assertEq(deny, TAKEN(PUBLISH, 'npm already has widget@1.2.3'), 'the registry already has it');
    assertEq(calls.github.length, 0, `the release legitimately precedes the publish, got: ${calls.github.join(' ')}`);
  });

  await test('ports "a redirect between npm and publish is skipped, and a script named publish is none"', async () => {
    for (const command of ['npm 2>&1 publish', 'npm > out publish']) {
      const { deny } = await judge(command, { npmTaken: ['widget@1.2.3'] });
      assertEq(deny, TAKEN(PUBLISH, 'npm already has widget@1.2.3'), `${command} publishes a taken version`);
    }
    const { deny, calls } = await judge('npm run publish', { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, null, 'a script named publish is not the subcommand');
    assertEq(calls.npm.length, 0, 'and nothing is asked');
  });

  await test('ports "a redirect before npm never ends the prefix peel"', async () => {
    const { deny } = await judge('2>/dev/null npm publish', { npmTaken: ['widget@1.2.3'] });
    assertEq(deny, TAKEN(PUBLISH, 'npm already has widget@1.2.3'), 'the publish behind the redirect is still a publish');
  });

  await test('ports "the shared prefix peel reads a publish behind time, a backslash, if and !"', async () => {
    for (const c of ['time npm publish', '\\npm publish', 'if npm publish', '! npm publish']) {
      const { deny } = await judge(c, { npmTaken: ['widget@1.2.3'] });
      assertEq(deny, TAKEN(PUBLISH, 'npm already has widget@1.2.3'), `the publish behind the prefix is still a publish: ${c}`);
    }
  });

  group('release-taken: workspaces');

  await test('ports "a packages/* member that is taken bounces, and a private member is not asked"', async () => {
    const { deny, calls } = await judge('git commit -m "chore(release): 2.0.0"', {
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/core': { name: '@fam/core', version: '2.0.0', private: false, files: ['dist'] },
        'packages/secret': { name: '@fam/secret', version: '2.0.0', private: true, files: ['dist'] },
      },
      npmTaken: ['@fam/core@2.0.0'],
    });
    assertEq(deny, TAKEN('this release commit', 'npm already has @fam/core@2.0.0'), 'one taken member is a taken family release');
    assertEq(calls.npm.join(' '), '@fam/core@2.0.0', 'only the publishable member is asked');
  });

  await test('ports "a publish naming a workspace checks that member alone"', async () => {
    const { deny, calls } = await judge('npm publish --workspace=@s/b --access public', { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
    assertEq(deny, null, 'the member published before it does not bounce this one');
    assertEq(calls.npm.join(' '), '@s/b@0.5.0', 'only the named member is asked');
  });

  await test('ports "the named workspace bounces when its own version is taken, in every flag spelling"', async () => {
    for (const command of [
      'npm publish --workspace=@s/b',
      'npm publish --workspace @s/b',
      'npm publish -w @s/b --access public',
      'npm publish -w=@s/b',
      'npm publish --workspace=packages/b',
      'npm publish --workspace=./packages/b/',
    ]) {
      const { deny } = await judge(command, { ...FAMILY(), npmTaken: ['@s/b@0.5.0'] });
      assertEq(deny, TAKEN(PUBLISH, 'npm already has @s/b@0.5.0'), `${command} is a publish of a taken version`);
    }
  });

  await test('ports "a workspace that is no member stands down out loud"', async () => {
    for (const [command, name] of [['npm publish --workspace=@s/nope', '@s/nope'], ['npm publish -w family', 'family']]) {
      const { deny, text, calls } = await judge(command, { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
      assertEq(deny, null, `${command} could not be placed, so it never blocks`);
      assertEq(text, `release-taken: the workspace ${name} is not a member of this project, so the publish could not be placed and the check stood down.`,
        `${command} says the check stood down`);
      assertEq(calls.npm.length, 0, `nothing is asked, got: ${calls.npm.join(' ')}`);
    }
  });

  await test('ports "the workspace flag before the subcommand still narrows"', async () => {
    const { deny, calls } = await judge('npm -w @s/b publish', { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
    assertEq(deny, null, 'only @s/b is published');
    assertEq(calls.npm.join(' '), '@s/b@0.5.0', 'only the named member is asked');
  });

  await test('ports "two workspace flags ask exactly those two members"', async () => {
    const { deny, calls } = await judge('npm publish --workspace=@s/b --workspace=@s/c', FAMILY({ 'packages/c': member('@s/c') }));
    assertEq(deny, null, 'nothing is taken');
    assertEq([...calls.npm].sort().join(','), '@s/b@0.5.0,@s/c@0.5.0', 'exactly the named two');
  });

  await test('ports "every publishing clause of a chain is checked, not just the first"', async () => {
    for (const command of [
      'npm publish --workspace=@s/b && npm publish --workspace=@s/a',
      'npm publish --workspace=@s/b; npm publish --workspace=@s/a',
    ]) {
      const { deny } = await judge(command, { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
      assertEq(deny, TAKEN(PUBLISH, 'npm already has @s/a@0.5.0'), `${command} publishes a taken @s/a`);
    }
  });

  await test('ports "a redirect\'s & never cuts the publish clause before its workspace flag"', async () => {
    const command = 'npm publish 2>&1 --workspace=@s/b';
    const other = await judge(command, { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
    assertEq(other.deny, null, 'only @s/b is published, so the taken @s/a does not bounce it');
    assertEq(other.calls.npm.join(' '), '@s/b@0.5.0', 'only the named member is asked');
    const named = await judge(command, { ...FAMILY(), npmTaken: ['@s/b@0.5.0'] });
    assertEq(named.deny, TAKEN(PUBLISH, 'npm already has @s/b@0.5.0'), 'the named member is taken');
  });

  await test('ports "a redirect between a workspace flag and its value is skipped, never read as the name"', async () => {
    for (const command of ['npm publish --workspace 2>&1 @s/a', 'npm publish -w > out @s/a']) {
      const { deny } = await judge(command, { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
      assertEq(deny, TAKEN(PUBLISH, 'npm already has @s/a@0.5.0'), `${command} publishes a taken @s/a`);
    }
  });

  await test('ports "a chain with one unnarrowed publish checks the whole set"', async () => {
    const { deny, calls } = await judge('npm publish --workspace=@s/b && npm publish', { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
    assertEq(deny, TAKEN(PUBLISH, 'npm already has @s/a@0.5.0'), 'the plain publish reaches every member');
    assertEq([...calls.npm].sort().join(','), '@s/a@0.5.0,@s/b@0.5.0', 'both members are asked');
  });

  await test('ports "a quoted workspace name stands down out loud, never naming the strip placeholder"', async () => {
    const { deny, text, calls } = await judge('npm publish --workspace="@s/b"', { ...FAMILY(), npmTaken: ['@s/b@0.5.0'] });
    assertEq(deny, null, 'a name that cannot be read never blocks');
    assertEq(text, 'release-taken: a quoted workspace name could not be read, so the publish could not be placed and the check stood down.',
      'says why it stood down');
    assert(!text.includes('_hookq_'), `the placeholder is internal, got: ${text}`);
    assertEq(calls.npm.length, 0, `nothing is asked, got: ${calls.npm.join(' ')}`);
  });

  await test('ports "an empty workspace value stands down out loud rather than passing in silence"', async () => {
    const { deny, text, calls } = await judge('npm publish --workspace=', { ...FAMILY(), npmTaken: ['@s/b@0.5.0'] });
    assertEq(deny, null, 'a flag naming nothing never blocks');
    assertEq(text, 'release-taken: a workspace flag names no workspace, so the publish could not be placed and the check stood down.',
      'says the check stood down');
    assertEq(calls.npm.length, 0, `nothing is asked, got: ${calls.npm.join(' ')}`);
  });

  await test('ports "--workspaces, all of them, still checks the whole set"', async () => {
    const { deny, calls } = await judge('npm publish --workspaces', { ...FAMILY(), npmTaken: ['@s/a@0.5.0'] });
    assertEq(deny, TAKEN(PUBLISH, 'npm already has @s/a@0.5.0'), 'a taken member bounces the family publish');
    assertEq([...calls.npm].sort().join(','), '@s/a@0.5.0,@s/b@0.5.0', 'both members are asked');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
