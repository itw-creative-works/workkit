//
// Tests for hooks/safety/release-taken, the PreToolUse hook that refuses a
// release whose version a provider already has: failing open out loud, and
// its wiring in hooks.json.
// The shared prologue (the npm and gh stubs, the repo factory, the hook runner, the release command) is ./helpers.js.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath, systemPathWith } = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const {
  HOOK, cleanup, makeStubs, npmCalls, mkRepo, runHook, RELEASE,
} = require('./helpers');

const run = async () => {
  group('release-taken: fail-open');

  await test('a provider that cannot tell stands down out loud, and the commit stands', () => {
    const stubs = makeStubs({ npmFails: true, ghFails: true });
    const dir = mkRepo();
    const { code, stderr } = runHook(RELEASE, dir, stubs);
    assertEq(code, 0, 'an unanswerable check never blocks a release');
    assert(/npm[\s\S]*stood down/.test(stderr), `the npm check says it stood down, got: ${stderr}`);
    assert(/github-release[\s\S]*stood down/.test(stderr),
      `the github-release check says it stood down, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a publish behind a cd cannot be placed, so it stands down out loud', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    const { code, stderr } = runHook('cd /other && npm publish', dir, stubs);
    assertEq(code, 0, 'the package the command would publish is not the one here');
    assert(stderr.includes('stood down'), `says the check did not run, got: ${stderr}`);
    assertEq(npmCalls(stubs).length, 0,
      `the session directory package is never judged instead, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a message in a file leaves no subject to read, and says so', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    for (const c of ['git commit -F msg.txt', 'git commit --file=msg.txt']) {
      const { code, stderr } = runHook(c, dir, stubs);
      assertEq(code, 0, `an unreadable subject never blocks: ${c}`);
      assert(stderr.includes('stood down'), `says the check did not run for ${c}, got: ${stderr}`);
    }
    assertEq(npmCalls(stubs).length, 0, `nothing is asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a workspace member that is not there is named, never skipped in silence', () => {
    const stubs = makeStubs();
    const dir = mkRepo({
      pkg: { name: 'family', version: '2.0.0', private: true, workspaces: ['packages/gone', 'apps/*'] },
    });
    const { code, stderr } = runHook('git commit -m "chore(release): 2.0.0"', dir, stubs);
    assertEq(code, 0, 'a member that is not there takes nothing with it');
    assert(stderr.includes('packages/gone'), `names the missing member, got: ${stderr}`);
    assert(stderr.includes('apps/*'), `names the pattern that matched nothing, got: ${stderr}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('malformed JSON, exit 0', () => {
    const stubs = makeStubs();
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: 'not json',
      env: { HOME: shellPath(os.homedir()), PATH: systemPathWith(stubs.binDir) },
      encoding: 'utf8',
      timeout: 30000,
    });
    assertEq(res.status, 0, 'bad input means fail open');
    cleanup(stubs.dir);
  });

  group('release-taken: wiring');

  await test('hooks.json registers the hook under PreToolUse Bash, after commit-language', () => {
    const wiring = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bash = (wiring.hooks.PreToolUse || []).find((b) => b.matcher === 'Bash');
    assert(bash, 'a PreToolUse Bash block exists');
    const names = bash.hooks.map((h) => h.command);
    const mine = names.findIndex((c) => c.includes('safety:release-taken'));
    assert(mine > 0, `the Bash block routes safety:release-taken through the loader, got: ${names.join(' ')}`);
    assert(names[mine - 1].includes('safety:commit-language'),
      `it sits after safety:commit-language, got: ${names.join(' ')}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
