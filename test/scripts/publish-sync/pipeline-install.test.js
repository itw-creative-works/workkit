// Tests for workflow/publish.sh: the install after a manifest change (once per
// moved manifest, never for a page, retried after a failure that aborts the
// build), end to end with an `npm` shim and a stub `omega`. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, writeJson, write, mkPublishWorld, publish, fromPages } = require('./helpers');

const run = async () => {
  group('workflow/publish: the install after a manifest change');

  await test('a sync that changed a manifest installs the clone’s dependencies', () => {
    // The sync brings the new package.json; without an install, the build that
    // follows resolves against the tree the last install left.
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
