// Tests for workflow/workkit/links.js: the `~/.local/bin/workkit` link the
// machine steps keep at workflow/workkit.js, and the gh shim link beside it,
// written by the steps setup and update run. The workkit.cmd beside them is
// test/scripts/workkit-cmd.test.js's. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath, skipWithoutFileLink } = require('../../lib/platform');
const {
  WORKFLOW_DIR, cleanup, mkWorld, mkKit, mkCacheKit, machineLinks, lines,
} = require('./helpers');

describe('workkit: the command link', () => {
  test("a link to the kit's workkit.sh is repointed to its workkit.js, by setup and update and by update --auto", { skip: skipWithoutFileLink() }, () => {
    for (const quiet of [false, true]) {
      const world = mkWorld({ binOnPath: true });
      const { kit } = mkKit('owner/workkit');
      const engine = fs.realpathSync(path.join(kit, 'workflow'));
      fs.mkdirSync(world.localBin, { recursive: true });
      fs.symlinkSync(path.join(engine, 'workkit.sh'), world.link);
      const res = machineLinks(world, { engine, quiet });
      const target = path.join(engine, 'workkit.js');
      expect(res.code, `quiet ${quiet}: exit 0, got: ${res.said}`).toBe(0);
      expect(fs.realpathSync(world.link), `quiet ${quiet}: the link names the kit's workkit.js, got: ${res.said}`).toBe(fs.realpathSync(target));
      expect(lines(res.out).includes(`✓ command: repointed ${gitPath(world.link)} → ${gitPath(target)}`),
        `quiet ${quiet}: and says so, got: ${res.said}`).toBe(true);
      cleanup(world.root); cleanup(kit);
    }
  });

  // A clone with an origin of its own outranks a plugin-cache kit, as in cache.test.js.
  test("run from the plugin cache, an old-name link into an outranking clone is repointed to that clone's workkit.js", { skip: skipWithoutFileLink() }, () => {
    const world = mkWorld({ binOnPath: true });
    const clone = mkKit('owner/workkit');
    const cloneEngine = fs.realpathSync(path.join(clone.kit, 'workflow'));
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(path.join(cloneEngine, 'workkit.sh'), world.link);
    const { kit } = mkCacheKit(world);
    const res = machineLinks(world, { engine: fs.realpathSync(path.join(kit, 'workflow')) });
    const target = path.join(cloneEngine, 'workkit.js');
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(fs.realpathSync(world.link), `the link names the clone's workkit.js, not the cache's, got: ${res.said}`).toBe(fs.realpathSync(target));
    expect(lines(res.out).includes(`✓ command: repointed ${gitPath(world.link)} → ${gitPath(target)}`),
      `and the repointed line names it, got: ${res.said}`).toBe(true);
    cleanup(world.root); cleanup(clone.kit);
  });
});

describe('workkit: the gh shim link', () => {
  const shimLink = (world) => path.join(world.localBin, 'gh');

  test("a link to another program is someone else's: warned about and left as it is", { skip: skipWithoutFileLink() }, () => {
    const world = mkWorld({ binOnPath: true });
    const other = path.join(world.bin, 'gh');
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(other, shimLink(world));
    const res = machineLinks(world);
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(fs.readlinkSync(shimLink(world)), `the link is left as it is, got: ${res.said}`).toBe(other);
    expect(lines(res.err).includes(`⚠ gh shim: ${gitPath(shimLink(world))} is someone else's link to ${gitPath(other)}; move it aside, then re-run \`workkit update\``),
      `the warning names it, got: ${res.said}`).toBe(true);
    expect(res.said.includes('gh shim: repointed'), `and nothing is repointed, got: ${res.said}`).toBe(false);
    cleanup(world.root);
  });

  test("a link into another kit's workflow/identity/gh is repointed to this kit's shim", { skip: skipWithoutFileLink() }, () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync(path.join(world.root, 'other-kit', 'workflow', 'identity', 'gh'), shimLink(world));
    const res = machineLinks(world);
    const target = path.join(fs.realpathSync(WORKFLOW_DIR), 'identity', 'gh');
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(fs.realpathSync(shimLink(world)), `the link names this kit's shim, got: ${res.said}`).toBe(fs.realpathSync(target));
    expect(lines(res.out).includes(`✓ gh shim: repointed ${gitPath(shimLink(world))} → ${gitPath(target)}`),
      `and says so, got: ${res.said}`).toBe(true);
    cleanup(world.root);
  });
});
