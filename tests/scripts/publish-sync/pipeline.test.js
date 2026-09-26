//
// Tests for workflow/publish.sh: the wiring (the sync ahead of the build, the
// install after a sync that changed a manifest (issue #130), the mint after a
// sync that changed something, the abort on a mint, an install or a write that
// failed), proved end to end with an `npm` shim for the build and a stub
// `omega` for the mint. No omega, no network.
// The shared prologue (the fixture app, the sync and publish worlds, the library and publish runners, the file writers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  cleanup, writeJson, write, writeStub, mkSyncWorld, sync, mkPublishWorld, publish, fromPages,
} = require('./helpers');

const run = async () => {
  group('workflow/publish: the sync, then the install, then the mint, then the build');

  await test('the clone is refreshed before it is built: the published page is the app’s', () => {
    const world = mkPublishWorld();
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const pages = fromPages(world);
    assert(pages, 'the site published');
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>the current board</html>\n',
      'what Pages serves is what the checkout ships, not what the seed left');
    assert(/sync/.test(out), `and the run says it synced, got: ${out}`);
    cleanup(world.root);
  });

  await test('the refreshed project is committed to the home repo’s default branch', () => {
    const world = mkPublishWorld();
    publish(world);
    const main = path.join(world.root, 'main-check');
    spawnSync('git', ['clone', '-q', world.bare, main], { encoding: 'utf8' });
    assertEq(fs.readFileSync(path.join(main, 'targets', 'web', 'src', 'index.html'), 'utf8'),
      '<html>the current board</html>\n', 'main carries the project it just built');
    cleanup(world.root);
  });

  await test('a sync that changed a manifest installs the clone’s dependencies', () => {
    // The lag issue #130 closes: the sync brings the new package.json and
    // nothing installs it, so the build that follows resolves against the tree
    // the last install left.
    const world = mkPublishWorld();
    publish(world);
    const before = world.npms().filter((call) => /install/.test(call)).length;

    writeJson(path.join(world.app, 'targets', 'web', 'package.json'), {
      name: 'workkit-tower-web', private: true, dependencies: { 'chart.js': '^4.0.0' },
    });
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const installs = world.npms().filter((call) => /install/.test(call));
    assertEq(installs.length, before + 1, `one install for the manifest that moved: ${installs.join(' | ')}`);
    assertEq(installs[installs.length - 1], `${shellPath(world.tower)}|install`,
      'in the clone, which is the project the build runs out of');
    cleanup(world.root);
  });

  await test('the install is keyed from the clone’s real path, symlinked ~/.workkit or not', () => {
    // Issue #166: `~/.workkit` is a symlink on the machine that publishes, and
    // `npm --prefix <link>/tower install` resolved the project through the link
    // while keying the tree from the CALLER'S cwd: the lockfile took package
    // paths outside the project root, the workspace went extraneous, and the
    // next run crashed arborist. An install run from inside the resolved path
    // is the whole fix, so the cwd is what this pins.
    const world = mkPublishWorld();
    const link = path.join(world.root, 'linked-workkit');
    fs.symlinkSync(path.join(world.root, 'workflow-home'), link);
    world.env.WORKFLOW_HOME = link;

    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const installs = world.npms().filter((call) => /install/.test(call));
    assertEq(installs.length, 1, `the seeded clone’s manifests are installed once: ${installs.join(' | ')}`);
    assertEq(installs[0], `${shellPath(world.tower)}|install`,
      'the cwd is the clone with its links resolved, and no --prefix keys the tree from elsewhere');
    cleanup(world.root);
  });

  await test('a sync that changed only a page installs nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // The seeded clone's root manifest carries no `file:` transform yet, so the
    // first sync composes one and that run does install, which is what makes
    // the second run's silence mean something.
    const before = world.npms().filter((call) => /install/.test(call)).length;
    assertEq(before, 1, 'the first publish’s sync did write a manifest');

    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, before,
      'the ordinary morning does not reinstall the dependencies to publish a page');
    const pages = fromPages(world);
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>a newer board</html>\n',
      'and the page still published');
    cleanup(world.root);
  });

  await test('a manifest committed while the site was off is installed once the switch turns on', () => {
    // The sync sits above the switch, so a switch-off run still writes and
    // commits the refreshed manifests, and ends before the install. The flag
    // dies with that process; the stamp comparison is what remembers.
    const world = mkPublishWorld();
    const settings = path.join(world.root, 'workflow-home', 'settings.json');
    const current = JSON.parse(fs.readFileSync(settings, 'utf8'));
    writeJson(settings, { ...current, site: { ...current.site, publish: false } });
    publish(world);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, 0,
      'the switch-off run synced but never reached the install');

    writeJson(settings, { ...current, site: { ...current.site, publish: true } });
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, 1,
      'the first switched-on run installs the manifests the off run left newer than the stamp');
    cleanup(world.root);
  });

  await test('a failed install is retried the next run, not skipped past', () => {
    // No sticky marker like the mint's: the failed install left no stamp, so
    // the manifests stay newer than the installed tree and the comparison
    // keeps asking until an install succeeds.
    const world = mkPublishWorld({ installFails: true });
    publish(world);
    const second = publish(world);
    assert(second.code !== 0, `run 2 aborts too: the install is asked again, got exit ${second.code}`);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, 2,
      'one attempt per run, not one ever');
    assertEq(fromPages(world), null, 'and nothing published over the failure');
    cleanup(world.root);
  });

  await test('an install that fails aborts the publish before the build, and says why', () => {
    // The clone's manifests are the seed's, so the first sync composes them and
    // the install is the next step, which cannot finish here.
    const world = mkPublishWorld({ installFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, `the caller can tell a failure from a skip: ${out}${err}`);
    assert(/install/.test(out + err), `it names the step, got: ${out}${err}`);
    assert(/ERESOLVE/.test(out + err), `and what npm said, got: ${out}${err}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was built on a half-installed tree');
    assertEq(fromPages(world), null, 'and nothing was published');
    cleanup(world.root);
  });

  await test('a sync that changed something mints the brand assets, at the brand root', () => {
    const world = mkPublishWorld();
    publish(world);
    const mints = world.mints();
    assertEq(mints.length, 1, `one mint: ${mints.join(' | ')}`);
    assertEq(mints[0], `${shellPath(world.tower)}|--service=assets`, 'the assets service, run at the clone’s brand root');
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

  await test('a failed mint stays failed: the next run aborts too, until a mint succeeds', () => {
    // The dangerous shape: a clone that minted fine in the past (the dir
    // exists), then a sync brings the change that breaks the mint. Run 1
    // aborts on the mint; run 2's sync is current and the dir exists, so
    // without a sticky marker nothing would mint and the failure would
    // publish. The marker is what keeps the abort until a mint goes green.
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

  await test('a partial write is its own failure, and the publish aborts before committing it', () => {
    // Library layer: a dest path the copy cannot write (the clone holds a FILE
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

module.exports = run;

if (require.main === module) selfRun(run);
