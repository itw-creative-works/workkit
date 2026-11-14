// Tests for the `~/.local/bin/gh` link to workflow/identity/gh that `workkit
// setup` and `update` keep and `doctor` reports, through the workkit-cli
// suites' scratch machine (../workkit-cli/helpers.js).

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect,
} = require('../../lib/harness');
const { gitPath, joinPath, stubTool } = require('../../lib/platform');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, mkRepo, mkKit, mkSetupKit,
} = require('../workkit-cli/helpers');
const { attentionCount, doctorWarnings } = require('../../lib/identity');

const SHIM = path.join(WORKFLOW_DIR, 'identity', 'gh');

/** The scratch machine's `~/.local/bin/gh`. */
const ghLink = (world) => path.join(world.localBin, 'gh');

/** A machine ready for `setup`: the plugin installed, ~/.local/bin on PATH, a repo and a kit to run. */
const mkSetupScene = () => {
  const world = mkWorld({ pluginInstalled: true, binOnPath: true });
  fs.mkdirSync(world.claudeHome, { recursive: true });
  return { world, repo: mkRepo({ optIn: true }), ...mkSetupKit() };
};

describe('identity/gh link: setup and update', () => {
  test('setup links ~/.local/bin/gh to the kit\'s workflow/identity/gh', () => {
    const { world, repo, kit, script } = mkSetupScene();
    const { said } = runCli(world, ['setup'], { cwd: repo, script });
    expect(fs.readlinkSync(ghLink(world)), `the link points at the shim (setup said: ${said})`).toBe(path.join(kit, 'workflow', 'identity', 'gh'));
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  test('update links ~/.local/bin/gh to the checkout\'s workflow/identity/gh', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['update']);
    expect(code, `exit 0: ${said}`).toBe(0);
    expect(fs.readlinkSync(ghLink(world)), 'the link points at the shim').toBe(SHIM);
    cleanup(world.root);
  });

  test('update repoints a gh link into another kit copy\'s workflow/identity/gh', () => {
    const world = mkWorld();
    const other = mkKit('other/kit');
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(path.join(other.kit, 'workflow', 'identity', 'gh'), ghLink(world));
    const { said } = runCli(world, ['update']);
    expect(fs.readlinkSync(ghLink(world)), 'repointed at this checkout').toBe(SHIM);
    expect(said.includes('repointed'), `and says so, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(other.kit);
  });

  test('setup leaves a foreign gh link alone and reports it', () => {
    const { world, repo, kit, script } = mkSetupScene();
    const foreign = path.join(world.root, 'someone-elses-gh');
    stubTool(world.root, 'someone-elses-gh', ['#!/usr/bin/env bash', 'exit 0']);
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(foreign, ghLink(world));
    const { said } = runCli(world, ['setup'], { cwd: repo, script });
    expect(fs.readlinkSync(ghLink(world)), 'the link still points where it did').toBe(foreign);
    expect(said.includes(gitPath(foreign)), `the run names the foreign target, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });
});

describe('identity/gh link: doctor', () => {
  test('doctor prints an ok line for a current link, and a warning plus one attention item for a missing one', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const linked = runCli(world, ['doctor']);
    const okLine = linked.out.split('\n').find((l) => /^ *✓ /.test(l) && l.includes(gitPath(ghLink(world))));
    expect(okLine, `an ok line names the link, got: ${linked.out}`).toBeTruthy();

    fs.unlinkSync(ghLink(world));
    const missing = runCli(world, ['doctor']);
    const added = doctorWarnings(missing).filter((l) => !doctorWarnings(linked).includes(l));
    expect(added.length, `one new warning, got: ${added.join(' | ')}`).toBe(1);
    expect(/\bgh\b/.test(added[0]), `and it is about the gh link, got: ${added[0]}`).toBeTruthy();
    expect(attentionCount(missing.said), 'one more item needs attention').toBe(attentionCount(linked.said) + 1);
    cleanup(world.root);
  });

  test('doctor names a foreign gh link as someone else\'s, never a link update would fix', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const foreign = path.join(world.root, 'someone-elses-gh');
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(foreign, ghLink(world));
    const { said } = runCli(world, ['doctor']);
    expect(said.includes(`${gitPath(ghLink(world))} is someone else's link to ${gitPath(foreign)}`), `it names the foreign target, got: ${said}`).toBeTruthy();
    expect(!said.includes(`${gitPath(ghLink(world))} is missing or points elsewhere`), `and never sends it to update, got: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  test('doctor warns when another gh comes before ~/.local/bin on PATH, one more attention item', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const otherBin = path.join(world.root, 'other-gh-bin');
    fs.mkdirSync(otherBin);
    stubTool(otherBin, 'gh', ['#!/usr/bin/env bash', 'exit 0']);

    const shimFirst = runCli(world, ['doctor']);
    const otherFirst = runCli(world, ['doctor'], { env: { PATH: joinPath(otherBin, world.env.PATH) } });
    const added = doctorWarnings(otherFirst).filter((l) => !doctorWarnings(shimFirst).includes(l));
    expect(added.length, `one new warning, got: ${added.join(' | ')}`).toBe(1);
    expect(/\bgh\b/.test(added[0]), `and it is about which gh comes first, got: ${added[0]}`).toBeTruthy();
    expect(attentionCount(otherFirst.said), 'one more item needs attention').toBe(attentionCount(shimFirst.said) + 1);
    cleanup(world.root);
  });
});
