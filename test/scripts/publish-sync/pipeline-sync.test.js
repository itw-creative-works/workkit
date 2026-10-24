// Tests for workflow/publish.sh: the sync ahead of the build (the published page
// is the app’s, an npm-pinned tree keeps its manifests, the refresh is committed),
// end to end with an `npm` shim and a stub `omega`. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, mkPublishWorld, publish, fromPages } = require('./helpers');

const run = async () => {
  group('workflow/publish: the sync ahead of the build');

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

  await test('an npm-pinned tree syncs with its manifests untouched and builds', () => {
    const world = mkPublishWorld({ registryPin: '0.54.1' });
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0: ${out}${err}`);
    const main = path.join(world.root, 'main-check');
    spawnSync('git', ['clone', '-q', world.bare, main], { encoding: 'utf8' });
    const touched = spawnSync('git', ['-C', main, 'log', '--format=%s', '--', 'package.json', 'targets/web/package.json'],
      { encoding: 'utf8' }).stdout.trim();
    assertEq(touched, 'chore(home): seed the tower project', 'no commit past the seed touched a manifest');
    assertEq(JSON.parse(fs.readFileSync(path.join(main, 'package.json'), 'utf8')).devDependencies['@omega.js/manager'],
      '0.54.1', 'the root pin is the npm version');
    const pages = fromPages(world);
    assert(pages, `and the build ran and published, got: ${out}${err}`);
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>the current board</html>\n',
      'from the synced app');
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
