// The shared prologue of the home suites beside this one, one lifecycle stage
// each. Every world is a scratch HOME and ~/.workkit, a `gh` shim answering with
// canned JSON, a local bare repo as the remote, and a tower app fixture
// (WORKKIT_TOWER_APP) with no omega, install or build. A verb of workflow/home.js
// is asked of that program, the way the command asks it; any other step is
// asked of its workflow/home/ file in a node of the world's own.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// Aliased: `seeded` here is the runner-seeded world below.
const {
  expect, mkTmp, run, start, seeded: seedOnce,
} = require('../../lib/harness');
const { SYSTEM_PATH, NODE_DIR, homeEnv, stubToolJs, joinPath } = require('../../lib/platform');
const { recordArgvJs, readArgv } = require('../../lib/argv-log');
const { writeGh } = require('../../lib/gh-stub');
const { STAMP } = require('../../lib/version-stamp');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
// The plugin checkout the cloud brief's runner is seeded from: the real one,
// because the point of that seed is that the scripts a runner executes are these
// scripts. A fixture would prove only that files copy.
const KIT_DIR = path.join(__dirname, '..', '..', '..');
// The omega bin a tower tree holds: only its presence and its mode are read.
const OMEGA_BIN = '#!/usr/bin/env node\n';
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
 * checkout (or, given `registryPin`, that npm version instead), a target under
 * targets/web, and the accretions the seed must leave behind (node_modules at
 * both levels, a lockfile, .omega, dist, .claude).
 */
const mkTowerApp = (root, { registryPin = null } = {}) => {
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
    devDependencies: { '@omega.js/manager': registryPin || 'file:../../../omega/packages/manager' },
  });
  writeJson(path.join(app, 'targets', 'web', 'package.json'), {
    name: 'workkit-tower-web',
    private: true,
    dependencies: { '@omega.js/web': registryPin || 'file:../../../../../omega/packages/web' },
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
  fs.writeFileSync(path.join(app, 'node_modules', '.bin', 'omega'), OMEGA_BIN);
  fs.mkdirSync(path.join(app, 'targets', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(app, 'targets', 'web', 'node_modules', 'x.js'), 'nested\n');
  fs.writeFileSync(path.join(app, 'package-lock.json'), '{}\n');
  fs.mkdirSync(path.join(app, '.omega', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(app, '.omega', 'runs', 'one.json'), '{}\n');
  fs.mkdirSync(path.join(app, 'targets', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(app, 'targets', 'web', 'dist', 'index.html'), 'stale build\n');
  fs.mkdirSync(path.join(app, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(app, '.claude', 'settings.json'), '{}\n');

  return { app, framework };
};

/**
 * The world's fake npm, answering in its own process: the cwd recorded, one
 * path a line, and the calls counted, the bin linked from the `linksOn`th on
 * (0 never) under `--prefix` or, npm's own default, the cwd.
 * @returns {number} the exit code
 */
const answerNpm = ({ cwdLog, countFile, linksOn }, argv) => {
  fs.appendFileSync(cwdLog, `${process.cwd()}\n`);
  const prefix = argv[0] === '--prefix' ? argv[1] : process.cwd();
  const n = (fs.existsSync(countFile) ? Number(fs.readFileSync(countFile, 'utf8')) : 0) + 1;
  fs.writeFileSync(countFile, String(n));
  if (linksOn > 0 && n >= linksOn) {
    const bin = path.join(prefix, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'omega'), OMEGA_BIN);
    fs.chmodSync(path.join(bin, 'omega'), 0o755);
  }
  return 0;
};

/** The fake gh's `label create <name>`: its description and color flags, appended to the store. */
const createLabel = (labelsFile, argv) => {
  let description = '';
  let color = '';
  argv.forEach((arg, i) => {
    if (argv[i - 1] === '--description') description = arg;
    if (argv[i - 1] === '--color') color = arg;
  });
  const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
  labels.push({ name: argv[2], description, color });
  fs.writeFileSync(labelsFile, `${JSON.stringify(labels)}\n`);
};

/**
 * The categories the fake gh reads: a pending store moves in once its count of
 * further reads runs out, so the owner's page is answered by reads, never seconds.
 */
const readCategories = ({ categoriesFile, pendingFile, pendingReads }) => {
  if (fs.existsSync(pendingFile)) {
    const left = Number(fs.readFileSync(pendingReads, 'utf8'));
    if (left > 0) fs.writeFileSync(pendingReads, String(left - 1));
    else fs.renameSync(pendingFile, categoriesFile);
  }
  return fs.readFileSync(categoriesFile, 'utf8').replace(/\n+$/, '');
};

/** Whether `all` holds `first`, then `then` somewhere after it. */
const holdsInOrder = (all, first, then) => {
  const at = all.indexOf(first);
  return at >= 0 && all.includes(then, at + first.length);
};

/**
 * The world's fake gh, answering in its own process by the words its call
 * holds, the first match winning. The Pages calls are a GET (is it on?) then a
 * POST (turn it on), and the two answer apart.
 * @returns {number} the exit code
 */
const answerGh = (config, argv) => {
  const {
    login, repoExists, labelsFile, discussionsOn, pagesOn, pagesFails,
  } = config;
  const all = argv.join(' ');
  const say = (text) => { process.stdout.write(text); return 0; };
  if (all.includes('api user')) return say(`${login}\n`);
  if (all.includes('repo view')) return repoExists ? 0 : 1;
  if (all.includes('repo create')) return 0;
  if (all.includes('label list')) return say(fs.readFileSync(labelsFile, 'utf8'));
  if (all.includes('label create')) { createLabel(labelsFile, argv); return 0; }
  if (all.includes('label edit')) return 0;
  if (all.includes('updateRepository')) return say('{"data":{"updateRepository":{"repository":{"hasDiscussionsEnabled":true}}}}');
  if (all.includes('createDiscussion')) return say('{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/workkit/discussions/3"}}}}');
  if (all.includes('discussions(first')) {
    return say('{"data":{"repository":{"discussions":{"nodes":['
      + '{"title":"daily: 2026-07-27","createdAt":"2026-07-27T09:00:00Z","body":"yesterday"},'
      + '{"title":"daily: 2026-06-01","createdAt":"2026-06-01T09:00:00Z","body":"long ago"}]}}}}');
  }
  if (all.includes('discussionCategories')) {
    return say(`{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":${discussionsOn},"discussionCategories":{"nodes":[${readCategories(config)}]}}}}`);
  }
  if (pagesOn && all.includes('pages')) return 0;
  if (holdsInOrder(all, '-X POST', 'pages')) return pagesFails ? 1 : 0;
  if (all.includes('pages')) return 1;
  return say('{}');
};

/**
 * A scratch machine. `login` is who `gh api user` says you are; `repoExists`
 * decides whether `gh repo view` finds the home repo already; `discussionsOn`
 * and `categories` are what the Discussions API reports; `pagesOn` whether Pages
 * is already configured, and `pagesFails` whether enabling it is refused (the
 * private-repo-on-a-free-plan case). `registryPin` is the tower app fixture's
 * npm version for both framework packages, in place of its `file:` specs.
 */
const mkWorld = ({
  login = 'owner', repoExists = false, discussionsOn = false,
  categories = ['Daily', 'Weekly', 'Monthly', 'Brief'], pagesOn = false, pagesFails = false,
  settings = { version: 1, site: { repo: null, publish: false, url: null } }, remote = null, npmLinksOn = 1,
  registryPin = null,
} = {}) => {
  const root = mkTmp('workkit-home-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (settings !== null) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(path.join(workflowHome, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  }
  const tower = mkTowerApp(root, { registryPin });

  // npm is a shim throughout, so no install reaches the network. `npmLinksOn`
  // is which invocation links the workspace bin (1 ordinary, 2 a fresh tree, 0
  // never). The cwd is recorded beside the argv, one path a line: an install is
  // keyed from it.
  const npmLog = path.join(root, 'npm-argv.log');
  const npmCwdLog = path.join(root, 'npm-cwd.log');
  const npmCount = path.join(root, 'npm-count');
  const npmConfig = { cwdLog: npmCwdLog, countFile: npmCount, linksOn: npmLinksOn };
  stubToolJs(bin, 'npm', [
    recordArgvJs(JSON.stringify(npmLog)),
    `process.exitCode = require(${JSON.stringify(__filename)}).answerNpm(${JSON.stringify(npmConfig)}, process.argv.slice(2));`,
  ].join('\n'));

  const ghLog = path.join(root, 'gh-argv.log');
  // The labels the stub believes the repo carries: a store, not a fixture, so a
  // second heal of the clone can be asked whether it finds its own work.
  const labelsFile = path.join(root, 'labels.json');
  fs.writeFileSync(labelsFile, '[]\n');
  // The categories live in a file the shim reads on every call, because setup
  // asks twice: once, then again after the owner made them on the page it
  // opened. The opener stub below is how a test plays that owner.
  const asNodes = (names) => names.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
  const categoriesFile = path.join(root, 'categories.json');
  fs.writeFileSync(categoriesFile, asNodes(categories));
  // What the owner made on the page, held back until the shim has answered a
  // few more reads: a fixture that counts reads, never seconds, so a machine
  // where every stub in the chain costs a process spawn answers the same one.
  const pendingFile = path.join(root, 'categories-pending.json');
  const pendingReads = path.join(root, 'categories-pending-reads');
  writeGh(bin, {
    log: ghLog,
    answer: { module: __filename, name: 'answerGh' },
    config: {
      login, repoExists, labelsFile, discussionsOn, categoriesFile, pendingFile, pendingReads, pagesOn, pagesFails,
    },
  });

  // A browser opener that records what it was handed and, when a test says so,
  // plays the owner: it writes the categories into the store at once, or after
  // `afterReads` more reads (counted, never timed). Every world gets it, so a
  // real `/usr/bin/open` never opens a browser.
  const openerLog = path.join(root, 'opener-argv.log');
  // `breaks` plays a read that fails mid-poll (the network or the token gone):
  // the store stops being JSON, so every later read returns nothing.
  const installOpener = ({ makes = [], afterReads = 0, breaks = false } = {}) => {
    const made = JSON.stringify(breaks ? 'not json' : asNodes(makes));
    const write = afterReads
      ? [`fs.writeFileSync(${JSON.stringify(pendingFile)}, ${made});`,
        `fs.writeFileSync(${JSON.stringify(pendingReads)}, ${JSON.stringify(String(afterReads))});`]
      : [`fs.writeFileSync(${JSON.stringify(categoriesFile)}, ${made});`];
    for (const opener of ['open', 'xdg-open']) {
      stubToolJs(bin, opener, [
        "const fs = require('fs');",
        recordArgvJs(JSON.stringify(openerLog)),
        ...(makes.length || breaks ? write : []),
      ].join('\n'));
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
    // WORKFLOW_HOME native, for the node a case starts itself.
    env: homeEnv(home, {
      PATH: joinPath(bin, SYSTEM_PATH, NODE_DIR),
      WORKFLOW_HOME: workflowHome,
      WORKKIT_TOWER_APP: tower.app,
      // The kit the runner is read from is a committed copy, never this
      // checkout: the source reads HEAD, and this checkout's HEAD lags its edits.
      WORKKIT_KIT_DIR: mkKitRepo(root),
      ...(remote ? { WORKKIT_HOME_REMOTE: remote } : {}),
    }),
  };
};

/**
 * One verb of workflow/home.js in a node under the world's env, the way the
 * command hands one over: the caller's voice at its defaults. stdin is a pipe,
 * so any prompt that forgot its tty guard hangs the test rather than production.
 * @param {{root: string, env: object}} world
 * @param {string[]} args - the verb and its arguments (`['set-slug', 'owner/workkit']`)
 * @param {{input?: string}} [opts] - what the pipe holds
 * @returns {{code: number, out: string, err: string}}
 */
const inHome = (world, args, { input = '' } = {}) => {
  // From the world's own root, never the caller's: a shim that keys anything
  // off the cwd (as npm does) must key it off a scratch directory rather
  // than this checkout.
  const res = run(process.execPath, [path.join(WORKFLOW_DIR, 'home.js'), ...args], {
    cwd: world.root, env: { ...world.env, WK_LOG_STDERR: '0', WK_LOG_INDENT: '', QUIET: '0' }, input,
  });
  expect(res.status !== null, `home.js finished (no timeout): ${res.stderr}`).toBeTruthy();
  // `out` is both streams in the order a terminal shows them, since what these
  // tests read is what the user was told; `err` stays separate for the checks
  // about the stream.
  return { code: res.status, out: `${res.stdout}${res.stderr}`, err: res.stderr };
};

/**
 * The exit code a step's answer stands for: true 0, false 1, a number itself,
 * the sync's `{ code }` its code, anything else (a value, nothing) 0. Its source
 * also runs in the node `runHomeSteps` starts, so the two read an answer alike.
 */
const codeOf = (answer) => {
  if (answer === false) return 1;
  if (typeof answer === 'number') return answer;
  if (answer && typeof answer === 'object' && typeof answer.code === 'number') return answer.code;
  return 0;
};

// The node a step runs in: each `[file, name, args]` of argv[1] awaited in turn,
// stopping after the first whose answer is not 0 (the drivers' `set -e`), and the
// answers written to argv[2]. With argv[3] `1` its stdin is a terminal: the pipe
// fed through a stream that says it is a TTY, which is all a question asks of it.
const NODE_STEPS = [
  "const fs = require('fs');",
  'const [steps, answerFile, terminal] = process.argv.slice(1);',
  `const codeOf = ${codeOf};`,
  'let held = null;',
  "if (terminal === '1') {",
  "  const { PassThrough } = require('stream');",
  '  held = process.stdin;',
  '  const tty = Object.assign(new PassThrough(), { isTTY: true, setRawMode() { return this; } });',
  '  held.pipe(tty);',
  "  Object.defineProperty(process, 'stdin', { configurable: true, get: () => tty });",
  '}',
  '(async () => {',
  '  const answers = [];',
  '  for (const [file, name, args] of JSON.parse(steps)) {',
  '    const answer = await require(file)[name](...args);',
  '    answers.push(answer === undefined ? null : answer);',
  '    if (codeOf(answer) !== 0) break;',
  '  }',
  '  fs.writeFileSync(answerFile, JSON.stringify(answers));',
  '  if (held) held.destroy();',
  '})();',
].join('\n');

let stepRuns = 0;

/** The argv of a NODE_STEPS node over `steps`, and the file its answers land in. */
const stepCall = (world, steps, terminal) => {
  stepRuns += 1;
  const answerFile = path.join(world.root, `steps-${stepRuns}.json`);
  const resolved = steps.map(([file, name, args = []]) => [path.join(WORKFLOW_DIR, 'home', `${file}.js`), name, args]);
  return { answerFile, argv: ['-e', NODE_STEPS, JSON.stringify(resolved), answerFile, terminal ? '1' : '0'] };
};

/** inHome's shape from a finished step node: its answers, the last one's code. */
const stepsResult = (status, stdout, stderr, answerFile) => {
  expect(status === 0 && fs.existsSync(answerFile), `the steps answered (exit ${status}): ${stdout}${stderr}`).toBeTruthy();
  const answers = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
  return {
    code: codeOf(answers[answers.length - 1]), answers, out: `${stdout}${stderr}`, err: stderr,
  };
};

/**
 * Run home's steps in a node under the world's env, from its root, the way
 * inHome runs a line of shell: `steps` is a list of `[file, name, args]`, `file`
 * a workflow/home/ stem (`repo`). `terminal` gives the node a terminal for its
 * stdin, `input` what is typed there.
 * @returns {{code: number, answers: Array, out: string, err: string}}
 */
const runHomeSteps = (world, steps, { input = '', terminal = false } = {}) => {
  const { answerFile, argv } = stepCall(world, steps, terminal);
  const res = run(process.execPath, argv, { cwd: world.root, env: world.env, input });
  return stepsResult(res.status, res.stdout, res.stderr, answerFile);
};

/**
 * runHomeStepsHeld's node, started and not waited on: `call` the harness handle a
 * case may end, `result()` the finished steps once it exits.
 * @returns {{call: object, result: () => Promise<{code: number, answers: Array, out: string, err: string}>}}
 */
const startHomeStepsHeld = (world, steps, { input = '' } = {}) => {
  const { answerFile, argv } = stepCall(world, steps, true);
  const call = start(process.execPath, argv, {
    cwd: world.root, env: world.env, input, stdin: 'open',
  });
  const result = async () => {
    const { status } = await call.done;
    call.child.stdin.end();
    return stepsResult(status, call.stdout(), call.stderr(), answerFile);
  };
  return { call, result };
};

/**
 * runHomeSteps at a terminal whose stdin stays open after `input` until the steps are
 * done: a key that never comes is a wait, never a close.
 * @returns {Promise<{code: number, answers: Array, out: string, err: string}>}
 */
const runHomeStepsHeld = (world, steps, options) => startHomeStepsHeld(world, steps, options).result();

/** A full setup at a terminal, answered with `input`, against a world whose remote is an empty bare repo. */
const setup = (world, { input = 'y\n' } = {}) => {
  if (!world.env.WORKKIT_HOME_REMOTE) {
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
  }
  return runHomeSteps(world, [['wizard', 'setup']], { input, terminal: true });
};

// The cloud brief runner's fixtures, shared by the runner, version stamp and
// doctor suites.

// The runner list's home, under a kit folder.
const RUNNER_FILES = path.join('workflow', 'home', 'runner-files.js');

/** The list a runner-files.js module holds: the module itself, or the one array it exports. */
const listOf = (loaded) => (Array.isArray(loaded) ? loaded : Object.values(loaded).find(Array.isArray));

/** The src:dest pairs the library ships, read from it rather than restated. */
const runnerPairs = () => {
  const list = listOf(require(path.join(KIT_DIR, RUNNER_FILES)));
  expect(Array.isArray(list) && list.length > 0, `${RUNNER_FILES} holds the list`).toBeTruthy();
  return list.map(([src, dest]) => ({ src, dest }));
};

/** The world's home cloned, then the runner seeded through home.js, its code the seed's. */
const seeded = (world) => {
  if (!world.env.WORKKIT_HOME_REMOTE) world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
  const cloned = runHomeSteps(world, [['repo', 'clone', ['owner/workkit']]]);
  if (cloned.code !== 0) return cloned;
  const res = inHome(world, ['seed-runner']);
  return { code: res.code, out: `${cloned.out}${res.out}`, err: `${cloned.err}${res.err}` };
};

/** Every file under this checkout's workflow/ folder, relative to the kit. */
const workflowFiles = () => fs.readdirSync(WORKFLOW_DIR, { recursive: true })
  .map((rel) => path.join('workflow', rel))
  .filter((rel) => fs.statSync(path.join(KIT_DIR, rel)).isFile());

/**
 * A copy of this checkout's runner sources and its whole workflow/ folder (the
 * heal's standards.js, its siblings, forms and labels), so a test can change
 * one of them. The drift a later setup exists to heal is drift in the
 * checkout, and the real one is not a test's to edit.
 */
const mkKitCopy = (root, name = 'kit-copy') => {
  const kit = path.join(root, name);
  const srcs = new Set([...runnerPairs().map(({ src }) => path.normalize(src)), ...workflowFiles()]);
  for (const src of srcs) {
    const dest = path.join(kit, src);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, src), dest);
  }
  return kit;
};

/** One commit of everything in a kit copy, by a throwaway identity. */
const commitKit = (kit, subject) => {
  git(kit, 'add', '-A');
  const res = git(kit, '-c', 'user.name=kit', '-c', 'user.email=kit@localhost', 'commit', '-q', '-m', subject);
  expect(res.status === 0, `the kit copy committed: ${res.stdout}${res.stderr}`).toBeTruthy();
};

// The folder a world's committed kit sits in, under the world's root.
const KIT_REPO = 'kit-repo';

// Built once per process and copied per world: the git init and commit are
// the cost a world would repeat. Packed, so a copy is a few files, not one per
// object.
const copyKitRepo = seedOnce((seed) => {
  const kit = mkKitCopy(seed, KIT_REPO);
  const manifest = path.join('.claude-plugin', 'plugin.json');
  fs.mkdirSync(path.join(kit, '.claude-plugin'), { recursive: true });
  fs.copyFileSync(path.join(KIT_DIR, manifest), path.join(kit, manifest));
  git(kit, 'init', '-q', '-b', 'main');
  commitKit(kit, 'chore: the kit');
  git(kit, 'repack', '-adq');
});

/**
 * A kit copy a git repo tracks: the runner sources, the workflow/ folder and
 * the plugin manifest (the stamp's version) as they sit on disk, committed on
 * main. The development checkout's shape, where the committed tree and the
 * folder can differ.
 */
const mkKitRepo = (root) => {
  copyKitRepo(root);
  return path.join(root, KIT_REPO);
};

/** A file as the world's kit committed it: what the runner is read from. */
const kitCommitted = (world, src) => {
  const res = git(world.env.WORKKIT_KIT_DIR, 'show', `HEAD:${src}`);
  expect(res.status === 0, `${src} is in the kit's HEAD: ${res.stderr}`).toBeTruthy();
  return res.stdout;
};

/** Drop the pair whose source is `src` from a kit copy's runner list, on disk only: its one line. */
const dropRunnerLine = (kit, src) => {
  const file = path.join(kit, RUNNER_FILES);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter((l) => ![`['${src}',`, `["${src}",`].some((lead) => l.trim().startsWith(lead)));
  expect(kept.length === lines.length - 1, `the kit's list named ${src} once, on a line of its own`).toBeTruthy();
  fs.writeFileSync(file, kept.join('\n'));
};

module.exports = {
  WORKFLOW_DIR, KIT_DIR, cleanup, git, mkRemote, mkWorld, inHome, runHomeSteps, runHomeStepsHeld, startHomeStepsHeld, setup, runnerPairs, seeded,
  mkKitCopy, mkKitRepo, commitKit, kitCommitted, dropRunnerLine, STAMP, answerNpm, answerGh,
};
