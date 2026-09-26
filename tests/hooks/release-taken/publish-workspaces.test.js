//
// Tests for hooks/safety/release-taken, the PreToolUse hook that refuses a
// release whose version a provider already has: `npm publish`, and the
// workspace members a release or a publish asks about.
// The shared prologue (the npm and gh stubs, the repo factory, the hook runner, the release command) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeStubs, npmCalls, ghCalls, mkRepo, runHook,
} = require('./helpers');

const run = async () => {
  group('release-taken: npm publish');

  await test('a taken version bounces the publish, and GitHub is not asked', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook('npm publish --access public', dir, stubs);
    assertEq(code, 2, 'the registry already has it');
    assert(stderr.includes('this npm publish'), `names the trigger, got: ${stderr}`);
    assert(stderr.includes('npm already has widget@1.2.3'), `names the pair, got: ${stderr}`);
    assertEq(ghCalls(stubs).length, 0,
      `the release legitimately precedes the publish, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  group('release-taken: workspaces');

  await test('a packages/* member that is taken bounces, and a private member is not asked', () => {
    const stubs = makeStubs({ npmTaken: ['@fam/core@2.0.0'] });
    const dir = mkRepo({
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/*'] },
      members: {
        'packages/core': { name: '@fam/core', version: '2.0.0', private: false, files: ['dist'] },
        'packages/secret': { name: '@fam/secret', version: '2.0.0', private: true, files: ['dist'] },
      },
    });
    const { code, stderr } = runHook('git commit -m "chore(release): 2.0.0"', dir, stubs);
    assertEq(code, 2, 'one taken member is a taken family release');
    assert(stderr.includes('npm already has @fam/core@2.0.0'), `names the member, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assertEq(calls.length, 1, `only the publishable member is asked, got: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.some((a) => a.includes('@fam/secret'))),
      `the private member is never asked, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  // A family published one member at a time: the member published a moment
  // ago is taken by then, and must not bounce the next one's publish.
  const member = (name) => ({ name, version: '0.5.0', private: false, files: ['dist'] });
  const FAMILY = (extra = {}) => mkRepo({
    pkg: { name: 'family', version: '0.5.0', private: true, workspaces: ['packages/*'] },
    members: { 'packages/a': member('@s/a'), 'packages/b': member('@s/b'), ...extra },
  });

  await test('a publish naming a workspace checks that member alone', () => {
    const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm publish --workspace=@s/b --access public', dir, stubs);
    assertEq(code, 0, `the member published before it does not bounce this one, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assertEq(calls.length, 1, `only the named member is asked, got: ${fmtCalls(calls)}`);
    assert(calls[0].some((a) => a === '@s/b@0.5.0'), `and it is the named one, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the named workspace bounces when its own version is taken, in every flag spelling', () => {
    for (const command of [
      'npm publish --workspace=@s/b',
      'npm publish --workspace @s/b',
      'npm publish -w @s/b --access public',
      'npm publish -w=@s/b',
      'npm publish --workspace=packages/b',
      'npm publish --workspace=./packages/b/',
    ]) {
      const stubs = makeStubs({ npmTaken: ['@s/b@0.5.0'] });
      const dir = FAMILY();
      const { code, stderr } = runHook(command, dir, stubs);
      assertEq(code, 2, `${command} is a publish of a taken version, got: ${stderr}`);
      assert(stderr.includes('npm already has @s/b@0.5.0'), `${command} names the pair, got: ${stderr}`);
      cleanup(dir);
      cleanup(stubs.dir);
    }
  });

  await test('a workspace that is no member stands down out loud', () => {
    const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
    const dir = FAMILY();
    for (const command of ['npm publish --workspace=@s/nope', 'npm publish -w family']) {
      const { code, stderr } = runHook(command, dir, stubs);
      assertEq(code, 0, `${command} could not be placed, so it never blocks`);
      assert(stderr.includes('is not a member of this project') && stderr.includes('stood down'),
        `${command} says the check stood down, got: ${stderr}`);
    }
    assertEq(npmCalls(stubs).length, 0, `nothing is asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the workspace flag before the subcommand still narrows', () => {
    const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm -w @s/b publish', dir, stubs);
    assertEq(code, 0, `only @s/b is published, got: ${stderr}`);
    const calls = npmCalls(stubs);
    assertEq(calls.length, 1, `only the named member is asked, got: ${fmtCalls(calls)}`);
    assert(calls[0].includes('@s/b@0.5.0'), `and it is the named one, got: ${fmtCalls(calls)}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('two workspace flags ask exactly those two members', () => {
    const stubs = makeStubs();
    const dir = FAMILY({ 'packages/c': member('@s/c') });
    const { code, stderr } = runHook('npm publish --workspace=@s/b --workspace=@s/c', dir, stubs);
    assertEq(code, 0, `nothing is taken, got: ${stderr}`);
    const asked = npmCalls(stubs).map((c) => c.find((a) => a.startsWith('@s/'))).sort();
    assertEq(asked.join(','), '@s/b@0.5.0,@s/c@0.5.0', `exactly the named two, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('every publishing clause of a chain is checked, not just the first', () => {
    for (const command of [
      'npm publish --workspace=@s/b && npm publish --workspace=@s/a',
      'npm publish --workspace=@s/b; npm publish --workspace=@s/a',
    ]) {
      const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
      const dir = FAMILY();
      const { code, stderr } = runHook(command, dir, stubs);
      assertEq(code, 2, `${command} publishes a taken @s/a, got: ${stderr}`);
      assert(stderr.includes('npm already has @s/a@0.5.0'), `${command} names the pair, got: ${stderr}`);
      cleanup(dir);
      cleanup(stubs.dir);
    }
  });

  await test('a chain with one unnarrowed publish checks the whole set', () => {
    const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm publish --workspace=@s/b && npm publish', dir, stubs);
    assertEq(code, 2, `the plain publish reaches every member, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 2, `both members are asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a quoted workspace name stands down out loud, never naming the strip placeholder', () => {
    const stubs = makeStubs({ npmTaken: ['@s/b@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm publish --workspace="@s/b"', dir, stubs);
    assertEq(code, 0, 'a name that cannot be read never blocks');
    assert(stderr.includes('a quoted workspace name could not be read, so the publish could not be placed and the check stood down'),
      `says why it stood down, got: ${stderr}`);
    assert(!stderr.includes('_hookq_'), `the placeholder is internal, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 0, `nothing is asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('an empty workspace value stands down out loud rather than passing in silence', () => {
    const stubs = makeStubs({ npmTaken: ['@s/b@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm publish --workspace=', dir, stubs);
    assertEq(code, 0, 'a flag naming nothing never blocks');
    assert(stderr.includes('stood down'), `says the check stood down, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 0, `nothing is asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('--workspaces, all of them, still checks the whole set', () => {
    const stubs = makeStubs({ npmTaken: ['@s/a@0.5.0'] });
    const dir = FAMILY();
    const { code, stderr } = runHook('npm publish --workspaces', dir, stubs);
    assertEq(code, 2, `a taken member bounces the family publish, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 2, `both members are asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
