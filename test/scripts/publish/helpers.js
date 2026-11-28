// The shared prologue of the workflow/publish.js suites beside this one, one
// concern each. The script runs from a copied checkout and builds the clone: a
// scratch `~/.workkit/tower` cloned from a local bare "GitHub", its tooling a
// stub `omega` plus an `npm` shim. No omega, no network.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { expect, mkTmp, seeded, run } = require('../../lib/harness');
const {
  SYSTEM_PATH, NODE_DIR, gitPath, toolStem, nodeHomeEnv, linkTool, stubTool, joinPath,
} = require('../../lib/platform');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');
const { copySettingsKit } = require('../../lib/settings-kit');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

const writeStub = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return stubTool(path.dirname(file), path.basename(file), ['#!/usr/bin/env bash', ...lines]);
};

/**
 * The engine and the libs the slug list reads, copied into `kit` so a run's
 * engine is the copy and never this checkout. The engine requires the hooks
 * module's shared rules (the tower's temp folder, the changelog's closed
 * issues), so its mods/ travel whole; the package.json makes the copy a module.
 * The root package.json holds the floor every entry checks.
 */
const copyEngine = (kit) => {
  fs.mkdirSync(path.join(kit, 'tower'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(kit, 'package.json'));
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'workflow'), kit]);
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'tower', 'api'), path.join(kit, 'tower')]);
  copySettingsKit(kit);
  spawnSync('cp', ['-R', path.join(REPO_ROOT, 'hooks', 'mods'), path.join(kit, 'hooks')]);
};

/**
 * A bare "GitHub" at `<seed>/remote.git` whose default branch is `branch`.
 * Given `files` (root-relative path to content), the tower project as a seed
 * leaves it: those files committed on `branch`, pushed, and cloned to
 * `<seed>/workflow-home/tower`.
 */
const mkTowerRemote = (seed, { branch = 'main', files = null } = {}) => {
  const bare = path.join(seed, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', branch, bare], { encoding: 'utf8' });
  if (!files) return;
  const work = path.join(seed, 'seed');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), body);
  }
  git(work, 'init', '-q', '-b', branch);
  git(work, 'add', '-A');
  git(work, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore(home): seed the tower project');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', '-u', 'origin', branch);
  cleanup(work);
  spawnSync('git', ['clone', '-q', bare, path.join(seed, 'workflow-home', 'tower')], { encoding: 'utf8' });
};

// The parts of a world no option changes inside one shape, built once per
// process for each `branch`, `home` and `roster` a suite asks for: the copied
// checkout, the bare "GitHub" with the tower project on main, its clone, and
// the roster repos.
const copyWorld = seeded((seed, { branch, home, roster }) => {
  copyEngine(path.join(seed, 'kit'));

  // The clone, carrying what a seed leaves: the project on main (the app and
  // nothing else).
  mkTowerRemote(seed, {
    branch,
    files: home ? {
      'package.json': '{ "name": "workkit-tower" }\n',
      'targets/web/src/index.html': '<html>the board</html>\n',
      'README.md': '# the tower\n',
      '.gitignore': 'node_modules/\ndist/\n',
    } : null,
  });

  // Each roster entry is a real repo: a committed opt-in, and an origin the
  // slug is derived from.
  for (const name of roster) {
    const dir = path.join(seed, 'repos', name);
    fs.mkdirSync(path.join(dir, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', `https://github.com/owner/${name}.git`);
  }
});

/**
 * A world: a copied checkout, a scratch HOME and ~/.workkit, a bare "GitHub"
 * with the tower project already on main, and the two shims a publish needs.
 * `tooling: false` leaves the omega binary out of the clone, a machine where
 * `npm install` exits 0 and still leaves nothing that can build. `buildFails`
 * makes the build exit non-zero. `roster` is repo folder names to register,
 * each a real opted-in git repo. `publish` is the owner's `site.publish` switch,
 * on by default. `pages` is the teardown's Pages answer (`configured` or the
 * `none` 404). `branch` is the home repo's default branch, not always `main`.
 */
const mkWorld = ({
  tooling = true, buildFails = false, siteUrl = null, home = true, roster = [],
  publish: publishOn = true, pages = 'configured', branch = 'main',
} = {}) => {
  const root = mkTmp('workkit-publish-');
  const kit = path.join(root, 'kit');
  const bin = path.join(root, 'bin');
  const homeDir = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  const tower = path.join(workflowHome, 'tower');
  const bare = path.join(root, 'remote.git');
  copyWorld(root, { branch, home, roster });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });

  // The build: an `npm --prefix <clone>/targets/web run build` that writes dist/
  // beside src/, as `omega build` does. It records the path prefix its env
  // carried, so a test can prove what the build was told the site serves at.
  const prefixLog = path.join(root, 'prefix.log');
  // Both stand-ins record the QUIET their environment carried, `unset` for none.
  const quietLog = path.join(root, 'quiet.log');
  const recordQuiet = `printf '%s\\n' "\${QUIET-unset}" >> ${JSON.stringify(quietLog)}`;
  writeStub(path.join(bin, 'npm'), [
    recordQuiet,
    `printf '%s' "\${OMEGA_PATH_PREFIX:-unset}" > ${JSON.stringify(prefixLog)}`,
    ...(buildFails
      ? ['printf \'omega: build failed\\n\' >&2', 'exit 1']
      : [
        'prefix=""',
        'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
        'mkdir -p "$prefix/dist/assets"',
        // The output follows the source, so a test can change what the build
        // ships the way a real change would: by editing the app.
        'cp "$prefix/src/index.html" "$prefix/dist/index.html"',
        'printf \'body{}\\n\' > "$prefix/dist/assets/app.css"',
        'exit 0',
      ]),
  ]);

  // The only thing this script asks `gh` for: disabling Pages when the site is
  // taken down. It records its argv and answers a 404 the way gh does for a repo
  // with no Pages, which the teardown reads as "already off", not a failure.
  const ghLog = path.join(root, 'gh-argv.log');
  writeStub(path.join(bin, 'gh'), [
    recordQuiet,
    `printf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}`,
    ...(pages === 'none'
      ? ['printf \'gh: Not Found (HTTP 404)\\n\' >&2', 'exit 1']
      : ['exit 0']),
  ]);

  // The site options are the user's and live beside the roster: the clone
  // below is engine territory and carries nothing hand-written.
  const settings = {
    version: 1,
    site: { repo: home ? 'owner/workkit' : null, publish: publishOn, url: siteUrl },
  };
  fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  // The roster this machine has registered: the engine's own index, read by
  // the same module the tower and the brief read it with, keyed by where this
  // world's copies of the seed's repos sit.
  if (roster.length) {
    const registered = {};
    for (const name of roster) registered[gitPath(path.join(root, 'repos', name))] = { registered: '2026-07-29' };
    fs.writeFileSync(path.join(workflowHome, '.repos.json'), `${JSON.stringify({ version: 1, repos: registered }, null, 2)}\n`);
  }

  // Native, as the publish's node reads it.
  const env = nodeHomeEnv(homeDir, {
    PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
    WORKFLOW_HOME: workflowHome,
    WORKKIT_HOME_REMOTE: bare,
  });

  // The copied clone still names the seed's bare as its origin; this world's
  // own bare takes its place. Unless a world says otherwise, the clone gets the
  // build tooling that proves it can build here.
  if (home) {
    git(tower, 'remote', 'set-url', 'origin', bare);
    // The mint leaves what a real one leaves: a minted logo, which the build
    // checks for before it builds.
    if (tooling) {
      writeStub(path.join(tower, 'node_modules', '.bin', 'omega'),
        ['mkdir -p "$PWD/.omega/assets/logo"', 'exit 0']);
    }
  }

  return {
    root,
    kit,
    bare,
    tower,
    workflowHome,
    settings: path.join(workflowHome, 'settings.json'),
    // A tracked file of the project itself, for the cases about what the clone
    // carries rather than what the owner configured.
    source: path.join(tower, 'README.md'),
    ghCalls: () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8').trim().split('\n').filter(Boolean) : []),
    buildPrefix: () => (fs.existsSync(prefixLog) ? fs.readFileSync(prefixLog, 'utf8') : null),
    quietSeen: () => (fs.existsSync(quietLog) ? fs.readFileSync(quietLog, 'utf8').trim().split('\n').filter(Boolean) : []),
    dist: path.join(tower, 'targets', 'web', 'dist'),
    env,
  };
};

/**
 * A bin directory mirroring the real PATH with the named tools left out: the
 * suite's idiom for a machine that is missing them. The whole PATH is mirrored
 * rather than a hand-listed set, so the run never dies of some other utility
 * while claiming to prove something about the excluded ones.
 */
const binDirWithout = (...excluded) => {
  const binDir = mkTmp('workkit-publish-');
  const seen = new Set();
  for (const dir of [...SYSTEM_PATH.split(path.delimiter), NODE_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      // The tool a name is, whatever extension this platform gives it: an
      // excluded one has to be missing under every spelling of itself.
      const tool = toolStem(name);
      if (excluded.includes(tool) || seen.has(tool)) continue;
      seen.add(tool);
      linkTool(binDir, path.join(dir, name));
    }
  }
  return binDir;
};

/** `node <copy>/workflow/publish.js <args>` under this suite's node, `preload` (a path) loaded first when given. */
const publishArgv = (world, args = [], preload = null) => [
  ...(preload ? ['-r', preload] : []), path.join(world.kit, 'workflow', 'publish.js'), ...args,
];

const publish = (world, args = [], { preload } = {}) => {
  const res = run(process.execPath, publishArgv(world, args, preload), { env: world.env });
  expect(res.status !== null, `publish finished (no timeout): ${res.output}`).toBeTruthy();
  // `out` is both streams in the order a terminal shows them, since what these
  // tests read is what the run said; `err` stays separate for the checks about
  // the stream.
  return {
    code: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    err: res.stderr || '',
  };
};

const setSite = (world, patch) => {
  const settings = JSON.parse(fs.readFileSync(world.settings, 'utf8'));
  settings.site = { ...settings.site, ...patch };
  fs.writeFileSync(world.settings, `${JSON.stringify(settings, null, 2)}\n`);
};

/** What the published branch actually carries, as a fresh clone sees it. */
const fromPages = (world) => {
  const check = path.join(world.root, `check-${Math.random().toString(36).slice(2)}`);
  const res = spawnSync('git', ['clone', '-q', '-b', 'gh-pages', world.bare, check], { encoding: 'utf8' });
  return res.status === 0 ? check : null;
};

const onMain = (world) => {
  const check = path.join(world.root, `main-${Math.random().toString(36).slice(2)}`);
  spawnSync('git', ['clone', '-q', world.bare, check], { encoding: 'utf8' });
  return check;
};

// A JSON5 file read as the JS object literal it is (comments, bare keys,
// single quotes, trailing commas), returned as plain same-realm data.
const readJson5 = (file) => JSON.parse(JSON.stringify(
  vm.runInNewContext(`(${fs.readFileSync(file, 'utf8')}\n)`),
));

module.exports = {
  REPO_ROOT, cleanup, git, writeStub, copyEngine, mkTowerRemote, mkWorld, binDirWithout, publishArgv, publish, setSite, fromPages,
  onMain, readJson5,
};
