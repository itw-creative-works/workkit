//
// Tests for workflow/workkit.sh: the engine commands (note, enable, heal).
// The shared prologue (the scratch world, runCli and inCli, the repo and kit factories) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { cleanup, mkWorld, runCli, mkRepo } = require('./helpers');

const run = async () => {
  group('workkit: the engine commands');

  await test('note delegates to the capture CLI', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, out } = runCli(world, ['note', 'fix', 'the', 'tower', 'poller'], { cwd: repo });
    assertEq(code, 0, 'exit 0');
    assert(out.includes('✓ noted →'), `the capture CLI answered, got: ${out}`);
    assert(fs.readFileSync(path.join(repo, W, 'capture.md'), 'utf8').endsWith('- fix the tower poller\n'), 'one bullet, in the repo capture file');
    cleanup(world.root); cleanup(repo);
  });

  await test('an empty note fails the way the capture CLI fails', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, err } = runCli(world, ['note'], { cwd: repo });
    assertEq(code, 1, 'exit 1');
    assert(err.includes('usage: wk.sh note'), `the delegate’s own usage, got: ${err}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('enable writes the repo’s committed opt-in', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['enable', repo]);
    assertEq(code, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, W, 'settings.json')), 'the repo’s yes is on disk');
    cleanup(world.root); cleanup(repo);
  });

  // The heal a session makes once a day, asked for now, so the assertion is
  // that the pass RAN on the target, named or the one the shell stands in.
  await test('heal runs the standards pass on the repo, named or the current one', () => {
    const world = mkWorld();
    const named = mkRepo({ optIn: true });
    const here = mkRepo({ optIn: true });
    assertEq(runCli(world, ['heal', named]).code, 0, 'exit 0 on a named repo');
    assert(fs.existsSync(path.join(named, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the named repo was healed');
    assertEq(runCli(world, ['heal'], { cwd: here }).code, 0, 'exit 0 with no argument');
    assert(fs.existsSync(path.join(here, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and no argument heals the repo the shell is in');
    cleanup(world.root); cleanup(named); cleanup(here);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
