//
// Tests for hooks/workflow:standards: the setup pester (#72), heard every
// session until the machine has run `workkit setup`.
// The shared prologue (the repo factory, the decline, the hook runner and its gh-less PATH, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  mkTmp, cleanup, makeRepo, decline, runHook, dropPathWithoutGh,
} = require('./helpers');

const run = async () => {
  group('workflow:standards: the setup pester (#72)');

  const contextOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

  await test('a machine that never ran setup is told to, every session', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const cache = mkTmp();
    const first = runHook(repo, { home, cache, setup: false });
    assertEq(first.code, 0, 'exit 0');
    const ctx = contextOf(first.stdout);
    assert(ctx.includes('SETUP:'), `the session hears it, got: ${ctx}`);
    assert(ctx.includes('workkit.sh setup'), `and is given the exact command, got: ${ctx}`);
    assert(ctx.includes('issue forms'), 'the heal report rides along with it');
    // Second session, same day: the daily gate silences the heal, never the pester.
    const second = runHook(repo, { home, cache, setup: false });
    assert(contextOf(second.stdout).includes('workkit.sh setup'), `no nag cache, got: ${second.stdout}`);
    assert(!second.stdout.includes('issue forms'), 'and the daily gate still holds for the heal');
    cleanup(repo); cleanup(home); cleanup(cache);
  });

  await test('a set-up machine hears nothing about setup', () => {
    const repo = makeRepo();
    const home = mkTmp();
    const first = runHook(repo, { home });
    assert(!first.stdout.includes('SETUP:'), `the pester ends when setup has run, got: ${first.stdout}`);
    const second = runHook(repo, { home });
    assertEq(second.stdout, '', `and a quiet session stays quiet, got: ${second.stdout}`);
    cleanup(repo); cleanup(home); cleanup(first.cacheDir); cleanup(second.cacheDir);
  });

  await test('setup is a machine question: the pester reaches a non-git cwd too', () => {
    const dir = mkTmp();
    const home = mkTmp();
    const { code, stdout, cacheDir } = runHook(dir, { home, setup: false });
    assertEq(code, 0, 'exit 0');
    assert(contextOf(stdout).includes('workkit.sh setup'), `nothing about the machine needs a repo, got: ${stdout}`);
    assert(!fs.existsSync(path.join(dir, '.github')), 'and still nothing written outside a repo');
    cleanup(dir); cleanup(home); cleanup(cacheDir);
  });

  await test('a declined repo still hears the setup pester and nothing else', () => {
    const repo = makeRepo({ optIn: false });
    const home = mkTmp();
    const workflowHome = mkTmp();
    decline(repo, workflowHome);
    const { stdout, cacheDir } = runHook(repo, { home, workflowHome, setup: false });
    const ctx = contextOf(stdout);
    assert(ctx.includes('workkit.sh setup'), `the machine question is not the repo's to decline, got: ${ctx}`);
    assert(!ctx.includes('not in the issue workflow'), 'the decline still holds for the repo offer');
    cleanup(repo); cleanup(home); cleanup(cacheDir); cleanup(workflowHome);
  });

  dropPathWithoutGh();
  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
