// Tests for workflow/home.sh: the tower sync, asked as the library function it is
// against fixture directories and a clone of a local bare "GitHub", and the
// version stamp that keeps it from downgrading a clone a newer kit wrote.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { shellPath } = require('../../lib/platform');
const {
  REPO_ROOT, cleanup, git, write, mkSyncWorld, commitCheckout, inHome, sync, mtimes,
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
    // raw source differs by construction (the seed repoints its `file:` specs),
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
    assert(!/Local era/.test(root.description), `and the description gains no Local era note, got: ${root.description}`);
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

  // The sync writes the checkout's app over the clone's, so two machines seeding
  // one clone race; the stamp at the clone's root says which kit wrote what is there.

  /** Where the stamp lives and what it is called: the name is the contract. */
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
    assert(said.includes(`this kit is ${kitVersion()}`), `and what this kit is: ${said}`);
    assert(/not downgrading/.test(said), `and what it refused to do: ${said}`);
    assert(/workkit update/.test(said), `with the command that fixes it: ${said}`);
    assertEq(JSON.stringify(mtimes(world.clone)), JSON.stringify(before), 'and wrote nothing at all');
    cleanup(world.root);
  });

  group('workflow/home: a checkout in a git repo copies its committed tree');

  // A missing file reads as null, so its assertEq names what was expected.
  const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const porcelain = (checkout) => git(checkout, 'status', '--porcelain').stdout;

  await test('an uncommitted edit never reaches the clone, and the checkout is left as it was', () => {
    const world = mkSyncWorld();
    const checkout = commitCheckout(world);
    write(path.join(world.app, 'README.md'), '# an uncommitted edit\n');
    const before = porcelain(checkout);
    assertEq(before, ' M tower/app/README.md\n', 'the fixture checkout is dirty in one tracked file');

    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed: ${out}${err}`);
    assertEq(read(path.join(world.clone, 'README.md')), '# the tower\n', 'the clone holds the committed bytes');
    assertEq(porcelain(checkout), ' M tower/app/README.md\n', 'the checkout status is unchanged by the run');
    cleanup(world.root);
  });

  await test('a tracked file deleted on disk still reaches the clone, and no later run retires it', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    fs.rmSync(path.join(world.app, 'targets', 'web', 'src', 'pages', 'board.js'));
    const page = path.join(world.clone, 'targets', 'web', 'src', 'pages', 'board.js');

    const first = sync(world);
    assertEq(first.rc, 0, `something changed: ${first.out}${first.err}`);
    assertEq(read(page), 'export default 1;\n', 'the clone received the committed page');
    const second = sync(world);
    assertEq(read(page), 'export default 1;\n',
      `and the second run kept it: ${second.out}${second.err}`);
    cleanup(world.root);
  });

  await test('an untracked file on disk is never copied', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    write(path.join(world.app, 'targets', 'web', 'src', 'pages', 'draft.js'), 'export default 2;\n');
    write(path.join(world.app, 'NOTES.md'), 'a scratch note\n');

    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed: ${out}${err}`);
    assert(fs.existsSync(path.join(world.clone, 'README.md')), 'the committed app travelled');
    assert(!fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'draft.js')),
      'the untracked page never reached the clone');
    assert(!fs.existsSync(path.join(world.clone, 'NOTES.md')), 'nor the untracked note at the app root');
    cleanup(world.root);
  });

  await test('the seed from a dirty checkout writes the committed bytes', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    write(path.join(world.app, 'README.md'), '# an uncommitted edit\n');
    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>an uncommitted board</html>\n');

    const { code, out, err } = inHome(world, 'wk_home_seed');
    assertEq(code, 0, `the seed ran: ${out}${err}`);
    assertEq(read(path.join(world.clone, 'README.md')), '# the tower\n', 'the seeded readme is the committed one');
    assertEq(read(path.join(world.clone, 'targets', 'web', 'src', 'index.html')), '<html>the board</html>\n',
      'and so is the seeded page');
    cleanup(world.root);
  });

  await test('a manifest file: spec lands absolute under the checkout’s real path', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed: ${out}${err}`);
    const packages = fs.realpathSync(path.join(world.root, 'omega', 'packages'));
    const rootText = read(path.join(world.clone, 'package.json'));
    const webText = read(path.join(world.clone, 'targets', 'web', 'package.json'));
    assert(rootText !== null && webText !== null, 'both manifests reached the clone');
    const root = JSON.parse(rootText);
    const web = JSON.parse(webText);
    assertEq(root.devDependencies['@omega.js/manager'], `file:${shellPath(path.join(packages, 'manager'))}`,
      'the root spec resolves from the checkout, not a scratch copy');
    assertEq(web.dependencies['@omega.js/web'], `file:${shellPath(path.join(packages, 'web'))}`,
      'and so does the nested one');
    cleanup(world.root);
  });

  await test('a second run on an unchanged git-backed checkout is already current', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    const first = sync(world);
    assertEq(first.rc, 0, `the first run synced: ${first.out}${first.err}`);
    assertEq(read(path.join(world.clone, 'README.md')), '# the tower\n', 'the first run carried the app');
    const { rc, out, err } = sync(world);
    assertEq(rc, 2, `nothing to do: ${out}${err}`);
    assert(/already current/.test(out + err), `and it says so, got: ${out}${err}`);
    cleanup(world.root);
  });

  // The seed's rc, printed rather than ending the run, the way sync() reads the sync's.
  const seedRc = (world) => {
    const res = inHome(world, 'rc=0; wk_home_seed || rc=$?; printf "rc=%s\\n" "$rc"');
    const rc = /rc=(\d+)/.exec(res.out + res.err);
    return { ...res, rc: rc ? Number(rc[1]) : null };
  };

  await test('an app folder no repo tracks, though it sits inside one, is copied as it sits on disk', () => {
    for (const copy of ['sync', 'seed']) {
      const world = mkSyncWorld();
      commitCheckout(world, { app: false });
      write(path.join(world.app, 'README.md'), '# an edit no repo tracks\n');
      const { rc, out, err } = copy === 'sync' ? sync(world) : seedRc(world);
      assertEq(rc, 0, `the ${copy} ran: ${out}${err}`);
      assertEq(read(path.join(world.clone, 'README.md')), '# an edit no repo tracks\n',
        `the ${copy} carried the folder's readme, edit included`);
      assertEq(read(path.join(world.clone, 'config', 'omega.json5')), '{ brand: { id: "workkit" } }\n',
        `and the ${copy} carried the config`);
      cleanup(world.root);
    }
  });

  await test('an app the repo tracks but HEAD lacks is a loud stop, for the sync and the seed', () => {
    const world = mkSyncWorld();
    const checkout = commitCheckout(world, { app: false });
    git(checkout, 'add', 'tower/app');
    const { rc, out, err } = sync(world);
    assertEq(rc, 1, `the caller can tell it did not run: ${out}${err}`);
    assert((out + err).includes('could not export the committed'), `it names the failure, got: ${out}${err}`);
    assertEq(read(path.join(world.clone, 'README.md')), null, 'the clone received no readme');
    assertEq(read(path.join(world.clone, 'config', 'omega.json5')), null, 'nor the config');

    const seed = seedRc(world);
    assertEq(seed.rc, 1, `the seed stops too: ${seed.out}${seed.err}`);
    assertEq(read(path.join(world.clone, 'README.md')), null, 'and the clone stays empty of the readme');
    assertEq(read(path.join(world.clone, 'config', 'omega.json5')), null, 'and of the config');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
