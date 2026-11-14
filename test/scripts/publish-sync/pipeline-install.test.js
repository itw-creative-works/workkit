// Tests for workflow/publish.sh: the install after a manifest change (once per
// moved manifest, never for a page, retried after a failure that aborts the
// build), end to end with an `npm` shim and a stub `omega`. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const { cleanup, writeJson, write, mkPublishWorld, publish, fromPages } = require('./helpers');

describe('workflow/publish: the install after a manifest change', () => {
  test('a sync that changed a manifest installs the clone’s dependencies', () => {
    // The sync brings the new package.json; without an install, the build that
    // follows resolves against the tree the last install left.
    const world = mkPublishWorld();
    publish(world);
    const before = world.npms().filter((call) => /install/.test(call)).length;

    writeJson(path.join(world.app, 'targets', 'web', 'package.json'), {
      name: 'workkit-tower-web', private: true, dependencies: { 'chart.js': '^4.0.0' },
    });
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const installs = world.npms().filter((call) => /install/.test(call));
    expect(installs.length, `one install for the manifest that moved: ${installs.join(' | ')}`).toBe(before + 1);
    expect(installs[installs.length - 1], 'in the clone, which is the project the build runs out of').toBe(`${shellPath(world.tower)}|install`);
    cleanup(world.root);
  });

  test('a sync that changed only a page installs nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // The seeded clone's root manifest carries no `file:` transform yet, so the
    // first sync composes one and that run does install, which is what makes
    // the second run's silence mean something.
    const before = world.npms().filter((call) => /install/.test(call)).length;
    expect(before, 'the first publish’s sync did write a manifest').toBe(1);

    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    expect(world.npms().filter((call) => /install/.test(call)).length, 'the ordinary morning does not reinstall the dependencies to publish a page').toBe(before);
    const pages = fromPages(world);
    expect(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), 'and the page still published').toBe('<html>a newer board</html>\n');
    cleanup(world.root);
  });

  test('a manifest committed while the site was off is installed once the switch turns on', () => {
    // The sync sits above the switch, so a switch-off run still writes and
    // commits the refreshed manifests, and ends before the install. The flag
    // dies with that process; the stamp comparison is what remembers.
    const world = mkPublishWorld();
    const settings = path.join(world.root, 'workflow-home', 'settings.json');
    const current = JSON.parse(fs.readFileSync(settings, 'utf8'));
    writeJson(settings, { ...current, site: { ...current.site, publish: false } });
    publish(world);
    expect(world.npms().filter((call) => /install/.test(call)).length, 'the switch-off run synced but never reached the install').toBe(0);

    writeJson(settings, { ...current, site: { ...current.site, publish: true } });
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    expect(world.npms().filter((call) => /install/.test(call)).length, 'the first switched-on run installs the manifests the off run left newer than the stamp').toBe(1);
    cleanup(world.root);
  });

  test('a failed install is retried the next run, not skipped past', () => {
    // No sticky marker like the mint's: the failed install left no stamp, so
    // the manifests stay newer than the installed tree and the comparison
    // keeps asking until an install succeeds.
    const world = mkPublishWorld({ installFails: true });
    publish(world);
    const second = publish(world);
    expect(second.code !== 0, `run 2 aborts too: the install is asked again, got exit ${second.code}`).toBeTruthy();
    expect(world.npms().filter((call) => /install/.test(call)).length, 'one attempt per run, not one ever').toBe(2);
    expect(fromPages(world), 'and nothing published over the failure').toBe(null);
    cleanup(world.root);
  });

  test('an install that fails aborts the publish before the build, and says why', () => {
    // The clone's manifests are the seed's, so the first sync composes them and
    // the install is the next step, which cannot finish here.
    const world = mkPublishWorld({ installFails: true });
    const { code, out, err } = publish(world);
    expect(code !== 0, `the caller can tell a failure from a skip: ${out}${err}`).toBeTruthy();
    expect(/install/.test(out + err), `it names the step, got: ${out}${err}`).toBeTruthy();
    expect(/ERESOLVE/.test(out + err), `and what npm said, got: ${out}${err}`).toBeTruthy();
    expect(fs.existsSync(world.dist), 'nothing was built on a half-installed tree').toBe(false);
    expect(fromPages(world), 'and nothing was published').toBe(null);
    cleanup(world.root);
  });
});
