//
// Tests for workflow/home.sh: the tower sync (issue #129), asked its questions
// as the library function it is, against fixture directories and a clone of a
// local bare "GitHub", and the version stamp that keeps it from downgrading a
// clone a newer kit wrote (issue #200).
// The shared prologue (the fixture app, the sync and publish worlds, the library and publish runners, the file writers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  REPO_ROOT, cleanup, write, mkSyncWorld, inHome, sync, mtimes,
} = require('./helpers');

const run = async () => {
  group('workflow/home: the tower sync');

  await test('a clone that carries nothing gets the project, and none of the accretions', () => {
    const world = mkSyncWorld();
    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed: ${out}${err}`);
    assert(fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html')), 'the app travelled');
    assert(fs.existsSync(path.join(world.clone, 'config', 'omega.json5')), 'and its config');
    assert(fs.existsSync(path.join(world.clone, 'assets', 'logo', 'brandmark.svg')), 'and the authored mark');
    assert(fs.existsSync(path.join(world.clone, '.env.example')), 'and the example env, which is not a secret');

    for (const gone of [
      'node_modules/.bin/omega', 'targets/web/node_modules/x.js', 'package-lock.json',
      '.omega/runs/one.json', 'targets/web/dist/index.html', '.env', '.env.production',
      '.cache/one.json', '.temp/scratch.txt', '.DS_Store',
    ]) {
      assert(!fs.existsSync(path.join(world.clone, gone)), `${gone} is never copied`);
    }
    cleanup(world.root);
  });

  await test('a freshly seeded clone is already current: the seed and the sync agree', () => {
    const world = mkSyncWorld();
    inHome(world, 'wk_home_seed');
    const { rc, out, err } = sync(world);
    assertEq(rc, 2, `nothing to do: ${out}${err}`);
    assert(/already current/.test(out + err), `and it says so, got: ${out}${err}`);
    cleanup(world.root);
  });

  await test('a changed file is copied and an identical one is left exactly as it was', () => {
    const world = mkSyncWorld();
    sync(world);
    const before = mtimes(world.clone);
    // Every file backdated, so anything the second run rewrites is obvious.
    for (const rel of Object.keys(before)) {
      fs.utimesSync(path.join(world.clone, rel), new Date(1e12), new Date(1e12));
    }
    const backdated = mtimes(world.clone);

    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `the change is a change: ${out}${err}`);
    assertEq(fs.readFileSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html'), 'utf8'),
      '<html>a newer board</html>\n', 'the edited file landed');

    const after = mtimes(world.clone);
    const rewritten = Object.keys(after).filter((rel) => after[rel] !== backdated[rel]);
    assertEq(rewritten.map(shellPath).join(','), 'targets/web/src/index.html',
      `and nothing else was written at all: ${rewritten.join(', ')}`);
    cleanup(world.root);
  });

  await test('a second run writes nothing: the manifests included', () => {
    // The trap the content compare has to avoid: a manifest compared against the
    // RAW source differs by construction (the seed repoints its `file:` specs),
    // so a sync that compared it that way would rewrite it forever.
    const world = mkSyncWorld();
    sync(world);
    for (const rel of Object.keys(mtimes(world.clone))) {
      fs.utimesSync(path.join(world.clone, rel), new Date(1e12), new Date(1e12));
    }
    const before = mtimes(world.clone);

    const { rc, out, err } = sync(world);
    assertEq(rc, 2, `already current: ${out}${err}`);
    const after = mtimes(world.clone);
    assertEq(Object.keys(after).filter((rel) => after[rel] !== before[rel]).join(','), '',
      'not one file was rewritten');
    cleanup(world.root);
  });

  await test('the manifests arrive with the seed’s transform, not the checkout’s relative specs', () => {
    const world = mkSyncWorld();
    sync(world);
    const root = JSON.parse(fs.readFileSync(path.join(world.clone, 'package.json'), 'utf8'));
    const web = JSON.parse(fs.readFileSync(path.join(world.clone, 'targets', 'web', 'package.json'), 'utf8'));
    assert(root.devDependencies['@omega.js/manager'].startsWith('file:/'),
      `an absolute path, got: ${root.devDependencies['@omega.js/manager']}`);
    assert(web.dependencies['@omega.js/web'].startsWith('file:/'),
      `at every level, got: ${web.dependencies['@omega.js/web']}`);
    assert(/Local era/.test(root.description), `and the note that says why, got: ${root.description}`);
    assertEq(root.description.match(/Local era/g).length, 1, 'said once, however many runs there have been');
    cleanup(world.root);
  });

  await test('a file the app retired goes; the clone’s own files at the root stay', () => {
    const world = mkSyncWorld();
    sync(world);
    // A page an older app shipped, inside a folder the app owns.
    write(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'retired.js'), 'export default 0;\n');
    // Everything else in the clone belongs to another step entirely.
    write(path.join(world.clone, 'brief', 'jobs', 'morning.sh'), '#!/bin/sh\n');
    write(path.join(world.clone, '.github', 'workflows', 'brief.yml'), 'name: brief\n');
    write(path.join(world.clone, 'data', 'repos.json'), '{"repos":[]}\n');

    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `the removal is a change: ${out}${err}`);
    assert(!fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'retired.js')),
      'the retired page is gone');
    assert(fs.existsSync(path.join(world.clone, 'brief', 'jobs', 'morning.sh')), 'the runner is not the sync’s');
    assert(fs.existsSync(path.join(world.clone, '.github', 'workflows', 'brief.yml')), 'nor the workflow');
    assert(fs.existsSync(path.join(world.clone, 'data', 'repos.json')), 'nor the roster');
    cleanup(world.root);
  });

  await test('a checkout with no tower/app is a named skip, and the clone is untouched', () => {
    const world = mkSyncWorld();
    sync(world);
    const before = mtimes(world.clone);
    const { rc, out, err } = sync(world, { env: { WORKKIT_TOWER_APP: path.join(world.root, 'nowhere') } });
    assertEq(rc, 1, `the caller can tell it did not run: ${out}${err}`);
    assert(/tower app/.test(out + err), `it names what is missing, got: ${out}${err}`);
    assertEq(JSON.stringify(mtimes(world.clone)), JSON.stringify(before), 'and wrote nothing');
    cleanup(world.root);
  });

  // Issue #200: the sync writes the checkout's app over the clone's, so two
  // machines seeding one clone race, and the loser was whichever ran last. The
  // stamp at the clone's root says which kit wrote what is there.

  /** Where the stamp lives and what it is called: the name IS the contract. */
  const STAMP = '.workkit-version';
  const kitVersion = () => JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
  ).version;

  await test('the sync stamps the clone with the kit version it wrote from', () => {
    const world = mkSyncWorld();
    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed: ${out}${err}`);
    assertEq(fs.readFileSync(path.join(world.clone, STAMP), 'utf8').trim(), kitVersion(),
      'the version rides with the content it describes');
    cleanup(world.root);
  });

  await test('a clone stamped NEWER than this checkout is not synced at all', () => {
    const world = mkSyncWorld();
    sync(world);
    // What a newer machine's sync would have left: its app, and its stamp.
    write(path.join(world.clone, 'targets', 'web', 'src', 'index.html'), '<html>the newer board</html>\n');
    write(path.join(world.clone, STAMP), '99.0.0\n');
    const before = mtimes(world.clone);

    const { rc, out, err } = sync(world);
    const said = out + err;
    assertEq(rc, 1, `the caller can tell it did not run: ${said}`);
    assert(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`);
    assert(said.includes(`this checkout is ${kitVersion()}`), `and what this checkout is: ${said}`);
    assert(/not downgrading/.test(said), `and what it refused to do: ${said}`);
    assert(/workkit update/.test(said), `with the command that fixes it: ${said}`);
    assertEq(JSON.stringify(mtimes(world.clone)), JSON.stringify(before), 'and wrote nothing at all');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
