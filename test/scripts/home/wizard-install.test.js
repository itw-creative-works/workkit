// Tests for workflow/home.sh: the setup wizard's install (keyed from the clone's
// real path, the retry for bins linked late, the warning when they never are).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { fmtCalls } = require('../../lib/argv-log');
const { cleanup, mkWorld, setup } = require('./helpers');

describe('workflow/home: the wizard, the install', () => {
  test('the install is keyed from the clone’s real path, symlinked ~/.workkit or not', () => {
    // `npm --prefix <link>/tower install` resolves the project through the link
    // but keys the tree from the caller's cwd, and the lockfile then takes paths
    // outside the project root: a corrupt tree the next install dies inside.
    const world = mkWorld({ login: 'owner' });
    const link = path.join(world.root, 'linked-workkit');
    fs.symlinkSync(world.workflowHome, link);
    world.env.WORKFLOW_HOME = link;

    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    const cwds = world.npmCwds();
    expect(cwds.length, `one install, and its cwd recorded: ${cwds.join(' | ')}`).toBe(1);
    expect(cwds[0], 'the cwd is the clone with its links resolved').toBe(shellPath(world.tower));
    expect(!world.npmCalls().some((c) => c.includes('--prefix')),
      `and no --prefix keys the tree from elsewhere: ${fmtCalls(world.npmCalls())}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a fresh tree that links its bins only on the second pass still installs', () => {
    // npm's workspace linking can leave node_modules/.bin half empty on a first
    // install that a second one fills. One retry makes that machine publishable.
    const world = mkWorld({ login: 'owner', npmLinksOn: 2 });
    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(/the tower project can build here/.test(out), `the retry is what proved it, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the bin is linked').toBeTruthy();
    expect(world.npmCalls().filter((c) => /install/.test(c)).length, 'two passes, never more').toBe(2);
    cleanup(world.root);
  });

  test('a tree that never links its bins warns once, after the retry', () => {
    const world = mkWorld({ login: 'owner', npmLinksOn: 0 });
    const { code, out } = setup(world);
    expect(code, `the setup still finishes: ${out}`).toBe(0);
    expect(world.npmCalls().filter((c) => /install/.test(c)).length, 'it retried once and stopped').toBe(2);
    expect(/build tooling did not install/.test(out), `and says so plainly, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});
