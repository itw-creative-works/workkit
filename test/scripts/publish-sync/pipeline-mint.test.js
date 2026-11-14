// Tests for workflow/publish.sh: the mint after any change (at the brand root,
// on a clone never minted, and a failed or empty mint aborting the build until a
// mint succeeds), end to end with an `npm` shim and a stub `omega`.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, writeStub, mkPublishWorld, publish, fromPages } = require('./helpers');

describe('workflow/publish: the mint after any change', () => {
  test('a sync that changed something mints the brand assets, at the brand root', () => {
    const world = mkPublishWorld();
    publish(world);
    const mints = world.mints();
    expect(mints.length, `one mint: ${mints.join(' | ')}`).toBe(1);
    expect(mints[0], 'the assets service, run at the clone’s brand root').toBe(`${shellPath(world.tower)}|manage --service=assets`);
    cleanup(world.root);
  });

  test('a clone that has never minted mints even when the sync changed nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // Everything is current now, and the first run left the minted tree.
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    expect(world.mints().length, 'the second run has nothing to mint for').toBe(1);

    fs.rmSync(path.join(world.tower, '.omega'), { recursive: true, force: true });
    publish(world);
    expect(world.mints().length, 'a clone with no minted assets mints anyway: the tags reference them').toBe(2);
    cleanup(world.root);
  });

  test('a mint that fails aborts the publish before the build, and says why', () => {
    const world = mkPublishWorld({ mintFails: true });
    const { code, out, err } = publish(world);
    expect(code !== 0, `the caller can tell a failure from a skip: ${out}${err}`).toBeTruthy();
    expect(/mint/.test(out + err), `it names the step, got: ${out}${err}`).toBeTruthy();
    expect(/brandmark could not be read/.test(out + err), `and what the mint said, got: ${out}${err}`).toBeTruthy();
    expect(fs.existsSync(world.dist), 'nothing was built on top of it').toBe(false);
    expect(fromPages(world), 'and a stale site beats one with a broken logo').toBe(null);
    cleanup(world.root);
  });

  test('a mint that exits 0 and leaves no logo aborts the publish before the build, marked failed', () => {
    const world = mkPublishWorld();
    const mintLog = path.join(world.root, 'mint.log');
    writeStub(path.join(world.tower, 'node_modules', '.bin', 'omega'), [
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
      'exit 0',
    ]);
    const { code, out, err } = publish(world);
    expect(code !== 0, `a mint that minted nothing is a failure: ${out}${err}`).toBeTruthy();
    expect(world.mints().length, 'the mint ran').toBe(1);
    expect(world.npms().filter((call) => /run build/.test(call)).length, 'and the build never did').toBe(0);
    expect(fs.existsSync(world.dist), 'so nothing was built').toBe(false);
    expect(fromPages(world), 'nor published').toBe(null);
    expect(fs.existsSync(path.join(world.tower, '.omega', '.mint-failed')),
      'and the failed-mint marker is set, so the next run mints again').toBeTruthy();
    cleanup(world.root);
  });

  test('a failed mint stays failed: the next run aborts too, until a mint succeeds', () => {
    // A clone that minted fine before (the dir exists), then a sync that breaks
    // the mint: run 2's sync is current and the dir exists, so only the sticky
    // marker keeps the abort until a mint goes green.
    const world = mkPublishWorld({ mintFails: true, minted: true });
    const first = publish(world);
    expect(first.code !== 0, 'run 1 aborts on the failing mint').toBeTruthy();

    const second = publish(world);
    expect(second.code !== 0, `run 2 aborts too: the failure is sticky, got exit ${second.code}`).toBeTruthy();
    expect(fromPages(world), 'and nothing was published over it').toBe(null);

    const mintLog = path.join(world.root, 'mint.log');
    writeStub(path.join(world.tower, 'node_modules', '.bin', 'omega'), [
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
      'mkdir -p "$PWD/.omega/assets/logo/brandmark"',
      'exit 0',
    ]);
    const third = publish(world);
    expect(third.code, `a repaired mint publishes again: ${third.out}${third.err}`).toBe(0);
    expect(!fs.existsSync(path.join(world.tower, '.omega', '.mint-failed')),
      'and the green mint cleared the marker').toBeTruthy();
    cleanup(world.root);
  });
});
