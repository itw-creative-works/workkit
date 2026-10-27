// Tests for workflow/publish.sh: a partial write, its own sync code, and the
// publish aborting before it commits the half-copied tree.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, write, mkSyncWorld, sync, mkPublishWorld, publish } = require('./helpers');

const cases = async () => {
  group('workflow/publish: a partial write');

  await test('a partial write is its own failure, and the publish aborts before committing it', () => {
    // Library layer: a dest path the copy cannot write (the clone holds a file
    // where the app now has a directory) must come back as its own code, not
    // as the "nothing to sync from" skip.
    const world = mkSyncWorld();
    sync(world);
    fs.rmSync(path.join(world.app, 'targets', 'web', 'src', 'index.html'));
    write(path.join(world.app, 'targets', 'web', 'src', 'index.html', 'a.txt'), 'now a dir\n');
    const { rc, out, err } = sync(world);
    assertEq(rc, 3, `a partial write is rc=3, distinct from the skip: ${out}${err}`);
    cleanup(world.root);

    // Wiring layer: publish stops on it, and the half-copied tree is never
    // committed to the home repo's default branch.
    const pworld = mkPublishWorld();
    publish(pworld);
    const mainBefore = spawnSync('git', ['ls-remote', pworld.bare, 'main'], { encoding: 'utf8' }).stdout;
    fs.rmSync(path.join(pworld.app, 'targets', 'web', 'src', 'index.html'));
    write(path.join(pworld.app, 'targets', 'web', 'src', 'index.html', 'a.txt'), 'now a dir\n');
    const aborted = publish(pworld);
    assert(aborted.code !== 0, `the publish aborts on a part-refreshed clone, got exit ${aborted.code}`);
    const mainAfter = spawnSync('git', ['ls-remote', pworld.bare, 'main'], { encoding: 'utf8' }).stdout;
    assertEq(mainAfter, mainBefore, 'and the partial tree was never committed');
    cleanup(pworld.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
