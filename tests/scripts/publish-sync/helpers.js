//
// The shared prologue of the tower sync and publish-wiring suites, the
// `*.test.js` files beside this one, which test the tower SYNC and the brand
// MINT (issue #129) one concern each: the two steps that run between the pull
// and the build, and the reason the published dashboard stops being stranded
// at the day the home repo was seeded. A plain module, never a suite: the
// runner only loads files ending in `.test.js`.
//
// Two layers, and neither one touches the real ~/.workkit. The sync itself is
// asked its questions as the library function it is, against fixture
// directories and a clone of a local bare "GitHub". The WIRING (the sync ahead
// of the build, the install after a sync that changed a manifest (issue #130),
// the mint after a sync that changed something, the abort on a mint that
// failed) is proved end to end through publish.sh in the same
// scratch world the publish suite uses, with an `npm` shim for the build and a
// stub `omega` for the mint. No omega, no network.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert } = require('../../lib/harness');
const { BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, stubTool, joinPath } = require('../../lib/platform');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW_DIR = path.join(REPO_ROOT, 'workflow');
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return stubTool(path.dirname(file), path.basename(file), ['#!/usr/bin/env bash', ...lines]);
};

/**
 * The checkout's `tower/app`, the real one's shape without its weight: a brand
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
  write(path.join(app, '.env.production'), 'SECRET=2\n');
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
    env: homeEnv(homeDir, {
      PATH: joinPath(SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(workflowHome),
      WORKKIT_TOWER_APP: tower.app,
      WORKKIT_HOME_REMOTE: bare,
    }),
  };
};

/** Source the library and run one line of shell in it: how every caller uses it. */
const inHome = (world, script, { env = {} } = {}) => {
  // A script path handed INTO a shell is POSIX: each of these sources its own
  // siblings off `${BASH_SOURCE[0]%/*}`, which cuts nothing out of a native
  // path and leaves the source target a file with a directory pasted onto it.
  const driver = [
    'set -euo pipefail',
    ...['lib.sh', 'discussions.sh', 'home.sh'].map(
      (file) => `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, file)))}`,
    ),
    script,
  ].join('\n');
  const res = spawnSync(BASH, [...NO_RC, '-c', driver], {
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
 * stubs a publish needs: an `npm` that writes what a build writes, a `gh` that
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

  // The app the sync reads: a sibling of the engine in the copied checkout,
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

  // The npm shim answers both calls a publish makes: the install of the
  // clone's dependencies (issue #130) and the build of the app, and records
  // its CWD and its argv, so a test can prove which one ran and where. The cwd
  // is half the record because that is what an install is keyed from (issue
  // #166): `--prefix` names the project, the cwd names the tree npm writes.
  const npmLog = path.join(root, 'npm.log');
  writeStub(path.join(bin, 'npm'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(npmLog))}`,
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

  // The clone, carrying what a seed left BEHIND: the project as it looked the
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
  // real mint leaves: the minted tree the "has it ever minted" check reads.
  const mintLog = path.join(root, 'mint.log');
  writeStub(path.join(tower, 'node_modules', '.bin', 'omega'), [
    `printf '%s|%s\\n' "$PWD" "$*" >> ${JSON.stringify(shellPath(mintLog))}`,
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
    env: homeEnv(homeDir, {
      PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(workflowHome),
      WORKKIT_HOME_REMOTE: bare,
    }),
  };
};

// Run from the world's own root, never the caller's: the daily job invokes this
// from wherever it woke up, and a shim that keys anything off the cwd must key
// it off a scratch directory rather than this checkout.
const publish = (world, args = []) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(world.kit, 'workflow', 'publish.sh')), ...args], {
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

module.exports = {
  REPO_ROOT, cleanup, writeJson, write, writeStub, mkSyncWorld, inHome, sync, mtimes, mkPublishWorld, publish, fromPages,
};
