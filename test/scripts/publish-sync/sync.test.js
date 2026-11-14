// Tests for workflow/home.sh: the tower sync, asked as the library function it is
// against fixture directories and a clone of a local bare "GitHub", and the
// version stamp that keeps it from downgrading a clone a newer kit wrote.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { IS_WINDOWS, shellPath } = require('../../lib/platform');
const { STAMP, kitVersion } = require('../../lib/version-stamp');
const {
  cleanup, git, write, mkSyncWorld, commitCheckout, inHome, sync, mtimes,
} = require('./helpers');

// A missing file reads as null, so its expect names what was expected.
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

describe('workflow/home: the tower sync', () => {
  test('a clone that carries nothing gets the project, and none of the accretions', () => {
    const world = mkSyncWorld();
    const { rc, out, err } = sync(world);
    expect(rc, `something changed: ${out}${err}`).toBe(0);
    expect(fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html')), 'the app travelled').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, 'config', 'omega.json5')), 'and its config').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, 'assets', 'logo', 'brandmark.svg')), 'and the authored mark').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, '.env.example')), 'and the example env, which is not a secret').toBeTruthy();

    for (const gone of [
      'node_modules/.bin/omega', 'targets/web/node_modules/x.js', 'package-lock.json',
      '.omega/runs/one.json', 'targets/web/dist/index.html', '.env', '.env.production',
      '.cache/one.json', '.temp/scratch.txt', '.DS_Store',
    ]) {
      expect(!fs.existsSync(path.join(world.clone, gone)), `${gone} is never copied`).toBeTruthy();
    }
    cleanup(world.root);
  });

  test('a freshly seeded clone is already current: the seed and the sync agree', () => {
    const world = mkSyncWorld();
    inHome(world, 'wk_home_seed');
    const { rc, out, err } = sync(world);
    expect(rc, `nothing to do: ${out}${err}`).toBe(2);
    expect(/already current/.test(out + err), `and it says so, got: ${out}${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a changed file is copied and an identical one is left exactly as it was', () => {
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
    expect(rc, `the change is a change: ${out}${err}`).toBe(0);
    expect(fs.readFileSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html'), 'utf8'), 'the edited file landed').toBe('<html>a newer board</html>\n');

    const after = mtimes(world.clone);
    const rewritten = Object.keys(after).filter((rel) => after[rel] !== backdated[rel]);
    expect(rewritten.map(shellPath).join(','), `and nothing else was written at all: ${rewritten.join(', ')}`).toBe('targets/web/src/index.html');
    cleanup(world.root);
  });

  test('a file the app retired goes; the clone’s own files at the root stay', () => {
    const world = mkSyncWorld();
    sync(world);
    // A page an older app shipped, inside a folder the app owns.
    write(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'retired.js'), 'export default 0;\n');
    // Everything else in the clone belongs to another step entirely.
    write(path.join(world.clone, 'brief', 'jobs', 'morning.sh'), '#!/bin/sh\n');
    write(path.join(world.clone, '.github', 'workflows', 'brief.yml'), 'name: brief\n');
    write(path.join(world.clone, 'data', 'repos.json'), '{"repos":[]}\n');

    const { rc, out, err } = sync(world);
    expect(rc, `the removal is a change: ${out}${err}`).toBe(0);
    expect(!fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'retired.js')),
      'the retired page is gone').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, 'brief', 'jobs', 'morning.sh')), 'the runner is not the sync’s').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, '.github', 'workflows', 'brief.yml')), 'nor the workflow').toBeTruthy();
    expect(fs.existsSync(path.join(world.clone, 'data', 'repos.json')), 'nor the roster').toBeTruthy();
    cleanup(world.root);
  });

  test('a checkout with no tower/app is a named skip, and the clone is untouched', () => {
    const world = mkSyncWorld();
    sync(world);
    const before = mtimes(world.clone);
    const { rc, out, err } = sync(world, { env: { WORKKIT_TOWER_APP: path.join(world.root, 'nowhere') } });
    expect(rc, `the caller can tell it did not run: ${out}${err}`).toBe(1);
    expect(/tower app/.test(out + err), `it names what is missing, got: ${out}${err}`).toBeTruthy();
    expect(JSON.stringify(mtimes(world.clone)), 'and wrote nothing').toBe(JSON.stringify(before));
    cleanup(world.root);
  });

  // The sync writes the checkout's app over the clone's, so two machines seeding
  // one clone race; the stamp at the clone's root says which kit wrote what is there.

  test('a clone stamped NEWER than this checkout is not synced at all', () => {
    const world = mkSyncWorld();
    sync(world);
    // What a newer machine's sync would have left: its app, and its stamp.
    write(path.join(world.clone, 'targets', 'web', 'src', 'index.html'), '<html>the newer board</html>\n');
    write(path.join(world.clone, STAMP), '99.0.0\n');
    const before = mtimes(world.clone);

    const { rc, out, err } = sync(world);
    const said = out + err;
    expect(rc, `the caller can tell it did not run: ${said}`).toBe(1);
    expect(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`).toBeTruthy();
    expect(said.includes(`this kit is ${kitVersion()}`), `and what this kit is: ${said}`).toBeTruthy();
    expect(/not downgrading/.test(said), `and what it refused to do: ${said}`).toBeTruthy();
    expect(/workkit update/.test(said), `with the command that fixes it: ${said}`).toBeTruthy();
    expect(JSON.stringify(mtimes(world.clone)), 'and wrote nothing at all').toBe(JSON.stringify(before));
    cleanup(world.root);
  });
});

describe('workflow/home: a checkout in a git repo copies its committed tree', () => {
  const porcelain = (checkout) => git(checkout, 'status', '--porcelain').stdout;

  test('an uncommitted edit never reaches the clone, and the checkout is left as it was', () => {
    const world = mkSyncWorld();
    const checkout = commitCheckout(world);
    write(path.join(world.app, 'README.md'), '# an uncommitted edit\n');
    const before = porcelain(checkout);
    expect(before, 'the fixture checkout is dirty in one tracked file').toBe(' M tower/app/README.md\n');

    const { rc, out, err } = sync(world);
    expect(rc, `something changed: ${out}${err}`).toBe(0);
    expect(read(path.join(world.clone, 'README.md')), 'the clone holds the committed bytes').toBe('# the tower\n');
    expect(porcelain(checkout), 'the checkout status is unchanged by the run').toBe(' M tower/app/README.md\n');
    cleanup(world.root);
  });

  test('a tracked file deleted on disk still reaches the clone, and no later run retires it', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    fs.rmSync(path.join(world.app, 'targets', 'web', 'src', 'pages', 'board.js'));
    const page = path.join(world.clone, 'targets', 'web', 'src', 'pages', 'board.js');

    const first = sync(world);
    expect(first.rc, `something changed: ${first.out}${first.err}`).toBe(0);
    expect(read(page), 'the clone received the committed page').toBe('export default 1;\n');
    const second = sync(world);
    expect(read(page), `and the second run kept it: ${second.out}${second.err}`).toBe('export default 1;\n');
    cleanup(world.root);
  });

  test('an untracked file on disk is never copied', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    write(path.join(world.app, 'targets', 'web', 'src', 'pages', 'draft.js'), 'export default 2;\n');
    write(path.join(world.app, 'NOTES.md'), 'a scratch note\n');

    const { rc, out, err } = sync(world);
    expect(rc, `something changed: ${out}${err}`).toBe(0);
    expect(fs.existsSync(path.join(world.clone, 'README.md')), 'the committed app travelled').toBeTruthy();
    expect(!fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'pages', 'draft.js')),
      'the untracked page never reached the clone').toBeTruthy();
    expect(!fs.existsSync(path.join(world.clone, 'NOTES.md')), 'nor the untracked note at the app root').toBeTruthy();
    cleanup(world.root);
  });

  test('the seed from a dirty checkout writes the committed bytes', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    write(path.join(world.app, 'README.md'), '# an uncommitted edit\n');
    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>an uncommitted board</html>\n');

    const { code, out, err } = inHome(world, 'wk_home_seed');
    expect(code, `the seed ran: ${out}${err}`).toBe(0);
    expect(read(path.join(world.clone, 'README.md')), 'the seeded readme is the committed one').toBe('# the tower\n');
    expect(read(path.join(world.clone, 'targets', 'web', 'src', 'index.html')), 'and so is the seeded page').toBe('<html>the board</html>\n');
    cleanup(world.root);
  });

  test('a manifest file: spec lands absolute under the checkout’s real path', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    const { rc, out, err } = sync(world);
    expect(rc, `something changed: ${out}${err}`).toBe(0);
    const packages = fs.realpathSync(path.join(world.root, 'omega', 'packages'));
    const rootText = read(path.join(world.clone, 'package.json'));
    const webText = read(path.join(world.clone, 'targets', 'web', 'package.json'));
    expect(rootText !== null && webText !== null, 'both manifests reached the clone').toBeTruthy();
    const root = JSON.parse(rootText);
    const web = JSON.parse(webText);
    expect(root.devDependencies['@omega.js/manager'], 'the root spec resolves from the checkout, not a scratch copy').toBe(`file:${shellPath(path.join(packages, 'manager'))}`);
    expect(web.dependencies['@omega.js/web'], 'and so does the nested one').toBe(`file:${shellPath(path.join(packages, 'web'))}`);
    cleanup(world.root);
  });

  test('a second run on an unchanged git-backed checkout is already current', () => {
    const world = mkSyncWorld();
    commitCheckout(world);
    const first = sync(world);
    expect(first.rc, `the first run synced: ${first.out}${first.err}`).toBe(0);
    expect(read(path.join(world.clone, 'README.md')), 'the first run carried the app').toBe('# the tower\n');
    const { rc, out, err } = sync(world);
    expect(rc, `nothing to do: ${out}${err}`).toBe(2);
    expect(/already current/.test(out + err), `and it says so, got: ${out}${err}`).toBeTruthy();
    cleanup(world.root);
  });

  // The seed's rc, printed rather than ending the run, the way sync() reads the sync's.
  const seedRc = (world) => {
    const res = inHome(world, 'rc=0; wk_home_seed || rc=$?; printf "rc=%s\\n" "$rc"');
    const rc = /rc=(\d+)/.exec(res.out + res.err);
    return { ...res, rc: rc ? Number(rc[1]) : null };
  };

  test('an app folder no repo tracks, though it sits inside one, is copied as it sits on disk', () => {
    for (const copy of ['sync', 'seed']) {
      const world = mkSyncWorld();
      commitCheckout(world, { app: false });
      write(path.join(world.app, 'README.md'), '# an edit no repo tracks\n');
      const { rc, out, err } = copy === 'sync' ? sync(world) : seedRc(world);
      expect(rc, `the ${copy} ran: ${out}${err}`).toBe(0);
      expect(read(path.join(world.clone, 'README.md')), `the ${copy} carried the folder's readme, edit included`).toBe('# an edit no repo tracks\n');
      expect(read(path.join(world.clone, 'config', 'omega.json5')), `and the ${copy} carried the config`).toBe('{ brand: { id: "workkit" } }\n');
      cleanup(world.root);
    }
  });

  test('an app the repo tracks but HEAD lacks is a loud stop, for the sync and the seed', () => {
    const world = mkSyncWorld();
    const checkout = commitCheckout(world, { app: false });
    git(checkout, 'add', 'tower/app');
    const { rc, out, err } = sync(world);
    expect(rc, `the caller can tell it did not run: ${out}${err}`).toBe(1);
    expect((out + err).includes('could not export the committed'), `it names the failure, got: ${out}${err}`).toBeTruthy();
    expect(read(path.join(world.clone, 'README.md')), 'the clone received no readme').toBe(null);
    expect(read(path.join(world.clone, 'config', 'omega.json5')), 'nor the config').toBe(null);

    const seed = seedRc(world);
    expect(seed.rc, `the seed stops too: ${seed.out}${seed.err}`).toBe(1);
    expect(read(path.join(world.clone, 'README.md')), 'and the clone stays empty of the readme').toBe(null);
    expect(read(path.join(world.clone, 'config', 'omega.json5')), 'and of the config').toBe(null);
    cleanup(world.root);
  });
});

describe('workflow/home: a top-level folder the app dropped', () => {
  const OK_LINE = /(\d+) file\(s\) from .*, (\d+) retired/;
  const retiredCount = (said) => {
    const match = OK_LINE.exec(said);
    return match ? Number(match[2]) : null;
  };

  // A clone synced while the app shipped each named folder (two files deep),
  // then an app without them: the stamp the first sync wrote is the only record.
  const dropAfterSync = (names) => {
    const world = mkSyncWorld();
    for (const name of names) {
      write(path.join(world.app, name, 'one.js'), 'export default 1;\n');
      write(path.join(world.app, name, 'deep', 'two.js'), 'export default 2;\n');
    }
    const first = sync(world);
    expect(first.rc, `the first sync ran: ${first.out}${first.err}`).toBe(0);
    for (const name of names) {
      expect(fs.existsSync(path.join(world.clone, name, 'deep', 'two.js')), `${name}/ reached the clone first`).toBeTruthy();
      fs.rmSync(path.join(world.app, name), { recursive: true, force: true });
    }
    return world;
  };

  test('a clone folder neither the stamp nor the retired list names is left alone', () => {
    const world = dropAfterSync(['legacy']);
    write(path.join(world.clone, 'notes', 'todo.md'), 'the clone’s own\n');
    const { rc, out, err } = sync(world);
    expect(rc, `the sync ran: ${out}${err}`).toBe(0);
    expect(!fs.existsSync(path.join(world.clone, 'legacy')), 'the listed folder went in the same run').toBeTruthy();
    expect(read(path.join(world.clone, 'notes', 'todo.md')), 'and the unlisted folder stayed, its file intact').toBe('the clone’s own\n');
    cleanup(world.root);
  });

  test('an excluded folder is never retired, listed or not', () => {
    const world = dropAfterSync(['legacy', 'drafts']);
    // What an install and a mint leave in the clone: excluded, listed nowhere.
    write(path.join(world.clone, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
    write(path.join(world.clone, '.omega', 'runs', 'one.json'), '{}\n');
    // drafts/ is listed by the stamp, .omega/ by the retired list; both excluded.
    const prelude = 'WK_TOWER_APP_EXCLUDE+=(drafts)\nWK_TOWER_APP_RETIRED+=(.omega)';
    const { rc, out, err } = sync(world, { prelude });
    expect(rc, `the sync ran: ${out}${err}`).toBe(0);
    expect(!fs.existsSync(path.join(world.clone, 'legacy')), 'the retirement ran: legacy/ went').toBeTruthy();
    expect(read(path.join(world.clone, 'drafts', 'deep', 'two.js')), 'the stamp-listed excluded folder stayed').toBe('export default 2;\n');
    expect(read(path.join(world.clone, '.omega', 'runs', 'one.json')), 'the retired-listed excluded folder stayed').toBe('{}\n');
    expect(read(path.join(world.clone, 'node_modules', '.bin', 'omega')), 'and the unlisted excluded folder stayed').toBe('#!/bin/sh\n');
    cleanup(world.root);
  });

  test('a clone from before the stamp carried folders loses its apps/ folder', () => {
    const world = mkSyncWorld();
    // The old layout's leftover, under a stamp holding the version alone.
    write(path.join(world.clone, STAMP), `${kitVersion()}\n`);
    write(path.join(world.clone, 'apps', 'web', 'index.js'), 'the old layout\n');
    const { rc, out, err } = sync(world);
    expect(rc, `the sync ran: ${out}${err}`).toBe(0);
    expect(!fs.existsSync(path.join(world.clone, 'apps')), `apps/ is removed: ${out}${err}`).toBeTruthy();
    cleanup(world.root);
  });

  test('nothing to copy and one folder retired is a change, never the already-current skip', () => {
    const world = dropAfterSync(['legacy']);
    const { rc, out, err } = sync(world);
    const said = out + err;
    expect(rc, `the retirement is a change: ${said}`).toBe(0);
    expect(!/already current/.test(said), `and it is not reported as current: ${said}`).toBeTruthy();
    expect(retiredCount(said), `the ok line counts the one folder: ${said}`).toBe(1);
    expect(!fs.existsSync(path.join(world.clone, 'legacy')), 'and the folder is gone').toBeTruthy();
    cleanup(world.root);
  });

  // A read-only subfolder makes the removal fail; Windows and root ignore the mode.
  test('a folder removal that fails warns, cleans its temp folder and returns 3', { skip: (IS_WINDOWS || process.getuid() === 0) && 'a read-only folder does not stop a removal here' }, () => {
    const world = mkSyncWorld();
    write(path.join(world.app, 'legacy', 'deep', 'two.js'), 'export default 2;\n');
    const checkout = commitCheckout(world);
    const first = sync(world);
    expect(first.rc, `the first sync ran: ${first.out}${first.err}`).toBe(0);
    git(checkout, 'rm', '-rq', 'tower/app/legacy');
    const res = git(checkout, '-c', 'user.name=checkout', '-c', 'user.email=checkout@localhost',
      'commit', '-q', '-m', 'chore: drop legacy');
    expect(res.status === 0, `the fixture dropped legacy/: ${res.stdout}${res.stderr}`).toBeTruthy();

    const locked = path.join(world.clone, 'legacy', 'deep');
    const tmp = path.join(world.root, 'tmp');
    fs.mkdirSync(tmp);
    fs.chmodSync(locked, 0o555);
    const { rc, out, err } = sync(world, { env: { TMPDIR: tmp } });
    fs.chmodSync(locked, 0o755);
    const said = out + err;
    expect(rc, `a failed removal is rc=3: ${said}`).toBe(3);
    expect(said.includes('legacy'), `the warning names the folder: ${said}`).toBeTruthy();
    expect(fs.readdirSync(tmp).join(','), 'and the temp folder is cleaned').toBe('');
    cleanup(world.root);
  });
});
