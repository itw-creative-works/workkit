// Tests for workflow/publish.sh: the sync ahead of the build (the published page
// is the app’s, an npm-pinned tree keeps its manifests, the refresh is committed),
// end to end with an `npm` shim and a stub `omega`. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, mkPublishWorld, publish, fromPages } = require('./helpers');

describe('workflow/publish: the sync ahead of the build', () => {
  test('the clone is refreshed before it is built: the published page is the app’s', () => {
    const world = mkPublishWorld();
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const pages = fromPages(world);
    expect(pages, 'the site published').toBeTruthy();
    expect(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), 'what Pages serves is what the checkout ships, not what the seed left').toBe('<html>the current board</html>\n');
    expect(/sync/.test(out), `and the run says it synced, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('an npm-pinned tree syncs with its manifests untouched and builds', () => {
    const world = mkPublishWorld({ registryPin: '0.54.1' });
    const { code, out, err } = publish(world);
    expect(code, `exit 0: ${out}${err}`).toBe(0);
    const main = path.join(world.root, 'main-check');
    spawnSync('git', ['clone', '-q', world.bare, main], { encoding: 'utf8' });
    const touched = spawnSync('git', ['-C', main, 'log', '--format=%s', '--', 'package.json', 'targets/web/package.json'],
      { encoding: 'utf8' }).stdout.trim();
    expect(touched, 'no commit past the seed touched a manifest').toBe('chore(home): seed the tower project');
    expect(JSON.parse(fs.readFileSync(path.join(main, 'package.json'), 'utf8')).devDependencies['@omega.js/manager'], 'the root pin is the npm version').toBe('0.54.1');
    const pages = fromPages(world);
    expect(pages, `and the build ran and published, got: ${out}${err}`).toBeTruthy();
    expect(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), 'from the synced app').toBe('<html>the current board</html>\n');
    cleanup(world.root);
  });

  test('the refreshed project is committed to the home repo’s default branch', () => {
    const world = mkPublishWorld();
    publish(world);
    const main = path.join(world.root, 'main-check');
    spawnSync('git', ['clone', '-q', world.bare, main], { encoding: 'utf8' });
    expect(fs.readFileSync(path.join(main, 'targets', 'web', 'src', 'index.html'), 'utf8'), 'main carries the project it just built').toBe('<html>the current board</html>\n');
    cleanup(world.root);
  });
});
