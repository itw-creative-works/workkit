// Tests for workflow/workkit.sh: the engine commands (note, enable, heal).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { cleanup, mkWorld, runCli, mkRepo } = require('./helpers');

describe('workkit: the engine commands', () => {
  test('note delegates to the capture CLI', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, out } = runCli(world, ['note', 'fix', 'the', 'tower', 'poller'], { cwd: repo });
    expect(code, 'exit 0').toBe(0);
    expect(out.includes('✓ noted →'), `the capture CLI answered, got: ${out}`).toBeTruthy();
    expect(fs.readFileSync(path.join(repo, W, 'capture.md'), 'utf8').endsWith('- fix the tower poller\n'), 'one bullet, in the repo capture file').toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });

  test('an empty note fails the way the capture CLI fails', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, err } = runCli(world, ['note'], { cwd: repo });
    expect(code, 'exit 1').toBe(1);
    expect(err.includes('usage: wk.sh note'), `the delegate’s own usage, got: ${err}`).toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });

  test('enable writes the repo’s committed opt-in', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['enable', repo]);
    expect(code, 'exit 0').toBe(0);
    expect(fs.existsSync(path.join(repo, W, 'settings.json')), 'the repo’s yes is on disk').toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });

  // The heal a session makes once a day, asked for now, so the assertion is
  // that the pass ran on the target, named or the one the shell stands in.
  test('heal runs the standards pass on the repo, named or the current one', () => {
    const world = mkWorld();
    const named = mkRepo({ optIn: true });
    const here = mkRepo({ optIn: true });
    expect(runCli(world, ['heal', named]).code, 'exit 0 on a named repo').toBe(0);
    expect(fs.existsSync(path.join(named, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'the named repo was healed').toBeTruthy();
    expect(runCli(world, ['heal'], { cwd: here }).code, 'exit 0 with no argument').toBe(0);
    expect(fs.existsSync(path.join(here, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'and no argument heals the repo the shell is in').toBeTruthy();
    cleanup(world.root); cleanup(named); cleanup(here);
  });
});
