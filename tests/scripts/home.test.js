//
// Tests for workflow/home.sh — the home repo's lifecycle (issues #27, #77).
//
// Every world is a scratch HOME with a scratch ~/.workkit (WORKFLOW_HOME) and a
// `gh` shim that answers `api user`, `repo view`, `repo create` and the
// Discussions/Pages calls with canned JSON. The REMOTE is a local bare repo
// (WORKKIT_HOME_REMOTE), so every clone, fetch and push in this suite runs
// against a directory on this machine: nothing here reaches GitHub, and nothing
// here touches the real ~/.workkit.
//
// The tower app the seed copies is a FIXTURE (WORKKIT_TOWER_APP) shaped like the
// real one — a brand root with apps/web, config/, a .gitignore, and file: specs
// pointing at a fake sibling framework. No omega, no npm install, no build.
//
// The library is sourced by a one-line driver rather than executed — it is a
// library, and the shell it is asked its questions in is the one the CLI and
// the heal ask them in.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-home-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/**
 * A bare repo standing in for the one on GitHub, with an initial commit when
 * `seed` is given — the difference between a repo just created (empty) and one
 * a first machine already pushed to.
 */
const mkRemote = (root, { seed = null } = {}) => {
  const bare = path.join(root, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { encoding: 'utf8' });
  if (seed) {
    const work = path.join(root, 'seed');
    fs.mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'main');
    for (const [file, body] of Object.entries(seed)) {
      fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
      fs.writeFileSync(path.join(work, file), body);
    }
    git(work, 'add', '-A');
    git(work, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore: seed');
    git(work, 'remote', 'add', 'origin', bare);
    git(work, 'push', '-q', '-u', 'origin', 'main');
  }
  return bare;
};

/**
 * The tower app the seed copies from — the real one's shape without its weight:
 * a brand root whose manifests carry `file:` specs into a sibling framework
 * checkout, an app under apps/web, and the accretions the seed must leave
 * behind (node_modules at both levels, a lockfile, .omega, dist).
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
    workspaces: ['apps/*'],
    scripts: { build: 'omega build' },
    devDependencies: { '@omega.js/manager': 'file:../../../omega/packages/manager' },
  });
  writeJson(path.join(app, 'apps', 'web', 'package.json'), {
    name: 'workkit-tower-web',
    private: true,
    dependencies: { '@omega.js/web': 'file:../../../../../omega/packages/web' },
    scripts: { build: 'omega build' },
  });
  fs.writeFileSync(path.join(app, '.gitignore'), 'node_modules/\npackage-lock.json\ndist/\n.omega/\n');
  fs.writeFileSync(path.join(app, 'README.md'), '# the tower\n');
  fs.writeFileSync(path.join(app, 'AGENTS.md'), '# the tower — architecture\n');
  fs.mkdirSync(path.join(app, 'config'), { recursive: true });
  fs.writeFileSync(path.join(app, 'config', 'omega.json5'), '{ brand: { id: "workkit" } }\n');
  fs.mkdirSync(path.join(app, 'apps', 'web', 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'apps', 'web', 'src', 'index.html'), '<html></html>\n');

  // Everything a working checkout accretes and a seed must not carry.
  fs.mkdirSync(path.join(app, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(app, 'apps', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(app, 'apps', 'web', 'node_modules', 'x.js'), 'nested\n');
  fs.writeFileSync(path.join(app, 'package-lock.json'), '{}\n');
  fs.mkdirSync(path.join(app, '.omega', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(app, '.omega', 'runs', 'one.json'), '{}\n');
  fs.mkdirSync(path.join(app, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(app, 'apps', 'web', 'dist', 'index.html'), 'stale build\n');

  return { app, framework };
};

/**
 * A scratch machine. `login` is who `gh api user` says you are; `repoExists`
 * decides whether `gh repo view` finds the home repo already; `discussionsOn`
 * and `categories` are what the Discussions API reports; `pagesOn` whether Pages
 * is already configured, and `pagesFails` whether enabling it is refused (the
 * private-repo-on-a-free-plan case).
 */
const mkWorld = ({
  login = 'owner', repoExists = false, discussionsOn = false,
  categories = ['Daily', 'Weekly', 'Monthly'], pagesOn = false, pagesFails = false,
  settings = { version: 1, repos: {} }, remote = null,
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (settings !== null) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  }
  const tower = mkTowerApp(root);

  // npm is a shim throughout: a seed's install must never reach the network,
  // and no test in this suite runs a real build.
  const npmLog = path.join(root, 'npm-argv.log');
  fs.writeFileSync(path.join(bin, 'npm'), [
    '#!/usr/bin/env bash',
    recordArgv(npmLog),
    'prefix=""',
    'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
    'mkdir -p "$prefix/node_modules/.bin"',
    'printf \'#!/bin/sh\\n\' > "$prefix/node_modules/.bin/omega"',
    'chmod +x "$prefix/node_modules/.bin/omega"',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'npm'), 0o755);

  const ghLog = path.join(root, 'gh-argv.log');
  const nodes = categories.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    'all="$*"',
    'case "$all" in',
    `  *"api user"*) printf '%s\\n' '${login}' ;;`,
    `  *"repo view"*) exit ${repoExists ? 0 : 1} ;;`,
    '  *"repo create"*) exit 0 ;;',
    `  *updateRepository*) printf '%s' '{"data":{"updateRepository":{"repository":{"hasDiscussionsEnabled":true}}}}' ;;`,
    '  *createDiscussion*)',
    `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/workkit/discussions/3"}}}}' ;;`,
    '  *"discussions(first"*)',
    `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[`
      + `{"title":"daily: 2026-07-27","createdAt":"2026-07-27T09:00:00Z","body":"yesterday"},`
      + `{"title":"daily: 2026-06-01","createdAt":"2026-06-01T09:00:00Z","body":"long ago"}]}}}}' ;;`,
    '  *discussionCategories*)',
    `    printf '%s' '{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":${discussionsOn},"discussionCategories":{"nodes":[${nodes}]}}}}' ;;`,
    `  *"pages"*) exit ${pagesOn ? 0 : (pagesFails ? 1 : 0)} ;;`,
    `  *) printf '%s' '{}' ;;`,
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  // The Pages calls are a GET (is it on?) then a POST (turn it on), and the two
  // must be able to answer differently.
  if (!pagesOn) {
    fs.writeFileSync(path.join(bin, 'gh'), fs.readFileSync(path.join(bin, 'gh'), 'utf8').replace(
      `  *"pages"*) exit ${pagesFails ? 1 : 0} ;;`,
      [
        '  *"-X POST"*pages*)',
        `    exit ${pagesFails ? 1 : 0} ;;`,
        '  *pages*) exit 1 ;;',
      ].join('\n'),
    ));
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  }

  return {
    root,
    home,
    workflowHome,
    tower: path.join(workflowHome, 'tower'),
    towerApp: tower.app,
    framework: tower.framework,
    remote: remote === null ? null : remote,
    ghCalls: () => readArgv(ghLog),
    npmCalls: () => readArgv(npmLog),
    settings: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'settings.json'), 'utf8')),
    pkg: (rel = 'package.json') => JSON.parse(fs.readFileSync(path.join(workflowHome, 'tower', rel), 'utf8')),
    env: {
      HOME: home,
      PATH: `${bin}:${BASE_PATH}:${path.dirname(process.execPath)}`,
      WORKFLOW_HOME: workflowHome,
      WORKKIT_TOWER_APP: tower.app,
      ...(remote ? { WORKKIT_HOME_REMOTE: remote } : {}),
    },
  };
};

/**
 * Source the library and run one line of shell in it — how every caller uses
 * it. stdin is a pipe, so any prompt that forgot its tty guard hangs the test
 * rather than production.
 */
const inHome = (world, script, { input = '' } = {}) => {
  const driver = [
    'set -euo pipefail',
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'lib.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'discussions.sh'))}`,
    `. ${JSON.stringify(path.join(WORKFLOW_DIR, 'home.sh'))}`,
    script,
  ].join('\n');
  const res = spawnSync('bash', ['-c', driver], {
    env: world.env, input, encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** A full setup run against a world whose remote is an empty bare repo. */
const setup = (world, { input = 'y\n' } = {}) => {
  if (!world.env.WORKKIT_HOME_REMOTE) {
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
  }
  return inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input });
};

const run = async () => {
  group('workflow/home: shape');

  await test('the three libraries parse and run nothing at load', () => {
    for (const lib of ['lib.sh', 'discussions.sh', 'home.sh']) {
      const file = path.join(WORKFLOW_DIR, lib);
      assertEq(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status, 0, `bash -n is clean for ${lib}`);
    }
    const world = mkWorld();
    // Sourcing all three prints nothing: a library that acted at load would
    // act every time the CLI, the heal or the job started.
    assertEq(inHome(world, 'true').out, '', 'sourcing says nothing');
    cleanup(world.root);
  });

  await test('no absolute personal path is written into the engine', () => {
    for (const lib of ['lib.sh', 'discussions.sh', 'home.sh', 'publish.sh']) {
      const text = fs.readFileSync(path.join(WORKFLOW_DIR, lib), 'utf8');
      assert(!/\/Users\/[a-z]/i.test(text), `${lib} carries no machine-specific path`);
    }
  });

  await test('the addresses are the new layout: a plain folder with one repo in it', () => {
    const world = mkWorld();
    const { out } = inHome(world, 'printf "%s\\n%s\\n%s\\n" "$WK_USER_DIR" "$WK_HOME_DIR" "$WK_HOME_SETTINGS"');
    const [userDir, homeDir, settings] = out.trim().split('\n');
    assertEq(userDir, world.workflowHome, 'the user folder is ~/.workkit');
    assertEq(homeDir, path.join(world.workflowHome, 'tower'), 'and the clone is the tower under it');
    assertEq(settings, path.join(world.workflowHome, 'settings.json'),
      'the site options live beside the roster, outside the clone the user never edits');

    // Nothing addresses anything INSIDE the clone but the app it builds: the
    // site options moved out and the inbox is gone entirely (issue #79).
    const lib = fs.readFileSync(path.join(WORKFLOW_DIR, 'lib.sh'), 'utf8');
    assert(!/WK_HOME_CONFIG|WK_HOME_INBOX/.test(lib), 'no address is kept for either retired file');
    cleanup(world.root);
  });

  group('workflow/home: the four states');

  await test('no home slug is `unset`', () => {
    const world = mkWorld();
    assertEq(inHome(world, 'wk_home_state').out, 'unset', 'nothing has been decided');
    cleanup(world.root);
  });

  await test('a slug with nothing cloned is `absent`', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    assertEq(inHome(world, 'wk_home_state').out, 'absent', 'setup has the clone left to do');
    cleanup(world.root);
  });

  await test('the clone of the home repo is `clone`', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{}\n' } });
    inHome(world, 'wk_home_clone owner/workkit');
    assertEq(inHome(world, 'wk_home_state').out, 'clone', 'the one state everything else needs');
    cleanup(world.root);
  });

  await test('anything else at that path is `other`, and is never adopted', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    fs.mkdirSync(path.join(world.tower, 'something'), { recursive: true });
    assertEq(inHome(world, 'wk_home_state').out, 'other', 'a folder somebody else made');
    cleanup(world.root);
  });

  group('workflow/home: the clone');

  await test('an absent path is cloned, and ~/.workkit is never made a git repo', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, { seed: { 'package.json': '{ "name": "tower" }\n' } });

    const { code, out } = inHome(world, 'wk_home_clone owner/workkit');
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(fs.existsSync(path.join(world.tower, '.git')), 'the tower folder is the git repo');
    assert(fs.existsSync(path.join(world.tower, 'package.json')), 'carrying the remote’s files');
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit stays a plain folder');
    assert(/cloned/.test(out), `and it says what it did, got: ${out}`);
    cleanup(world.root);
  });

  await test('an EMPTY repo clones fine, and the warning it prints is not an error', () => {
    // A repo GitHub just created has no commit. git clones it with a warning on
    // stderr and no branch checked out — the ordinary first-setup case.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out, err } = inHome(world, 'wk_home_clone owner/workkit');
    assertEq(code, 0, `exit 0 — ${out}${err}`);
    assert(!/warning/i.test(out), `the warning is swallowed, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, '.git')), 'and the clone is there to seed');
    cleanup(world.root);
  });

  await test('a folder already at that path stops the home steps, whatever it is', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'someone-elses.txt'), 'mine\n');

    const { out } = inHome(world, 'rc=0; wk_home_clone owner/workkit || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/rc=3/.test(out), `the caller is told to stop, got: ${out}`);
    assert(/move it aside/.test(out), 'and nothing was converted');
    assert(fs.existsSync(path.join(world.tower, 'someone-elses.txt')), 'the folder is exactly as it was');
    assert(!fs.existsSync(path.join(world.tower, '.git')), 'and was never git init’d');
    cleanup(world.root);
  });

  await test('a repo pointing at ANOTHER remote is named and left alone', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);

    const { out } = inHome(world, 'rc=0; wk_home_clone owner/workkit || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/rc=3/.test(out), `the caller is told to stop, got: ${out}`);
    assert(/pointing at/.test(out), `it names what it found, got: ${out}`);
    assertEq(
      spawnSync('git', ['-C', world.tower, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim(),
      theirs,
      'the other remote is exactly as it was',
    );
    cleanup(world.root);
  });

  group('workflow/home: the seed');

  await test('the tower app becomes the project, minus everything a checkout accretes', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    const { code, out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    assertEq(code, 0, `exit 0 — ${out}`);

    assert(fs.existsSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html')), 'the app travels');
    assert(fs.existsSync(path.join(world.tower, 'config', 'omega.json5')), 'and the brand config');
    assert(fs.existsSync(path.join(world.tower, 'README.md')), 'the project’s README is its own doc, so it travels too');
    assert(fs.existsSync(path.join(world.tower, 'AGENTS.md')), 'and its AGENTS.md');

    assert(!fs.existsSync(path.join(world.tower, 'node_modules')), 'the installed dependencies do not');
    assert(!fs.existsSync(path.join(world.tower, 'apps', 'web', 'node_modules')), 'at any depth');
    assert(!fs.existsSync(path.join(world.tower, 'package-lock.json')), 'nor the lockfile');
    assert(!fs.existsSync(path.join(world.tower, '.omega')), 'nor the omega run machinery');
    assert(!fs.existsSync(path.join(world.tower, 'apps', 'web', 'dist')), 'nor a stale build');
    assert(/seeded the tower project/.test(out), `and it says what it did, got: ${out}`);
    cleanup(world.root);
  });

  await test('every file: spec is rewritten to the absolute path it resolved to', () => {
    // The relative spec counts directories up from tower/app and is nonsense
    // from ~/.workkit/tower. Committing the absolute path is the local-era
    // acceptance the omega brand monorepo already makes for itself.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    assertEq(
      world.pkg().devDependencies['@omega.js/manager'],
      `file:${path.join(world.framework, 'manager')}`,
      'the root manifest points at the framework this machine resolves it from',
    );
    assertEq(
      world.pkg(path.join('apps', 'web', 'package.json')).dependencies['@omega.js/web'],
      `file:${path.join(world.framework, 'web')}`,
      'and so does every app, resolved from ITS own directory',
    );
    assert(/Local era/.test(world.pkg().description), 'the description says why the manifest names a path');
    cleanup(world.root);
  });

  await test('a spec nothing resolves is left alone and said out loud', () => {
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    cleanup(path.join(world.framework, 'manager'));

    const { out } = inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');
    assert(/@omega\.js\/manager still points at/.test(out), `it names the spec it could not resolve, got: ${out}`);
    assert(/file:\.\.\//.test(world.pkg().devDependencies['@omega.js/manager']), 'and the spec is untouched');
    cleanup(world.root);
  });

  await test('the seed is the app and nothing else — no config file, no .workkit', () => {
    // The clone is engine territory (issue #79): the site options are the
    // user's and live in the machine settings file, and the home repo is known
    // by path, so there is no opt-in to seed and no inbox to keep out.
    const world = mkWorld();
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed');

    assert(!fs.existsSync(path.join(world.tower, 'config', 'workkit.json')), 'no site options inside the project');
    assert(!fs.existsSync(path.join(world.tower, '.workkit')), 'and no .workkit/ folder at all');

    const ignore = fs.readFileSync(path.join(world.tower, '.gitignore'), 'utf8').split('\n');
    assert(ignore.includes('node_modules/'), 'the app’s own rules are kept');
    assert(ignore.includes('dist/'), 'build output included');
    assert(!ignore.some((l) => l.includes('.workkit')), `and nothing is ignored for a folder that never exists: ${ignore.join('\n')}`);
    cleanup(world.root);
  });

  await test('the first commit carries the project and none of the working files', () => {
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, [
      'wk_home_clone owner/workkit',
      'wk_home_seed',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): seed the tower project"',
    ].join('\n'));

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, 'apps', 'web', 'src', 'index.html')), 'the push landed the project');
    assert(fs.existsSync(path.join(check, 'config', 'omega.json5')), 'with the app’s own config');
    assert(!fs.existsSync(path.join(check, 'config', 'workkit.json')), 'and no site options of its own');
    assert(!fs.existsSync(path.join(check, '.workkit')), 'nor a .workkit/ folder in what a second machine clones');
    cleanup(world.root);
  });

  await test('a stray .workkit/ in the clone is never committed by the daily push', () => {
    // The clone carries no participation state, so anything under that name is
    // scratch someone or something left there — and an unattended commit must
    // not push it to the default branch (issue #79).
    const world = mkWorld();
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, [
      'wk_home_clone owner/workkit',
      'wk_home_seed',
      'wk_home_set_slug owner/workkit',
      'wk_home_commit_push "chore(home): seed the tower project"',
    ].join('\n'));

    fs.mkdirSync(path.join(world.tower, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(world.tower, '.workkit', 'scratch.md'), '- a stray note\n');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    inHome(world, 'wk_home_commit_push "chore(home): publish the site"');

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(/edited/.test(fs.readFileSync(path.join(check, 'README.md'), 'utf8')), 'the real change went');
    assert(!fs.existsSync(path.join(check, '.workkit')), 'and the scratchpad stayed home');
    assert(fs.existsSync(path.join(world.tower, '.workkit', 'scratch.md')), 'left where it was, not removed');
    cleanup(world.root);
  });

  group('workflow/home: the wizard');

  await test('setup creates the repo, clones it, seeds it, and records the slug', () => {
    const world = mkWorld({ login: 'owner' });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0 — ${out}`);

    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(calls.some((c) => c.includes('repo create owner/workkit --private')), `the private repo is created: ${fmtCalls(world.ghCalls())}`);
    assertEq(world.settings().home, 'owner/workkit', 'the home slug is recorded');
    assert(fs.existsSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html')), 'the project is seeded');
    assert(!fs.existsSync(path.join(world.tower, '.workkit')), 'and the clone carries no workflow folder of its own');

    assert(world.npmCalls().some((c) => c.join(' ').includes('install')), `the dependencies are installed once, here: ${fmtCalls(world.npmCalls())}`);
    assert(!fs.existsSync(path.join(world.workflowHome, '.git')), 'and ~/.workkit is still a plain folder');
    assert(!fs.existsSync(path.join(world.workflowHome, 'workkit.json')), 'with nothing versioned seeded beside it');
    assert(!fs.existsSync(path.join(world.workflowHome, '.gitignore')), 'and no ignore file of its own');

    const subject = spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assertEq(subject, 'chore(home): seed the tower project', 'the first commit says what it is');
    cleanup(world.root);
  });

  await test('a second setup finds the clone and re-seeds nothing', () => {
    const world = mkWorld({ login: 'owner', repoExists: true, discussionsOn: true, pagesOn: true });
    setup(world);
    fs.writeFileSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html'), '<html>edited here</html>\n');
    const head = spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout;

    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(!/created the private repo/.test(out), `nothing is created twice, got: ${out}`);
    assert(/is the clone of/.test(out), `it reports the clone it found, got: ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'apps', 'web', 'src', 'index.html'), 'utf8'),
      '<html>edited here</html>\n', 'and what the project already carried survives');
    assertEq(spawnSync('git', ['-C', world.tower, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout, head, 'the repo is untouched');
    cleanup(world.root);
  });

  await test('a clone another machine already seeded is left exactly as it is', () => {
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'README.md'), 'utf8'), '# from elsewhere\n',
      'the other machine’s project is the one here');
    assert(!fs.existsSync(path.join(world.tower, 'apps')), 'and nothing was seeded over it');
    assert(/already in/.test(out), `it says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a second machine installs the dependencies the project arrived without', () => {
    // The project travels in the repo; node_modules does not. Without the
    // install on this path a second machine can never build or publish.
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0 — ${out}`);
    assert(/installing the tower project's dependencies/.test(out), `it says what it is doing, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the build tooling is there afterwards');

    // Idempotent: an installed tree is a skip, not a second install.
    const again = setup(world);
    assert(/already installed/.test(again.out), `a second run costs nothing, got: ${again.out}`);
    assertEq(world.npmCalls().filter((c) => /install/.test(c)).length, 1, 'and npm ran exactly once');
    cleanup(world.root);
  });

  await test('without a terminal it says what a terminal run would do, and asks nothing', () => {
    const world = mkWorld({ login: 'owner' });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);

    const { code, out } = inHome(world, 'interactive() { return 1; }\nwk_home_setup');
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(/workkit setup/.test(out), `and hands over the command, got: ${out}`);
    assertEq(world.settings().home, undefined, 'a machine that never answered gets no home');
    assert(!fs.existsSync(world.tower), 'and nothing is cloned');
    cleanup(world.root);
  });

  await test('an answer that is not yes leaves everything alone', () => {
    const world = mkWorld({ login: 'owner' });
    const { out } = setup(world, { input: 'n\n' });
    assert(/left as it is/.test(out), `it says so, got: ${out}`);
    assertEq(world.settings().home, undefined, 'and no home is recorded');
    assert(!fs.existsSync(world.tower), 'nothing is cloned');
    cleanup(world.root);
  });

  await test('a gh that cannot say who you are points at the login command', () => {
    const world = mkWorld({ login: '' });
    const { code, out } = inHome(world, 'interactive() { return 0; }\nwk_home_setup');
    assertEq(code, 0, 'exit 0');
    assert(/gh auth login/.test(out), `it prints the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('something in the way stops setup before it writes anything', () => {
    const world = mkWorld({ login: 'owner' });
    fs.mkdirSync(world.tower, { recursive: true });
    fs.writeFileSync(path.join(world.tower, 'mine.txt'), 'mine\n');
    const { code, out } = setup(world);
    assertEq(code, 0, 'setup never dies mid-way');
    assert(/move it aside/.test(out), `it names what is in the way, got: ${out}`);
    assert(!/Discussions/.test(out), 'and no later step ran');
    assert(!fs.existsSync(path.join(world.tower, 'package.json')), 'nothing was seeded over it');
    cleanup(world.root);
  });

  await test('Discussions are enabled, and missing categories get a one-time pointer', () => {
    // GitHub has NO mutation that creates a discussion category — probed
    // against the live schema — so the only honest step is to name the page.
    const world = mkWorld({ login: 'owner', categories: ['General'] });
    const { code, out } = inHome(world, 'wk_home_discussions owner/workkit');
    assertEq(code, 0, 'exit 0');
    assert(/Discussions enabled/.test(out), `it turns them on, got: ${out}`);
    assert(/Daily, Weekly, Monthly/.test(out), 'names every category that is missing');
    assert(/discussions\/categories/.test(out), 'and the page that makes them');
    assert(/no API that creates one/.test(out), 'saying why it cannot do it itself');
    cleanup(world.root);
  });

  await test('Discussions already on are left alone', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { out } = inHome(world, 'wk_home_discussions owner/workkit');
    assert(/Discussions are on/.test(out), `it reports the state, got: ${out}`);
    const calls = world.ghCalls().map((c) => c.join(' '));
    assert(!calls.some((c) => c.includes('updateRepository')), `and never writes: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('Pages is asked for the gh-pages branch at its root, and a refusal warns with the fix', () => {
    const world = mkWorld({ login: 'owner' });
    const ok = inHome(world, 'wk_home_pages owner/workkit');
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('POST'));
    assert(posted && posted.includes('source[branch]=gh-pages'), `the branch that carries only the build: ${fmtCalls(world.ghCalls())}`);
    assert(posted.includes('source[path]=/'), 'served from its root, so no folder is named for a Pages rule');
    assert(!posted.includes('/docs'), 'and nothing on main is published at all');
    assert(/serves .* from gh-pages \//.test(ok.out), `and it says so, got: ${ok.out}`);

    const refused = mkWorld({ login: 'owner', pagesFails: true });
    const { code, out } = inHome(refused, 'wk_home_pages owner/workkit');
    assertEq(code, 0, 'a refusal never stops the wizard');
    assert(/paid plan/.test(out) && /settings\/pages/.test(out), `it warns with the fix, got: ${out}`);
    cleanup(world.root); cleanup(refused.root);
  });

  await test('setup creates no branch — the publish makes gh-pages when it first pushes', () => {
    // Issue #71's boundary: the wizard creates the repo, Discussions and Pages;
    // a branch is generated output and belongs to whatever generates it.
    const world = mkWorld({ login: 'owner' });
    setup(world);
    const branches = spawnSync('git', ['-C', world.tower, 'branch', '-a'], { encoding: 'utf8' }).stdout;
    assert(!/gh-pages/.test(branches), `no gh-pages anywhere yet: ${branches}`);
    cleanup(world.root);
  });

  group('workflow/discussions: posting and reading back');

  await test('a summary is posted, and the discussion URL comes back', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const body = path.join(world.root, 'summary.md');
    fs.writeFileSync(body, '## Went well\nA day.\n');
    const { code, out } = inHome(world, [
      'wk_disc_resolve_category owner/workkit Daily',
      `wk_disc_create owner/workkit "$WK_DISC_CATEGORY_ID" "daily: 2026-07-28" ${JSON.stringify(body)}`,
    ].join('\n'));
    assertEq(code, 0, 'exit 0');
    assert(/discussions\/3/.test(out), `the URL is what a caller logs, got: ${out}`);
    const posted = world.ghCalls().map((c) => c.join(' ')).find((c) => c.includes('createDiscussion'));
    assert(posted.includes(`body=@${body}`), `the body is sent from a file, never as an argument: ${posted}`);
    cleanup(world.root);
  });

  await test('a rollup reads prior summaries back, and the window is applied here', () => {
    // The API takes no date argument — only an order — so the period is a
    // filter on what came back, not a query the server ran.
    const world = mkWorld({ login: 'owner', discussionsOn: true });
    const { code, out } = inHome(world, 'wk_disc_list owner/workkit Daily 2026-07-21T00:00:00Z');
    assertEq(code, 0, 'exit 0');
    const listed = JSON.parse(out.trim());
    assertEq(listed.length, 1, `only the summaries inside the window: ${out}`);
    assertEq(listed[0].body, 'yesterday', 'and they carry their bodies for the rollup to read');
    cleanup(world.root);
  });

  await test('the resolution falls back to the default category, and says which', () => {
    const world = mkWorld({ login: 'owner', discussionsOn: true, categories: ['General'] });
    const { out } = inHome(world, 'wk_disc_resolve_category owner/workkit Weekly\nprintf "%s %s\\n" "$WK_DISC_CATEGORY_NAME" "$WK_DISC_CATEGORY_ID"');
    assert(/^General DIC_0$/m.test(out.trim()), `the caller learns both name and id, got: ${out}`);
    cleanup(world.root);
  });

  group('workflow/home: doctor');

  await test('no home configured is a notice naming the command', () => {
    const world = mkWorld();
    const { code, out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assertEq(code, 0, 'exit 0');
    assert(/home: not set/.test(out), `it says so, got: ${out}`);
    assert(/rc=0/.test(out), 'and counts as nothing needing attention');
    cleanup(world.root);
  });

  await test('a home named but nothing cloned needs attention', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/nothing is cloned at/.test(out), `it names the state, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a repo pointing at another remote is reported, never adopted', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/pointing at/.test(out) && /move it aside/.test(out), `it says what is in the way, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a plain folder in the way is reported for what it is', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    fs.mkdirSync(world.tower, { recursive: true });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/exists and is not a clone/.test(out), `it does not call a folder a repo, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a clone in step with its upstream is green', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is its clone/.test(out), `it reports the clone, got: ${out}`);
    assert(/rc=0/.test(out), 'and nothing needs attention');
    cleanup(world.root);
  });

  await test('a clone with unpushed commits says the daily publish will push them', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): a project edit');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/unpushed commits/.test(out), `it says what is waiting, got: ${out}`);
    assert(/rc=0/.test(out), 'which is not a problem to fix');
    cleanup(world.root);
  });

  await test('a clone behind its upstream is told which command catches it up', () => {
    const world = mkWorld({ settings: { version: 1, repos: {}, home: 'owner/workkit' } });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');

    // Someone else pushed. This machine only learns it on a fetch.
    const other = path.join(world.root, 'other');
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, from elsewhere\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');
    git(world.tower, 'fetch', '-q');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is behind/.test(out) && /pull --rebase/.test(out), `it names the fix, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
