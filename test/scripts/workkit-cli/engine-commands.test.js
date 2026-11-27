// Tests for workflow/workkit.js: the engine commands (note, enable, heal), and
// publish in a kit without its program.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const {
  cleanup, mkWorld, runCli, mkRepo, mkPartialKit,
} = require('./helpers');

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
    expect(err.includes('usage: workkit note'), `the delegate’s own usage, got: ${err}`).toBeTruthy();
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

  // publish answers 0 whatever came of it: setup reads the failure, never the code.
  test('publish in a kit with no publish.js names the file and the incomplete kit, exit 0', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const { code, err } = runCli(world, ['publish'], { script });
    expect(code, `exit 0, got: ${err}`).toBe(0);
    const line = `⚠ site: publish.js is missing at ${gitPath(path.join(kit, 'workflow', 'publish.js'))}; the kit is incomplete`;
    expect(err.split(/\r?\n/).includes(line), `the line naming publish.js, got: ${err}`).toBeTruthy();
    cleanup(world.root); cleanup(kit);
  });

  test('heal, note and changelog lint in a kit with no standards.js, note.js or changelog/lint.js: each one line naming its file and the incomplete kit, exit 1', () => {
    const world = mkWorld();
    const { kit, script } = mkPartialKit();
    const CALLS = [[['heal', 'x'], 'heal', 'standards.js'], [['note', 'x'], 'note', 'note.js'], [['changelog', 'lint', 'x'], 'changelog lint', 'changelog/lint.js']];
    for (const [argv, step, file] of CALLS) {
      const { code, err } = runCli(world, argv, { script });
      expect(code, `${step}: exit 1, got: ${err}`).toBe(1);
      expect(err, `${step}: the one line`).toBe(`✖ ${step}: ${path.basename(file)} is missing at ${gitPath(path.join(kit, 'workflow', file))}; the kit is incomplete\n`);
    }
    cleanup(world.root); cleanup(kit);
  });
});
