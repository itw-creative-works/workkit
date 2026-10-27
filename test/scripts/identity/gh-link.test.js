// Tests for the `~/.local/bin/gh` link to workflow/identity/gh that `workkit
// setup` and `update` keep and `doctor` reports, through the workkit-cli
// suites' scratch machine (../workkit-cli/helpers.js).

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { shellPath, joinPath, stubTool } = require('../../lib/platform');
const {
  WORKFLOW_DIR, cleanup, mkWorld, runCli, mkRepo, mkKit, mkSetupKit,
} = require('../workkit-cli/helpers');
const { attentionCount } = require('../../lib/identity');

const SHIM = path.join(WORKFLOW_DIR, 'identity', 'gh');

/** The scratch machine's `~/.local/bin/gh`. */
const ghLink = (world) => path.join(world.localBin, 'gh');

/** A machine ready for `setup`: the plugin installed, ~/.local/bin on PATH, a repo and a kit to run. */
const mkSetupScene = () => {
  const world = mkWorld({ pluginInstalled: true, binOnPath: true });
  fs.mkdirSync(world.claudeHome, { recursive: true });
  return { world, repo: mkRepo({ optIn: true }), ...mkSetupKit() };
};

const cases = async () => {
  group('identity/gh link: setup and update');

  await test('setup links ~/.local/bin/gh to the kit\'s workflow/identity/gh', () => {
    const { world, repo, kit, script } = mkSetupScene();
    const { said } = runCli(world, ['setup'], { cwd: repo, script });
    assertEq(fs.readlinkSync(ghLink(world)), path.join(kit, 'workflow', 'identity', 'gh'), `the link points at the shim (setup said: ${said})`);
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  await test('update links ~/.local/bin/gh to the checkout\'s workflow/identity/gh', () => {
    const world = mkWorld();
    const { code, said } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0: ${said}`);
    assertEq(fs.readlinkSync(ghLink(world)), SHIM, 'the link points at the shim');
    cleanup(world.root);
  });

  await test('update repoints a gh link into another kit copy\'s workflow/identity/gh', () => {
    const world = mkWorld();
    const other = mkKit('other/kit');
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(path.join(other.kit, 'workflow', 'identity', 'gh'), ghLink(world));
    const { said } = runCli(world, ['update']);
    assertEq(fs.readlinkSync(ghLink(world)), SHIM, 'repointed at this checkout');
    assert(said.includes('repointed'), `and says so, got: ${said}`);
    cleanup(world.root); cleanup(other.kit);
  });

  await test('setup leaves a foreign gh link alone and reports it', () => {
    const { world, repo, kit, script } = mkSetupScene();
    const foreign = path.join(world.root, 'someone-elses-gh');
    stubTool(world.root, 'someone-elses-gh', ['#!/usr/bin/env bash', 'exit 0']);
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(foreign, ghLink(world));
    const { said } = runCli(world, ['setup'], { cwd: repo, script });
    assertEq(fs.readlinkSync(ghLink(world)), foreign, 'the link still points where it did');
    assert(said.includes(shellPath(foreign)), `the run names the foreign target, got: ${said}`);
    cleanup(world.root); cleanup(kit); cleanup(repo);
  });

  group('identity/gh link: doctor');

  await test('doctor prints an ok line for a current link, and a warning plus one attention item for a missing one', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const linked = runCli(world, ['doctor']);
    const okLine = linked.out.split('\n').find((l) => /^ *✓ /.test(l) && l.includes(shellPath(ghLink(world))));
    assert(okLine, `an ok line names the link, got: ${linked.out}`);

    fs.unlinkSync(ghLink(world));
    const missing = runCli(world, ['doctor']);
    const warnings = (res) => res.err.split('\n').filter((l) => /^ *⚠ /.test(l) && !l.includes('need attention'));
    const added = warnings(missing).filter((l) => !warnings(linked).includes(l));
    assertEq(added.length, 1, `one new warning, got: ${added.join(' | ')}`);
    assert(/\bgh\b/.test(added[0]), `and it is about the gh link, got: ${added[0]}`);
    assertEq(attentionCount(missing.said), attentionCount(linked.said) + 1, 'one more item needs attention');
    cleanup(world.root);
  });

  await test('doctor names a foreign gh link as someone else\'s, never a link update would fix', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const foreign = path.join(world.root, 'someone-elses-gh');
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(foreign, ghLink(world));
    const { said } = runCli(world, ['doctor']);
    assert(said.includes(`${shellPath(ghLink(world))} is someone else's link to ${shellPath(foreign)}`), `it names the foreign target, got: ${said}`);
    assert(!said.includes(`${shellPath(ghLink(world))} is missing or points elsewhere`), `and never sends it to update, got: ${said}`);
    cleanup(world.root);
  });

  await test('doctor warns when another gh comes before ~/.local/bin on PATH, one more attention item', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const otherBin = path.join(world.root, 'other-gh-bin');
    fs.mkdirSync(otherBin);
    stubTool(otherBin, 'gh', ['#!/usr/bin/env bash', 'exit 0']);

    const shimFirst = runCli(world, ['doctor']);
    const otherFirst = runCli(world, ['doctor'], { env: { PATH: joinPath(otherBin, world.env.PATH) } });
    const warnings = (res) => res.err.split('\n').filter((l) => /^ *⚠ /.test(l) && !l.includes('need attention'));
    const added = warnings(otherFirst).filter((l) => !warnings(shimFirst).includes(l));
    assertEq(added.length, 1, `one new warning, got: ${added.join(' | ')}`);
    assert(/\bgh\b/.test(added[0]), `and it is about which gh comes first, got: ${added[0]}`);
    assertEq(attentionCount(otherFirst.said), attentionCount(shimFirst.said) + 1, 'one more item needs attention');
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
