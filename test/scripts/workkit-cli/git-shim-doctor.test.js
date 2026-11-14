// Tests for what `workkit doctor` says about the git shim, workflow/gitshim/git,
// which a Claude session's start puts first on PATH: the kit's own copy of it,
// and in a session whether the first git is a shim. Every case sets or clears
// CLAUDECODE itself, so a suite run from inside a session reads the same.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NO_EXEC_BIT, SYSTEM_PATH, gitPath, joinPath, shellPath, stubTool, which,
} = require('../../lib/platform');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, mkKit,
} = require('./helpers');
const { attentionCount, doctorWarnings } = require('../../lib/identity');

// An undefined value leaves the variable out of the child's environment.
const IN_SESSION = { CLAUDECODE: '1' };
const NO_SESSION = { CLAUDECODE: undefined };

/** The kit's own shim: first on PATH, it is the session cases' ok baseline. */
const OWN_SHIM = path.join(WORKFLOW_DIR, 'gitshim', 'git');

/** The warnings `res` printed that `base` did not. */
const addedWarnings = (base, res) => doctorWarnings(res).filter((l) => !doctorWarnings(base).includes(l));

/** The ok line of a doctor run that names one of `paths`, or undefined. */
const okLineNaming = (res, paths) => res.out.split('\n').find((l) => /^ *✓ /.test(l) && paths.some((p) => l.includes(gitPath(p))));

/** A machine with the plugin installed, and its Claude home made. */
const mkScene = () => {
  const world = mkWorld({ pluginInstalled: true });
  fs.mkdirSync(world.claudeHome, { recursive: true });
  return world;
};

/** PATH with `dir` ahead of the world's own. */
const pathFirst = (world, dir) => ({ PATH: joinPath(shellPath(dir), world.env.PATH) });

/**
 * A folder holding a `git` that is no shim: it hands every call to the real git,
 * so the rest of doctor reads the machine as it would. Returns the folder.
 */
const otherGitBin = (world) => {
  const dir = path.join(world.root, 'other-git-bin');
  fs.mkdirSync(dir);
  stubTool(dir, 'git', ['#!/usr/bin/env bash', `exec ${JSON.stringify(shellPath(which('git', SYSTEM_PATH)))} "$@"`]);
  return dir;
};

describe('doctor: the git shim', () => {
  test('a kit whose gitshim/git is missing gets one warning naming that path as an incomplete kit, one more attention item', () => {
    const world = mkScene();
    const { kit, script } = mkKit('other/kit');
    const shim = path.join(kit, 'workflow', 'gitshim', 'git');
    const whole = runCli(world, ['doctor'], { script, env: NO_SESSION });

    fs.rmSync(shim);
    const missing = runCli(world, ['doctor'], { script, env: NO_SESSION });
    const added = addedWarnings(whole, missing);
    expect(added.length, `one new warning, got: ${added.join(' | ')}`).toBe(1);
    expect(added[0].includes(gitPath(shim)), `it names the shim's path, got: ${added[0]}`).toBeTruthy();
    expect(/incomplete/.test(added[0]), `and calls the kit incomplete, got: ${added[0]}`).toBeTruthy();
    expect(attentionCount(missing.said), 'one more item needs attention').toBe(attentionCount(whole.said) + 1);
    cleanup(world.root); cleanup(kit);
  });

  test('a kit whose gitshim/git is not executable gets the same warning and attention item', { skip: IS_WINDOWS && NO_EXEC_BIT }, () => {
    const world = mkScene();
    const { kit, script } = mkKit('other/kit');
    const shim = path.join(kit, 'workflow', 'gitshim', 'git');
    const whole = runCli(world, ['doctor'], { script, env: NO_SESSION });

    fs.chmodSync(shim, 0o644);
    const plain = runCli(world, ['doctor'], { script, env: NO_SESSION });
    const added = addedWarnings(whole, plain);
    expect(added.length, `one new warning, got: ${added.join(' | ')}`).toBe(1);
    expect(added[0].includes(gitPath(shim)), `it names the shim's path, got: ${added[0]}`).toBeTruthy();
    expect(/incomplete/.test(added[0]), `and calls the kit incomplete, got: ${added[0]}`).toBeTruthy();
    expect(attentionCount(plain.said), 'one more item needs attention').toBe(attentionCount(whole.said) + 1);
    cleanup(world.root); cleanup(kit);
  });

  test('in a session, a first git whose folder resolves to another kit copy\'s workflow/gitshim is an ok line naming it',
    { skip: IS_WINDOWS && 'Windows makes no symlink without a privilege this run may lack' }, () => {
      const world = mkScene();
      const { kit } = mkKit('other/kit');
      // The folder PATH names is a link, so only its physical path is a gitshim folder.
      const linked = path.join(world.root, 'session-shim');
      fs.symlinkSync(path.join(kit, 'workflow', 'gitshim'), linked);
      const res = runCli(world, ['doctor'], { env: { ...IN_SESSION, ...pathFirst(world, linked) } });
      const okLine = okLineNaming(res, [path.join(linked, 'git'), path.join(kit, 'workflow', 'gitshim', 'git')]);
      expect(okLine, `an ok line names the shim PATH finds, got: ${res.said}`).toBeTruthy();
      expect(doctorWarnings(res).filter((l) => /\bgit\b/.test(l) && /tree-guard/.test(l)), 'and no warning says tree-guard is off').toEqual([]);
      cleanup(world.root); cleanup(kit);
    });

  test('in a session, a first git that is no shim gets one warning naming it, tree-guard off, a restart the fix; one more attention item', () => {
    const world = mkScene();
    const other = otherGitBin(world);
    const shimFirst = runCli(world, ['doctor'], { env: { ...IN_SESSION, ...pathFirst(world, path.dirname(OWN_SHIM)) } });
    expect(okLineNaming(shimFirst, [OWN_SHIM]), `the baseline, the kit's own shim first, is an ok line naming it, got: ${shimFirst.said}`).toBeTruthy();
    const otherFirst = runCli(world, ['doctor'], { env: { ...IN_SESSION, ...pathFirst(world, other) } });
    const added = addedWarnings(shimFirst, otherFirst);
    expect(added.length, `one new warning, got: ${added.join(' | ')}`).toBe(1);
    expect(added[0].includes(gitPath(path.join(other, 'git'))), `it names the git PATH finds first, got: ${added[0]}`).toBeTruthy();
    expect(added[0].includes('safety:tree-guard'), `says tree-guard is off, got: ${added[0]}`).toBeTruthy();
    expect(/restart/.test(added[0]), `and that a session restart is the fix, got: ${added[0]}`).toBeTruthy();
    expect(attentionCount(otherFirst.said), 'one more item needs attention').toBe(attentionCount(shimFirst.said) + 1);
    cleanup(world.root);
  });

  test('outside a session, any first git is a skip line saying a session puts the shim first, and counts nothing', () => {
    const world = mkScene();
    const other = otherGitBin(world);
    const shimOk = runCli(world, ['doctor'], { env: { ...IN_SESSION, ...pathFirst(world, path.dirname(OWN_SHIM)) } });
    const outside = runCli(world, ['doctor'], { env: { ...NO_SESSION, ...pathFirst(world, other) } });
    const skipLine = outside.out.split('\n').find((l) => /^ *· /.test(l) && /\bgit\b/.test(l) && /shim/.test(l));
    expect(skipLine, `a skip line about the git shim, got: ${outside.said}`).toBeTruthy();
    expect(/session/.test(skipLine), `it says a session is where the shim goes first, got: ${skipLine}`).toBeTruthy();
    expect(addedWarnings(shimOk, outside), 'no warning the ok run lacked').toEqual([]);
    expect(attentionCount(outside.said), 'the same attention as a session with the shim first').toBe(attentionCount(shimOk.said));
    cleanup(world.root);
  });
});
