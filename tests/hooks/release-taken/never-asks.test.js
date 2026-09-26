//
// Tests for hooks/safety/release-taken, the PreToolUse hook that refuses a
// release whose version a provider already has: what it never asks about.
// The shared prologue (the npm and gh stubs, the repo factory, the hook runner, the release command) is ./helpers.js.
//

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeStubs, npmCalls, ghCalls, mkRepo, runHook,
} = require('./helpers');

const run = async () => {
  group('release-taken: what it never asks about');

  await test('a commit that is not a release, and a command that is no commit at all', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    for (const c of [
      'git commit -m "feat: x"',
      'git status',
      'npm run build',
    ]) {
      assertEq(runHook(c, dir, stubs).code, 0, `not this hook's business: ${c}`);
    }
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('the release subject mentioned mid-message is not a subject', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code } = runHook(
      'git commit -m "docs(ship): explain how chore(release): 1.2.3 is judged"', dir, stubs);
    assertEq(code, 0, 'a commit ABOUT the release rule is not the release commit');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a dry run publishes nothing, so it is not a publish', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'] });
    const dir = mkRepo();
    for (const c of ['npm publish --dry-run', 'npm publish --dry-run=true']) {
      assertEq(runHook(c, dir, stubs).code, 0, `nothing is published: ${c}`);
    }
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  await test('a quoted mention of the release subject is not a commit', () => {
    const stubs = makeStubs({ npmTaken: ['widget@1.2.3'], tags: ['v1.2.3'] });
    const dir = mkRepo();
    const { code } = runHook('echo "chore(release): 1.2.3"', dir, stubs);
    assertEq(code, 0, 'talking about a release is not cutting one');
    assertEq(npmCalls(stubs).length, 0, `npm is never asked, got: ${fmtCalls(npmCalls(stubs))}`);
    assertEq(ghCalls(stubs).length, 0, `gh is never asked, got: ${fmtCalls(ghCalls(stubs))}`);
    cleanup(dir);
    cleanup(stubs.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
