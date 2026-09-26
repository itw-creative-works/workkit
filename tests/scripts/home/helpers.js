//
// The shared prologue of the workflow/home.sh suites, the `*.test.js` files
// beside this one, which test the home repo's lifecycle (issues #27, #77) one
// stage each. A plain module, never a suite: the runner only loads files
// ending in `.test.js`.
//
// Every world is a scratch HOME with a scratch ~/.workkit (WORKFLOW_HOME) and a
// `gh` shim that answers `api user`, `repo view`, `repo create` and the
// Discussions/Pages calls with canned JSON. The REMOTE is a local bare repo
// (WORKKIT_HOME_REMOTE), so every clone, fetch and push in this suite runs
// against a directory on this machine: nothing here reaches GitHub, and nothing
// here touches the real ~/.workkit.
//
// The tower app the seed copies is a FIXTURE (WORKKIT_TOWER_APP) shaped like the
// real one: a brand root with targets/web, config/, a .gitignore, and file: specs
// pointing at a fake sibling framework. No omega, no npm install, no build.
//
// The library is sourced by a one-line driver rather than executed: it is a
// library, and the shell it is asked its questions in is the one the CLI and
// the heal ask them in.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert } = require('../../lib/harness');
const { BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, stubTool, joinPath } = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
// The plugin checkout the cloud brief's runner is seeded FROM (issue #91). The
// real one, because the point of that seed is that the scripts a runner
// executes are these scripts: a fixture would prove only that files copy.
const KIT_DIR = path.join(__dirname, '..', '..', '..');
const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-home-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/**
 * A bare repo standing in for the one on GitHub, with an initial commit when
 * `seed` is given: the difference between a repo just created (empty) and one
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
 * The tower app the seed copies from, the real one's shape without its weight:
 * a brand root whose manifests carry `file:` specs into a sibling framework
 * checkout, a target under targets/web, and the accretions the seed must leave
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
  fs.writeFileSync(path.join(app, '.gitignore'), 'node_modules/\npackage-lock.json\ndist/\n.omega/\n');
  fs.writeFileSync(path.join(app, 'README.md'), '# the tower\n');
  fs.writeFileSync(path.join(app, 'AGENTS.md'), '# the tower: architecture\n');
  fs.mkdirSync(path.join(app, 'config'), { recursive: true });
  fs.writeFileSync(path.join(app, 'config', 'omega.json5'), '{ brand: { id: "workkit" } }\n');
  fs.mkdirSync(path.join(app, 'targets', 'web', 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'targets', 'web', 'src', 'index.html'), '<html></html>\n');

  // Everything a working checkout accretes and a seed must not carry.
  fs.mkdirSync(path.join(app, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(app, 'targets', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(app, 'targets', 'web', 'node_modules', 'x.js'), 'nested\n');
  fs.writeFileSync(path.join(app, 'package-lock.json'), '{}\n');
  fs.mkdirSync(path.join(app, '.omega', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(app, '.omega', 'runs', 'one.json'), '{}\n');
  fs.mkdirSync(path.join(app, 'targets', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(app, 'targets', 'web', 'dist', 'index.html'), 'stale build\n');

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
  categories = ['Daily', 'Weekly', 'Monthly', 'Brief'], pagesOn = false, pagesFails = false,
  settings = { version: 1, site: { repo: null, publish: false, url: null } }, remote = null, npmLinksOn = 1,
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
  // `npmLinksOn` is which invocation links the workspace bin: 1 is the ordinary
  // machine, 2 is the fresh tree npm needs two passes on, and 0 never links.
  // The CWD is recorded beside the argv, one path a line: that is what an
  // install is keyed from (issue #171), and a path out of mkdtemp holds no
  // newline, so a line is framing enough here.
  const npmLog = path.join(root, 'npm-argv.log');
  const npmCwdLog = path.join(root, 'npm-cwd.log');
  const npmCount = path.join(root, 'npm-count');
  stubTool(bin, 'npm', [
    '#!/usr/bin/env bash',
    recordArgv(npmLog),
    `printf '%s\\n' "$PWD" >> ${JSON.stringify(npmCwdLog)}`,
    // npm's own default: no --prefix means the project is the cwd.
    'prefix="$PWD"',
    'if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi',
    `n=$(( $(cat ${JSON.stringify(npmCount)} 2>/dev/null || printf 0) + 1 ))`,
    `printf '%s' "$n" > ${JSON.stringify(npmCount)}`,
    `if [[ "$n" -ge ${npmLinksOn} && ${npmLinksOn} -gt 0 ]]; then`,
    '  mkdir -p "$prefix/node_modules/.bin"',
    '  printf \'#!/bin/sh\\n\' > "$prefix/node_modules/.bin/omega"',
    '  chmod +x "$prefix/node_modules/.bin/omega"',
    'fi',
    'exit 0',
  ]);

  const ghLog = path.join(root, 'gh-argv.log');
  // The labels the stub believes the repo carries: a STORE, not a fixture, so
  // the clone's heal can be asked the question that matters: does a second run
  // find its own work and create nothing (issue #123)?
  const labelsFile = path.join(root, 'labels.json');
  fs.writeFileSync(labelsFile, '[]\n');
  // The categories live in a FILE the shim reads on every call, because setup
  // asks twice (issue #244): once, then again after the owner made them on the
  // page it opened. The opener stub below is how a test plays that owner.
  const asNodes = (names) => names.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
  const categoriesFile = path.join(root, 'categories.json');
  fs.writeFileSync(categoriesFile, asNodes(categories));
  // What the owner made on the page, held back until the shim has answered a
  // few more reads: a fixture that counts READS, never seconds, so a machine
  // where every stub in the chain costs a process spawn answers the same one.
  const pendingFile = path.join(root, 'categories-pending.json');
  const pendingReads = path.join(root, 'categories-pending-reads');
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    'all="$*"',
    'case "$all" in',
    `  *"api user"*) printf '%s\\n' '${login}' ;;`,
    `  *"repo view"*) exit ${repoExists ? 0 : 1} ;;`,
    '  *"repo create"*) exit 0 ;;',
    `  *"label list"*) cat ${JSON.stringify(labelsFile)} ;;`,
    '  *"label create"*)',
    '    name="$3"; desc=""; color=""; prev=""',
    '    for a in "$@"; do',
    '      case "$prev" in --description) desc="$a" ;; --color) color="$a" ;; esac',
    '      prev="$a"',
    '    done',
    `    jq --arg n "$name" --arg d "$desc" --arg c "$color" '. + [{name:$n,description:$d,color:$c}]' `
      + `${JSON.stringify(labelsFile)} > ${JSON.stringify(`${labelsFile}.tmp`)}`
      + ` && mv ${JSON.stringify(`${labelsFile}.tmp`)} ${JSON.stringify(labelsFile)} ;;`,
    '  *"label edit"*) exit 0 ;;',
    `  *updateRepository*) printf '%s' '{"data":{"updateRepository":{"repository":{"hasDiscussionsEnabled":true}}}}' ;;`,
    '  *createDiscussion*)',
    `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/workkit/discussions/3"}}}}' ;;`,
    '  *"discussions(first"*)',
    `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[`
      + `{"title":"daily: 2026-07-27","createdAt":"2026-07-27T09:00:00Z","body":"yesterday"},`
      + `{"title":"daily: 2026-06-01","createdAt":"2026-06-01T09:00:00Z","body":"long ago"}]}}}}' ;;`,
    '  *discussionCategories*)',
    `    if [[ -f ${JSON.stringify(pendingFile)} ]]; then`,
    `      left=$(cat ${JSON.stringify(pendingReads)})`,
    '      if [[ "$left" -gt 0 ]]; then',
    `        printf '%s' "$(( left - 1 ))" > ${JSON.stringify(pendingReads)}`,
    '      else',
    `        mv ${JSON.stringify(pendingFile)} ${JSON.stringify(categoriesFile)}`,
    '      fi',
    '    fi',
    `    printf '%s' "{\\"data\\":{\\"repository\\":{\\"id\\":\\"R_kdt\\",\\"hasDiscussionsEnabled\\":${discussionsOn},\\"discussionCategories\\":{\\"nodes\\":[$(cat ${JSON.stringify(categoriesFile)})]}}}}" ;;`,
    `  *"pages"*) exit ${pagesOn ? 0 : (pagesFails ? 1 : 0)} ;;`,
    `  *) printf '%s' '{}' ;;`,
    'esac',
    'exit 0',
  ]);

  // The Pages calls are a GET (is it on?) then a POST (turn it on), and the two
  // must be able to answer differently.
  if (!pagesOn) {
    stubTool(bin, 'gh', fs.readFileSync(path.join(bin, 'gh'), 'utf8').replace(
      `  *"pages"*) exit ${pagesFails ? 1 : 0} ;;`,
      [
        '  *"-X POST"*pages*)',
        `    exit ${pagesFails ? 1 : 0} ;;`,
        '  *pages*) exit 1 ;;',
      ].join('\n'),
    ).trimEnd().split('\n'));
  }

  // A browser opener that records what it was handed and, when a test says
  // so, plays the owner: the page it "opened" is where the categories get
  // made, so it writes them into the store the gh shim answers from, at once
  // or held back for `afterReads` more reads (an owner still clicking while
  // the poll runs). The wait is COUNTED, not timed: the next `afterReads`
  // checks still miss the categories and the one after that finds them,
  // whatever each check costs on the machine running it.
  // Every world gets the recorders: the base PATH keeps `/usr/bin/open` real
  // on a Mac, and a step that reached it unshadowed would open a browser.
  const openerLog = path.join(root, 'opener-argv.log');
  // `breaks` plays a read that fails mid-poll (the network or the token gone):
  // the store stops being JSON, so every later read returns nothing.
  const installOpener = ({ makes = [], afterReads = 0, breaks = false } = {}) => {
    const made = JSON.stringify(breaks ? 'not json' : asNodes(makes));
    const write = afterReads
      ? [`printf '%s' ${made} > ${JSON.stringify(pendingFile)}`,
        `printf '%s' ${afterReads} > ${JSON.stringify(pendingReads)}`]
      : [`printf '%s' ${made} > ${JSON.stringify(categoriesFile)}`];
    for (const opener of ['open', 'xdg-open']) {
      stubTool(bin, opener, [
        '#!/usr/bin/env bash',
        recordArgv(openerLog),
        ...(makes.length || breaks ? write : []),
        'exit 0',
      ]);
    }
  };
  installOpener();

  return {
    root,
    home,
    workflowHome,
    installOpener,
    openerCalls: () => readArgv(openerLog),
    tower: path.join(workflowHome, 'tower'),
    towerApp: tower.app,
    framework: tower.framework,
    remote: remote === null ? null : remote,
    ghCalls: () => readArgv(ghLog),
    labels: () => JSON.parse(fs.readFileSync(labelsFile, 'utf8')),
    npmCalls: () => readArgv(npmLog),
    npmCwds: () => (fs.existsSync(npmCwdLog)
      ? fs.readFileSync(npmCwdLog, 'utf8').trim().split('\n').filter(Boolean)
      : []),
    settings: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'settings.json'), 'utf8')),
    pkg: (rel = 'package.json') => JSON.parse(fs.readFileSync(path.join(workflowHome, 'tower', rel), 'utf8')),
    env: homeEnv(home, {
      PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: shellPath(workflowHome),
      WORKKIT_TOWER_APP: tower.app,
      WORKKIT_KIT_DIR: KIT_DIR,
      ...(remote ? { WORKKIT_HOME_REMOTE: remote } : {}),
    }),
  };
};

/**
 * Source the library and run one line of shell in it: how every caller uses
 * it. stdin is a pipe, so any prompt that forgot its tty guard hangs the test
 * rather than production.
 */
const inHome = (world, script, { input = '' } = {}) => {
  const driver = [
    'set -euo pipefail',
    `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'lib.sh')))}`,
    `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'discussions.sh')))}`,
    `. ${JSON.stringify(shellPath(path.join(WORKFLOW_DIR, 'home.sh')))}`,
    script,
  ].join('\n');
  // From the world's own root, never the caller's: a shim that keys anything
  // off the cwd (as npm does) must key it off a scratch directory rather
  // than this checkout.
  const res = spawnSync(BASH, [...NO_RC, '-c', driver], {
    cwd: world.root, env: world.env, input, encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  // `out` is the whole transcript, both streams in the order a terminal shows
  // them: the library prints an action on stdout and a warning on stderr
  // (issue #237), and what these tests read is what the user was told. `err`
  // stays separate for the checks that are about the STREAM.
  return {
    code: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    err: res.stderr || '',
  };
};

/** A full setup run against a world whose remote is an empty bare repo. */
const setup = (world, { input = 'y\n' } = {}) => {
  if (!world.env.WORKKIT_HOME_REMOTE) {
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
  }
  return inHome(world, 'interactive() { return 0; }\nwk_home_setup', { input });
};

// The cloud brief runner's fixtures, shared by the runner, version stamp and
// doctor suites.

/** The src:dest pairs the library ships, read from it rather than restated. */
const runnerPairs = () => fs.readFileSync(path.join(WORKFLOW_DIR, 'home.sh'), 'utf8')
  .split('\n')
  .map((l) => l.trim().match(/^'(\S+):(\S+)'$/))
  .filter(Boolean)
  .map((m) => ({ src: m[1], dest: m[2] }));

const seeded = (world) => {
  if (!world.env.WORKKIT_HOME_REMOTE) world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
  return inHome(world, 'wk_home_clone owner/workkit\nrc=0\nwk_home_seed_runner || rc=$?\nprintf "rc=%s\\n" "$rc"');
};

/**
 * A COPY of this checkout's runner sources, so a test can change one of them.
 * The drift a later setup exists to heal is drift in the checkout, and the
 * real one is not a test's to edit.
 */
const mkKitCopy = (root) => {
  const kit = path.join(root, 'kit-copy');
  for (const { src } of runnerPairs()) {
    const dest = path.join(kit, src);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, src), dest);
  }
  return kit;
};

/** Where the stamp lives and what it is called: the name IS the contract. */
const STAMP = '.workkit-version';

module.exports = {
  WORKFLOW_DIR, KIT_DIR, cleanup, git, mkRemote, mkWorld, inHome, setup, runnerPairs, seeded, mkKitCopy, STAMP,
};
