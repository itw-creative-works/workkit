// Tests for workflow/publish.sh: the mint after any change (at the brand root,
// on a clone never minted, and a failed or empty mint aborting the build until a
// mint succeeds), end to end with an `npm` shim and a stub `omega`.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, writeStub, mkPublishWorld, publish, fromPages } = require('./helpers');

const run = async () => {
  group('workflow/publish: the mint after any change');

  await test('a sync that changed something mints the brand assets, at the brand root', () => {
    const world = mkPublishWorld();
    publish(world);
    const mints = world.mints();
    assertEq(mints.length, 1, `one mint: ${mints.join(' | ')}`);
    assertEq(mints[0], `${shellPath(world.tower)}|manage --service=assets`, 'the assets service, run at the clone’s brand root');
    cleanup(world.root);
  });

  await test('a clone that has never minted mints even when the sync changed nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // Everything is current now, and the first run left the minted tree.
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(world.mints().length, 1, 'the second run has nothing to mint for');

    fs.rmSync(path.join(world.tower, '.omega'), { recursive: true, force: true });
    publish(world);
    assertEq(world.mints().length, 2, 'a clone with no minted assets mints anyway: the tags reference them');
    cleanup(world.root);
  });

  await test('a mint that fails aborts the publish before the build, and says why', () => {
    const world = mkPublishWorld({ mintFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, `the caller can tell a failure from a skip: ${out}${err}`);
    assert(/mint/.test(out + err), `it names the step, got: ${out}${err}`);
    assert(/brandmark could not be read/.test(out + err), `and what the mint said, got: ${out}${err}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was built on top of it');
    assertEq(fromPages(world), null, 'and a stale site beats one with a broken logo');
    cleanup(world.root);
  });

  await test('a mint that exits 0 and leaves no logo aborts the publish before the build, marked failed', () => {
    const world = mkPublishWorld();
    const mintLog = path.join(world.root, 'mint.log');
    writeStub(path.join(world.tower, 'node_modules', '.bin', 'omega'), [
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
      'exit 0',
    ]);
    const { code, out, err } = publish(world);
    assert(code !== 0, `a mint that minted nothing is a failure: ${out}${err}`);
    assertEq(world.mints().length, 1, 'the mint ran');
    assertEq(world.npms().filter((call) => /run build/.test(call)).length, 0, 'and the build never did');
    assertEq(fs.existsSync(world.dist), false, 'so nothing was built');
    assertEq(fromPages(world), null, 'nor published');
    assert(fs.existsSync(path.join(world.tower, '.omega', '.mint-failed')),
      'and the failed-mint marker is set, so the next run mints again');
    cleanup(world.root);
  });

  await test('a failed mint stays failed: the next run aborts too, until a mint succeeds', () => {
    // A clone that minted fine before (the dir exists), then a sync that breaks
    // the mint: run 2's sync is current and the dir exists, so only the sticky
    // marker keeps the abort until a mint goes green.
    const world = mkPublishWorld({ mintFails: true, minted: true });
    const first = publish(world);
    assert(first.code !== 0, 'run 1 aborts on the failing mint');

    const second = publish(world);
    assert(second.code !== 0, `run 2 aborts too: the failure is sticky, got exit ${second.code}`);
    assertEq(fromPages(world), null, 'and nothing was published over it');

    const mintLog = path.join(world.root, 'mint.log');
    writeStub(path.join(world.tower, 'node_modules', '.bin', 'omega'), [
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
      'mkdir -p "$PWD/.omega/assets/logo/brandmark"',
      'exit 0',
    ]);
    const third = publish(world);
    assertEq(third.code, 0, `a repaired mint publishes again: ${third.out}${third.err}`);
    assert(!fs.existsSync(path.join(world.tower, '.omega', '.mint-failed')),
      'and the green mint cleared the marker');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
