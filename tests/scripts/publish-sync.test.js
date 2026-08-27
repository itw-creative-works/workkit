//
// Tests for the tower SYNC and the brand MINT (issue #129) — the two steps that
// run between the pull and the build, and the reason the published dashboard
// stops being stranded at the day the home repo was seeded.
//
// Two layers, and neither one touches the real ~/.workkit. The sync itself is
// asked its questions as the library function it is, against fixture
// directories and a clone of a local bare "GitHub". The WIRING — the sync ahead
// of the build, the install after a sync that changed a manifest (issue #130),
// the mint after a sync that changed something, the abort on a mint that
// failed — is proved end to end through publish.sh in the same
// scratch world the publish suite uses, with an `npm` shim for the build and a
// stub `omega` for the mint. No omega, no network.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_DIR = path.join(REPO_ROOT, 'workflow');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-sync-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const writeStub = (file, lines) => {
  write(file, `${['#!/usr/bin/env bash', ...lines, ''].join('\n')}`);
  fs.chmodSync(file, 0o755);
};

/**
 * The checkout's `tower/app` — the real one's shape without its weight: a brand
 * root with targets/web, config/ and assets/, manifests carrying `file:` specs
 * into a sibling framework, and every accretion a copy must leave behind
 * (node_modules at both levels, a lockfile, .omega, dist, a .env).
 */
const mkTowerApp = (root) => {
  const app = path.join(root, 'checkout', 'tower', 'app');
  const framework = path.join(root, 'omega', 'packages');
  fs.mkdirSync(path.join(framework, 'manager'), { recursive: true });
  fs.mkdirSync(path.join(framework, 'web'), { recursive: true });

  writeJson(path.join(app, 'package.json'), {
    name: 'workkit-tower',
    private: true,
    description: 'The tower UI.',
    workspaces: ['targets/*'],
    scripts: { build: 'omega build' },
    devDependencies: { '@omega.js/manager': 'file:../../../omega/packages/manager' },
  });
  writeJson(path.join(app, 'targets', 'web', 'package.json'), {
    name: 'workkit-tower-web',
    private: true,
    dependencies: { '@omega.js/web': 'file:../../../../../omega/packages/web' },
    scripts: { build: 'omega build' },
  });
  write(path.join(app, '.gitignore'), 'node_modules/\npackage-lock.json\ndist/\n.omega/\n');
  write(path.join(app, '.env.example'), 'TOWER_ALLOW_HOST=\n');
  write(path.join(app, 'README.md'), '# the tower\n');
  write(path.join(app, 'config', 'omega.json5'), '{ brand: { id: "workkit" } }\n');
  write(path.join(app, 'assets', 'logo', 'brandmark.svg'), '<svg/>\n');
  write(path.join(app, 'targets', 'web', 'src', 'index.html'), '<html>the board</html>\n');
  write(path.join(app, 'targets', 'web', 'src', 'pages', 'board.js'), 'export default 1;\n');

  write(path.join(app, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  write(path.join(app, 'targets', 'web', 'node_modules', 'x.js'), 'nested\n');
  write(path.join(app, 'package-lock.json'), '{}\n');
  write(path.join(app, '.omega', 'runs', 'one.json'), '{}\n');
  write(path.join(app, 'targets', 'web', 'dist', 'index.html'), 'stale build\n');
  write(path.join(app, '.env'), 'SECRET=1\n');
  write(path.join(app, '.cache', 'one.json'), '{}\n');
  write(path.join(app, '.temp', 'scratch.txt'), 'temp\n');
  write(path.join(app, '.DS_Store'), 'finder\n');

  return { app, framework };
};

/**
 * A scratch machine for the library layer: a ~/.workkit whose `tower` is the
 * clone of a local bare repo, and a checkout to sync FROM.
 */
const mkSyncWorld = () => {
  const root = mkTmp();
  const homeDir = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  const tower = mkTowerApp(root);
  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
  writeJson(path.join(workflowHome, 'settings.json'), {
    version: 1, site: { repo: 'owner/workkit', publish: true },
  });
  const clone = path.join(workflowHome, 'tower');
  spawnSync('git', ['clone', '-q', bare, clone], { encoding: 'utf8' });

  return {
    root,
    clone,
    app: tower.app,
    env: {
      HOME: homeDir,
      PATH: `${BASE_PATH}:${path.dirname(process.execPath)}`,
      WORKFLOW_HOME: workflowHome,
      WORKKIT_TOWER_APP: tower.app,
      WORKKIT_HOME_REMOTE: bare,
    },
  };
};

/** Source the library and run one line of shell in it — how every caller uses it. */
const inHome = (world, script, { env = {} } = {}) => {
  const driver = [
    'set -euo pipefail',
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'lib.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'discussions.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'home.sh'))}`,
    script,
  ].join('\n');
  const res = spawnSync('bash', ['-c', driver], {
    env: { ...world.env, ...env }, input: '', encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** `wk_home_sync`, with its return code printed rather than ending the run. */
const sync = (world, { env = {} } = {}) => {
  const res = inHome(world, 'rc=0\nwk_home_sync || rc=$?\nprintf \'rc=%s\\n\' "$rc"', { env });
  const rc = /rc=(\d+)/.exec(res.out + res.err);
  return { ...res, rc: rc ? Number(rc[1]) : null };
};

const mtimes = (dir) => {
  const seen = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else seen[path.relative(dir, full)] = fs.statSync(full).mtimeMs;
    }
  };
  walk(dir);
  return seen;
};

// ── The wiring layer ─────────────────────────────────────────────────────────

/**
 * A publish world: a copied engine that CARRIES a tower/app to sync from, a
 * scratch ~/.workkit, a bare "GitHub" with a project already on main, and the
 * stubs a publish needs — an `npm` that writes what a build writes, a `gh` that
 * answers everything, and the clone's `omega` binary, which is both the tooling
 * gate and the mint.
 *
 * `mintFails` makes that binary exit non-zero the way a mint over a broken SVG
 * would. `minted` seeds the clone with the output of a mint that already ran.
 * `installFails` makes the `npm install` half of the shim exit non-zero, the
 * way an unresolvable dependency would.
 */
const mkPublishWorld = ({ mintFails = false, minted = false, installFails = false } = {}) => {
  const root = mkTmp();
  const kit = path.join(root, 'kit');
  const bin = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  const tower = path.join(workflowHome, 'tower');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  fs.mkdirSync(path.join(kit, 'tower'), { recursive: true });
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'workflow'), kit]);
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'tower', 'api'), path.join(kit, 'tower')]);

  // The app the sync reads — a sibling of the engine in the copied checkout,
  // exactly as it is in the real one. No `file:` specs: the manifest transform
  // has its own cases at the library layer, and here it would only add a
  // resolvable framework path to the fixture.
  const app = path.join(kit, 'tower', 'app');
  writeJson(path.join(app, 'package.json'), {
    name: 'workkit-tower', private: true, description: 'The tower UI.', scripts: { build: 'omega build' },
  });
  writeJson(path.join(app, 'targets', 'web', 'package.json'), { name: 'workkit-tower-web', private: true });
  write(path.join(app, 'config', 'omega.json5'), '{ brand: { id: "workkit" } }\n');
  write(path.join(app, 'assets', 'logo', 'brandmark.svg'), '<svg/>\n');
  write(path.join(app, 'targets', 'web', 'src', 'index.html'), '<html>the current board</html>\n');
  write(path.join(app, '.gitignore'), 'node_modules/\ndist/\n.omega/\n');

  // The npm shim answers both calls a publish makes — the install of the
  // clone's dependencies (issue #130) and the build of the app — and records
  // its CWD and its argv, so a test can prove which one ran and where. The cwd
  // is half the record because that is what an install is keyed from (issue
  // #166): `--prefix` names the project, the cwd names the tree npm writes.
  const npmLog = path.join(root, 'npm.log');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(npmLog)}`,
    'prefix="$PWD"',
    'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
    'if [[ "$*" == *install* ]]; then',
    ...(installFails
      ? ['  printf \'npm: ERESOLVE could not resolve @omega.js/web\\n\' >&2', '  exit 1']
      : ['  mkdir -p "$prefix/node_modules"', '  touch "$prefix/node_modules/.package-lock.json"', '  exit 0']),
    'fi',
    'mkdir -p "$prefix/dist"',
    'cp "$prefix/src/index.html" "$prefix/dist/index.html"',
    'exit 0',
  ]);
  writeStub(path.join(bin, 'gh'), ['exit 0']);

  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
  writeJson(path.join(workflowHome, 'settings.json'), {
    version: 1, site: { repo: 'owner/workkit', publish: true, url: null },
  });

  // The clone, carrying what a seed left BEHIND — the project as it looked the
  // day the home repo was made, which is the whole bug (issue #129).
  const seed = path.join(root, 'seed');
  writeJson(path.join(seed, 'package.json'), {
    name: 'workkit-tower', private: true, description: 'The tower UI.', scripts: { build: 'omega build' },
  });
  writeJson(path.join(seed, 'targets', 'web', 'package.json'), { name: 'workkit-tower-web', private: true });
  write(path.join(seed, 'config', 'omega.json5'), '{ brand: { id: "workkit" } }\n');
  write(path.join(seed, 'assets', 'logo', 'brandmark.svg'), '<svg/>\n');
  write(path.join(seed, 'targets', 'web', 'src', 'index.html'), '<html>the board, as it was seeded</html>\n');
  write(path.join(seed, '.gitignore'), 'node_modules/\ndist/\n.omega/\n');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore(home): seed the tower project');
  git(seed, 'remote', 'add', 'origin', bare);
  git(seed, 'push', '-q', '-u', 'origin', 'main');
  cleanup(seed);
  spawnSync('git', ['clone', '-q', bare, tower], { encoding: 'utf8' });

  // The clone's own build tooling: the gate publish checks for, and the binary
  // the mint calls. It records where it ran and with what, and leaves what a
  // real mint leaves — the minted tree the "has it ever minted" check reads.
  const mintLog = path.join(root, 'mint.log');
  writeStub(path.join(tower, 'node_modules', '.bin', 'omega'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(mintLog)}`,
    ...(mintFails
      ? ['printf \'omega: the brandmark could not be read\\n\' >&2', 'exit 1']
      : ['mkdir -p "$PWD/.omega/assets/logo/brandmark"', 'exit 0']),
  ]);
  if (minted) fs.mkdirSync(path.join(tower, '.omega', 'assets', 'logo', 'brandmark'), { recursive: true });

  return {
    root,
    kit,
    bare,
    tower,
    app,
    dist: path.join(tower, 'targets', 'web', 'dist'),
    mints: () => (fs.existsSync(mintLog)
      ? fs.readFileSync(mintLog, 'utf8').trim().split('\n').filter(Boolean)
      : []),
    npms: () => (fs.existsSync(npmLog)
      ? fs.readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean)
      : []),
    env: {
      HOME: homeDir,
      PATH: `${bin}:${BASE_PATH}:${path.dirname(process.execPath)}`,
      WORKFLOW_HOME: workflowHome,
      WORKKIT_HOME_REMOTE: bare,
    },
  };
};

// Run from the world's own root, never the caller's: the daily job invokes this
// from wherever it woke up, and a shim that keys anything off the cwd must key
// it off a scratch directory rather than this checkout.
const publish = (world, args = []) => {
  const res = spawnSync('bash', [path.join(world.kit, 'workflow', 'publish.sh'), ...args], {
    cwd: world.root, env: world.env, encoding: 'utf8', timeout: 60000,
  });
  assert(res.status !== null, `publish finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** What the published branch carries, as a fresh clone sees it. */
const fromPages = (world) => {
  const check = path.join(world.root, `check-${Math.random().toString(36).slice(2)}`);
  const res = spawnSync('git', ['clone', '-q', '-b', 'gh-pages', world.bare, check], { encoding: 'utf8' });
  return res.status === 0 ? check : null;
};

const run = async () => {
  group('workflow/home: the tower sync');

  await test('a clone that carries nothing gets the project, and none of the accretions', () => {
    const world = mkSyncWorld();
    const { rc, out, err } = sync(world);
    assertEq(rc, 0, `something changed — ${out}${err}`);
    assert(fs.existsSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html')), 'the app travelled');
    assert(fs.existsSync(path.join(world.clone, 'config', 'omega.json5')), 'and its config');
    assert(fs.existsSync(path.join(world.clone, 'assets', 'logo', 'brandmark.svg')), 'and the authored mark');
    assert(fs.existsSync(path.join(world.clone, '.env.example')), 'and the example env, which is not a secret');

    for (const gone of [
      'node_modules/.bin/omega', 'targets/web/node_modules/x.js', 'package-lock.json',
      '.omega/runs/one.json', 'targets/web/dist/index.html', '.env',
      '.cache/one.json', '.temp/scratch.txt', '.DS_Store',
    ]) {
      assert(!fs.existsSync(path.join(world.clone, gone)), `${gone} is never copied`);
    }
    cleanup(world.root);
  });

  await test('a freshly seeded clone is already current — the seed and the sync agree', () => {
    const world = mkSyncWorld();
    inHome(world, 'wk_home_seed');
    const { rc, out, err } = sync(world);
    assertEq(rc, 2, `nothing to do — ${out}${err}`);
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
    assertEq(rc, 0, `the change is a change — ${out}${err}`);
    assertEq(fs.readFileSync(path.join(world.clone, 'targets', 'web', 'src', 'index.html'), 'utf8'),
      '<html>a newer board</html>\n', 'the edited file landed');

    const after = mtimes(world.clone);
    const rewritten = Object.keys(after).filter((rel) => after[rel] !== backdated[rel]);
    assertEq(rewritten.join(','), 'targets/web/src/index.html',
      `and nothing else was written at all: ${rewritten.join(', ')}`);
    cleanup(world.root);
  });

  await test('a second run writes nothing — the manifests included', () => {
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
    assertEq(rc, 2, `already current — ${out}${err}`);
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
    assertEq(rc, 0, `the removal is a change — ${out}${err}`);
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
    assertEq(rc, 1, `the caller can tell it did not run — ${out}${err}`);
    assert(/tower app/.test(out + err), `it names what is missing, got: ${out}${err}`);
    assertEq(JSON.stringify(mtimes(world.clone)), JSON.stringify(before), 'and wrote nothing');
    cleanup(world.root);
  });

  group('workflow/publish: the sync, then the install, then the mint, then the build');

  await test('the clone is refreshed before it is built — the published page is the app’s', () => {
    const world = mkPublishWorld();
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}${err}`);
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
    assertEq(code, 0, `exit 0 — ${out}${err}`);
    const installs = world.npms().filter((call) => /install/.test(call));
    assertEq(installs.length, before + 1, `one install for the manifest that moved: ${installs.join(' | ')}`);
    assertEq(installs[installs.length - 1], `${world.tower}|install`,
      'in the clone, which is the project the build runs out of');
    cleanup(world.root);
  });

  await test('the install is keyed from the clone’s real path, symlinked ~/.workkit or not', () => {
    // Issue #166: `~/.workkit` is a symlink on the machine that publishes, and
    // `npm --prefix <link>/tower install` resolved the project through the link
    // while keying the tree from the CALLER'S cwd — the lockfile took package
    // paths outside the project root, the workspace went extraneous, and the
    // next run crashed arborist. An install run from inside the resolved path
    // is the whole fix, so the cwd is what this pins.
    const world = mkPublishWorld();
    const link = path.join(world.root, 'linked-workkit');
    fs.symlinkSync(path.join(world.root, 'workflow-home'), link);
    world.env.WORKFLOW_HOME = link;

    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}${err}`);
    const installs = world.npms().filter((call) => /install/.test(call));
    assertEq(installs.length, 1, `the seeded clone’s manifests are installed once: ${installs.join(' | ')}`);
    assertEq(installs[0], `${world.tower}|install`,
      'the cwd is the clone with its links resolved, and no --prefix keys the tree from elsewhere');
    cleanup(world.root);
  });

  await test('a sync that changed only a page installs nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // The seeded clone's root manifest carries no `file:` transform yet, so the
    // first sync composes one and that run does install — which is what makes
    // the second run's silence mean something.
    const before = world.npms().filter((call) => /install/.test(call)).length;
    assertEq(before, 1, 'the first publish’s sync did write a manifest');

    write(path.join(world.app, 'targets', 'web', 'src', 'index.html'), '<html>a newer board</html>\n');
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}${err}`);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, before,
      'the ordinary morning does not reinstall the dependencies to publish a page');
    const pages = fromPages(world);
    assertEq(fs.readFileSync(path.join(pages, 'index.html'), 'utf8'), '<html>a newer board</html>\n',
      'and the page still published');
    cleanup(world.root);
  });

  await test('a manifest committed while the site was off is installed once the switch turns on', () => {
    // The sync sits above the switch, so a switch-off run still writes and
    // commits the refreshed manifests — and ends before the install. The flag
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
    assertEq(code, 0, `exit 0 — ${out}${err}`);
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
    assert(second.code !== 0, `run 2 aborts too — the install is asked again, got exit ${second.code}`);
    assertEq(world.npms().filter((call) => /install/.test(call)).length, 2,
      'one attempt per run, not one ever');
    assertEq(fromPages(world), null, 'and nothing published over the failure');
    cleanup(world.root);
  });

  await test('an install that fails aborts the publish before the build, and says why', () => {
    // The clone's manifests are the seed's, so the first sync composes them and
    // the install is the next step — which cannot finish here.
    const world = mkPublishWorld({ installFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, `the caller can tell a failure from a skip — ${out}${err}`);
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
    assertEq(mints[0], `${world.tower}|--service=assets`, 'the assets service, run at the clone’s brand root');
    cleanup(world.root);
  });

  await test('a clone that has never minted mints even when the sync changed nothing', () => {
    const world = mkPublishWorld();
    publish(world);
    // Everything is current now, and the first run left the minted tree.
    const { code, out, err } = publish(world);
    assertEq(code, 0, `exit 0 — ${out}${err}`);
    assertEq(world.mints().length, 1, 'the second run has nothing to mint for');

    fs.rmSync(path.join(world.tower, '.omega'), { recursive: true, force: true });
    publish(world);
    assertEq(world.mints().length, 2, 'a clone with no minted assets mints anyway — the tags reference them');
    cleanup(world.root);
  });

  await test('a mint that fails aborts the publish before the build, and says why', () => {
    const world = mkPublishWorld({ mintFails: true });
    const { code, out, err } = publish(world);
    assert(code !== 0, `the caller can tell a failure from a skip — ${out}${err}`);
    assert(/mint/.test(out + err), `it names the step, got: ${out}${err}`);
    assert(/brandmark could not be read/.test(out + err), `and what the mint said, got: ${out}${err}`);
    assertEq(fs.existsSync(world.dist), false, 'nothing was built on top of it');
    assertEq(fromPages(world), null, 'and a stale site beats one with a broken logo');
    cleanup(world.root);
  });

  await test('a failed mint stays failed — the next run aborts too, until a mint succeeds', () => {
    // The dangerous shape: a clone that minted fine in the past (the dir
    // exists), then a sync brings the change that breaks the mint. Run 1
    // aborts on the mint; run 2's sync is current and the dir exists, so
    // without a sticky marker nothing would mint and the failure would
    // publish. The marker is what keeps the abort until a mint goes green.
    const world = mkPublishWorld({ mintFails: true, minted: true });
    const first = publish(world);
    assert(first.code !== 0, 'run 1 aborts on the failing mint');

    const second = publish(world);
    assert(second.code !== 0, `run 2 aborts too — the failure is sticky, got exit ${second.code}`);
    assertEq(fromPages(world), null, 'and nothing was published over it');

    const mintLog = path.join(world.root, 'mint.log');
    writeStub(path.join(world.tower, 'node_modules', '.bin', 'omega'), [
      `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(mintLog)}`,
      'mkdir -p "$PWD/.omega/assets/logo/brandmark"',
      'exit 0',
    ]);
    const third = publish(world);
    assertEq(third.code, 0, `a repaired mint publishes again — ${third.out}${third.err}`);
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
    assertEq(rc, 3, `a partial write is rc=3, distinct from the skip — ${out}${err}`);
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

  group('the ship skill');

  await test('ship republishes the dashboard when the diff touched it', () => {
    const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8');
    assert(/workkit publish/.test(skill), 'the ship skill knows the command');
    assert(/tower\/app/.test(skill), 'and what in the diff triggers it');
    assert(/Bash\(workkit publish \*\)/.test(skill), 'and is allowed to run it');
    cleanup(path.join(os.tmpdir(), 'nothing'));
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
