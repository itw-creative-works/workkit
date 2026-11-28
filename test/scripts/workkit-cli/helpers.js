// The shared prologue of the workflow/workkit.js suites beside this one, which
// test the one command. Every world is a scratch HOME with `launchctl`,
// `schtasks`, `claude` and `gh` recorders on PATH, so the suite reads what would
// be installed and which commands would have run; WORKFLOW_HOME and
// WORKFLOW_CLAUDE_HOME point at the same scratch tree. The command is started as
// workflow/workkit.js by the running node, and one step of it is called in a node
// of its own (`inNode`).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  expect, start, WORKKIT_DIR: W, mkTmp, SPAWN_DEADLINE, seeded,
} = require('../../lib/harness');
const {
  SYSTEM_PATH, NODE_DIR, which, nodeHomeEnv, nodeTempEnv, stubToolJs, linkTool, joinPath, gitPath, spawnSync: runSync,
} = require('../../lib/platform');
const { recordArgvJs, readArgv } = require('../../lib/argv-log');
const { schtasksStub } = require('../../lib/schtasks-stub');
const { mkPluginCopy } = require('../../lib/plugin-copy');
const { mkOriginRepo, OPT_IN_SHAPES } = require('../../lib/git-repo');
const { copySettingsKit } = require('../../lib/settings-kit');
const { writeLogin } = require('../../lib/identity');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const KIT_ROOT = path.dirname(WORKFLOW_DIR);
const CLI = path.join(WORKFLOW_DIR, 'workkit.js');
const JOBS_INSTALL = path.join(KIT_ROOT, 'jobs', 'install.js');
const LABEL = 'com.workkit.claude-daily';

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The issue's table, in its order: each kit command and the permission its rule
// lands in. Typed here, never read from workflow/, so the list is checked against it.
const COMMAND_TABLE = [
  ['help', 'allow'], ['setup', 'allow'], ['update', 'allow'], ['doctor', 'allow'],
  ['publish', 'allow'], ['brief', 'allow'], ['log', 'allow'],
  ['test', 'none'],
  ['tools', 'allow'], ['convert', 'allow'], ['public', 'allow'],
  ['ship items', 'allow'], ['ship release', 'allow'], ['ship watch', 'allow'],
  ['ship cut', 'allow'], ['ship plan', 'allow'], ['ship publish', 'allow'],
  ['ship deploy', 'ask'],
  ['review', 'allow'], ['triage', 'allow'], ['checkpoint', 'allow'],
  ['proof red', 'none'],
  ['changelog', 'allow'], ['tower', 'none'], ['enable', 'allow'], ['decline', 'allow'],
  ['heal', 'allow'], ['state', 'allow'], ['note', 'allow'],
  ['prove', 'none'], ['supervise', 'none'],
  ['watch', 'allow'],
];

// The stand-in source line that records the call's own arguments to `logFile`.
const recordCall = (logFile) => recordArgvJs(JSON.stringify(logFile));

// A kit file a scratch kit holds in place of the real one, started by `node <file>`.
const writeKitFile = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
};

// A secret listing as `gh secret list --json name,updatedAt` renders it. `days`
// is how long ago the secret was last set: the only thing the age check reads.
const secretList = (secrets) => JSON.stringify(secrets.map(({ name, days }) => ({
  name,
  updatedAt: new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z'),
})));

/** A folder under `root` holding this suite's node and nothing else, for a PATH. */
const nodeOnly = (root) => {
  const dir = path.join(root, 'node-only');
  fs.mkdirSync(dir, { recursive: true });
  linkTool(dir, process.execPath);
  return dir;
};

/**
 * A scratch machine. `claude` reports the plugin as installed or not, `gh auth
 * status` succeeds or fails, `launchctl print` answers "not loaded", and
 * `binOnPath` puts ~/.local/bin on PATH. `secrets` is the home repo's secret
 * listing (null: an unreadable repo); what a `secret set` got on stdin is kept.
 * `claudeToken` is what a stub `claude setup-token` prints, drawing the whole
 * screen with the token last; `mintExit` is a mint that did not finish.
 * `pagesRef` and `pagesBuilds` answer the token handover's reads, one
 * `[status, commit]` per poll with the last repeating. `login` is who `gh api
 * user` says you are; absent, the stub's exit with nothing printed. Both
 * openers record and copy the page they were handed, so no real browser opens.
 */
const mkWorld = ({
  pluginInstalled = false, ghAuthed = true, claude = true, binOnPath = false,
  secrets = null, authToken = '', claudeToken = '', mintExit = 0,
  pagesRef = '', pagesBuilds = [], login = '',
} = {}) => {
  const root = mkTmp('workkit-cli-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });

  const launchctlLog = path.join(root, 'launchctl-argv.log');
  stubToolJs(bin, 'launchctl', [recordCall(launchctlLog), "process.exitCode = process.argv[2] === 'print' ? 1 : 0;"].join('\n'));
  // A run of the real installer on Windows registers through this, never the machine's.
  schtasksStub(bin);

  const claudeLog = path.join(root, 'claude-argv.log');
  if (claude) {
    stubToolJs(bin, 'claude', [
      recordCall(claudeLog),
      'const args = process.argv.slice(2);',
      "if (args[0] === 'plugin' && args[1] === 'list') {",
      `  process.stdout.write(${JSON.stringify(`${pluginInstalled ? '[{ "id": "workkit@workkit" }]' : '[]'}\n`)});`,
      '}',
      "if (args[0] === 'setup-token') {",
      "  process.stderr.write('Opening your browser to approve this token…\\n');",
      `  process.stdout.write(${JSON.stringify(`Paste the authorization code here:\n${claudeToken ? `${claudeToken}\n` : ''}`)});`,
      `  process.exitCode = ${mintExit};`,
      '}',
    ].join('\n'));
  }

  const ghLog = path.join(root, 'gh-argv.log');
  const stdinDir = path.join(root, 'gh-stdin');
  fs.mkdirSync(stdinDir, { recursive: true });
  // How far through the Pages answers this world has been read: the stand-in is
  // a fresh process per poll, so the count has to live on disk for the second
  // answer to differ from the first.
  const pollCount = path.join(root, 'pages-polls');
  const ghAnswers = {
    stdinDir,
    pollCount,
    builds: pagesBuilds.map(([status, commit]) => `${status}\t${commit}`),
    // Shaped like the live tool, which answers JSON only when asked for it: the
    // secrets wizard reads `--json name,updatedAt`, and the brief dispatch reads
    // the plain listing, one `NAME<tab>Updated <date>` per line.
    secretsJson: secrets && `${secretList(secrets)}\n`,
    secretsPlain: secrets && (secrets.length ? secrets.map(({ name }) => `${name}\tUpdated 2026-07-01\n`).join('') : '\n'),
    login,
    authToken,
    pagesRef,
    authed: ghAuthed,
  };
  stubToolJs(bin, 'gh', [
    "const fs = require('fs');",
    "const path = require('path');",
    recordCall(ghLog),
    `const o = ${JSON.stringify(ghAnswers)};`,
    'const answer = ([verb, sub, name], said) => {',
    "  if (verb === 'secret' && sub === 'set') {",
    // Shaped like the live API: GitHub refuses a secret whose name starts with
    // `GITHUB_`, and only that; a name that merely contains it is accepted.
    "    if (name.startsWith('GITHUB_')) {",
    '      process.stderr.write(`refusing to set ${name}: secret names must not start with GITHUB_\\n`);',
    '      return 1;',
    '    }',
    '    fs.writeFileSync(path.join(o.stdinDir, name), fs.readFileSync(0));',
    '    return 0;',
    '  }',
    "  if (o.secretsJson && verb === 'secret' && sub === 'list') {",
    "    process.stdout.write(said.includes('--json') ? o.secretsJson : o.secretsPlain);",
    '    return 0;',
    '  }',
    "  if (o.login && verb === 'api' && sub === 'user') {",
    '    process.stdout.write(`${o.login}\\n`);',
    '    return 0;',
    '  }',
    "  if (o.authToken && verb === 'auth' && sub === 'token') {",
    '    process.stdout.write(`${o.authToken}\\n`);',
    '    return 0;',
    '  }',
    // The two reads the token handover makes. Both are answered as the tool
    // renders them for the flags the step passes: `--jq` reduces the ref to its
    // sha and the latest build to a status/commit pair, so the stand-in prints
    // those values and nothing around them.
    "  if (verb === 'api' && /^repos\\/.*\\/git\\/ref\\/heads\\//.test(sub)) {",
    '    process.stdout.write(`${o.pagesRef}\\n`);',
    '    return 0;',
    '  }',
    "  if (verb === 'api' && sub.endsWith('/pages/builds/latest')) {",
    "    const polls = (fs.existsSync(o.pollCount) ? Number(fs.readFileSync(o.pollCount, 'utf8')) : 0) + 1;",
    '    fs.writeFileSync(o.pollCount, String(polls));',
    '    if (o.builds.length) process.stdout.write(`${o.builds[Math.min(polls, o.builds.length) - 1]}\\n`);',
    '    return 0;',
    '  }',
    '  return o.authed ? 0 : 1;',
    '};',
    "process.exitCode = answer(process.argv.slice(2), process.argv.slice(2).join(' '));",
  ].join('\n'));

  // The browser opener, whichever name this machine's desktop uses. Both record
  // and keep a copy of the page: the CLI removes the original at exit, and its
  // mode is half the question, so the copy carries the original's mode.
  const openerLog = path.join(root, 'opener-argv.log');
  const openedFile = path.join(root, 'opened.html');
  for (const opener of ['open', 'xdg-open']) {
    stubToolJs(bin, opener, [
      "const fs = require('fs');",
      recordCall(openerLog),
      'const page = process.argv[2];',
      'if (page && fs.statSync(page, { throwIfNoEntry: false })?.isFile()) {',
      `  fs.copyFileSync(page, ${JSON.stringify(openedFile)});`,
      `  fs.chmodSync(${JSON.stringify(openedFile)}, fs.statSync(page).mode & 0o7777);`,
      '}',
    ].join('\n'));
  }

  const agents = path.join(home, 'Library', 'LaunchAgents');
  const localBin = path.join(home, '.local', 'bin');

  return {
    root,
    home,
    bin,
    // Every path here and in the env below is native: the command under test is
    // a node, which reads each one as a native path on every system.
    workflowHome: path.join(root, 'workflow-home'),
    claudeHome: path.join(home, '.claude'),
    localBin,
    link: path.join(localBin, 'workkit'),
    engineLink: path.join(home, '.claude', 'workkit'),
    plist: (label = LABEL) => path.join(agents, `${label}.plist`),
    launchctl: () => readArgv(launchctlLog),
    claudeCalls: () => readArgv(claudeLog),
    ghCalls: () => readArgv(ghLog),
    // What was piped into `gh secret set <name>`, or undefined when the secret
    // was never written.
    secretStdin: (name) => {
      const file = path.join(stdinDir, name);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    },
    openerCalls: () => readArgv(openerLog),
    // The page the opener was handed, copied aside before the CLI removed it:
    // its text and the mode it carried, or undefined when nothing was opened.
    openedPage: () => (fs.existsSync(openedFile) ? {
      text: fs.readFileSync(openedFile, 'utf8'),
      mode: fs.statSync(openedFile).mode & 0o777,
    } : undefined),
    // What is left in this machine's TMPDIR. The CLI puts two things there and
    // removes both: the mint's capture file and the handover page, each of which
    // carries a token value, so anything at all left here is a leak.
    tmpFiles: () => fs.readdirSync(tmp),
    // Scratch too, under every name Node reads it by: the mint writes its capture
    // file here, and a test that asks whether one was left behind must be asking
    // about this world's. No path a stub is handed rides Git Bash's /tmp mount.
    env: nodeHomeEnv(home, nodeTempEnv(tmp, {
      // The gh shim setup links into ~/.local/bin is a node program, so that PATH
      // holds this suite's node too, in a folder of its own: npm stays absent.
      PATH: joinPath(...(binOnPath ? [localBin] : []), bin, SYSTEM_PATH, ...(binOnPath ? [nodeOnly(root)] : [])),
      WORKFLOW_HOME: path.join(root, 'workflow-home'),
      WORKFLOW_CLAUDE_HOME: path.join(home, '.claude'),
      // jobs/install.js refuses a scratch HOME, since a scheduler is machine-global;
      // launchctl and schtasks here are recorders, so this world is the rehearsal
      // the override exists for. The guard itself is pinned in test/jobs.
      WORKKIT_SCHEDULE_OK: '1',
    })),
  };
};

// npm beside this node with a scratch user npmrc, and the world's root as npm's
// project root: npm walks up from its cwd for a project `.npmrc`, and on Windows
// the temp dir sits inside the user's home, whose own `.npmrc` answers when that
// home holds a package.json.
const withNpm = (world) => {
  const npmrc = path.join(world.root, 'npmrc');
  fs.writeFileSync(path.join(world.root, 'package.json'), '{}\n');
  return { npmrc, env: { PATH: joinPath(NODE_DIR, world.env.PATH), NPM_CONFIG_USERCONFIG: npmrc } };
};

// A mint needs a PTY tool the machine ships, `expect` or `script`; without one
// the command refuses first (canMintClaudeToken), so those cases take this skip value.
const HAS_PTY = Boolean(which('expect', SYSTEM_PATH) || which('script', SYSTEM_PATH));
const skipWithoutPty = () => !HAS_PTY && 'this machine has neither expect nor script, so no mint can be given a terminal';

/** The three views of one run: stdout, stderr, and `said`, both in that order; a signal's death reads as 128 plus its number. */
const viewsOf = (res) => ({
  code: res.status !== null ? res.status : 128 + os.constants.signals[res.signal],
  out: res.stdout || '',
  err: res.stderr || '',
  said: `${res.stdout || ''}${res.stderr || ''}`,
});

/**
 * `workkit <args>` through the entry at `script` (the real workflow/workkit.js by
 * default; the world's link, or a partial checkout's copy, to ask where a run
 * thinks it stands), started by this node, stdin an empty pipe so a prompt that
 * forgot to check its terminal fails here. `cwd` defaults to the world's root,
 * `env` lies over the world's. A check about what the user was told reads
 * `said`; a check about which stream reads `out` or `err`.
 * @returns {{code: number, out: string, err: string, said: string}}
 */
const runCli = (world, args, { cwd, script, env } = {}) => {
  const res = runSync(process.execPath, [script || CLI, ...args], {
    cwd: cwd || world.root,
    env: { ...world.env, ...(env || {}) },
    input: '',
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  expect(res.status !== null, `workkit ${args.join(' ')} finished (no timeout, no signal): ${res.error || ''}`).toBeTruthy();
  return viewsOf(res);
};

// The node inNode starts: one step of the kit called with kitOf's kit, its number the exit code.
const CALL = [
  "const path = require('path');",
  'const o = JSON.parse(process.argv[1]);',
  "const flush = (code) => process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));",
  '(async () => {',
  "  const { kitOf } = require(path.join(o.engine, 'workkit', 'kit.js'));",
  "  const { setQuiet } = require(path.join(o.engine, 'lib', 'voice.js'));",
  '  const step = require(path.join(o.engine, o.file))[o.fn];',
  "  if (typeof step !== 'function') throw new Error(`inNode: ${o.file} has no function ${o.fn}`);",
  '  const kit = kitOf(o.kit);',
  '  setQuiet(o.quiet);',
  '  const answer = await step(kit, ...o.args);',
  "  if (answer !== undefined && answer !== null && typeof answer !== 'number') throw new Error(`inNode: ${o.fn} answered ${JSON.stringify(answer)}, not a number`);",
  '  const code = answer ?? 0;',
  '  if (!o.thenSignal) return flush(code);',
  '  process.exitCode = code;',
  '  process.kill(process.pid, o.thenSignal);',
  '})().catch((err) => process.stderr.write(`${err.stack}\\n`, () => process.exit(70)));',
].join('\n');

/** The node's argv for one call: the engine, the step and what it is handed. */
const callArgs = ({ engine = WORKFLOW_DIR, file, fn, args = [], kit = {}, quiet = false, thenSignal = null }) => (
  ['-e', CALL, JSON.stringify({ engine, file, fn, args, kit, quiet, thenSignal })]
);

/**
 * One step of the command, `fn` of workflow/<file>, called in a node of its own in
 * the world: `kitOf(kit)` handed first, then `args` (each JSON), after
 * `setQuiet(quiet)`; the node exits with the number the step answers (0 for
 * none) and 70 with the stack when it throws. stdin is a file holding `input`,
 * not a pipe: node's pipes are socketpairs on macOS and BSD `script` refuses a
 * socket for stdin. `env` lies over the world's; `cwd` defaults to the world's
 * root; `engine` is the workflow/ folder loaded, the real one by default.
 * `thenSignal` has the node send itself that signal once the step answered.
 * @returns {{code: number, out: string, err: string, said: string}}
 */
const inNode = (world, {
  input = '', env = {}, cwd, ...call
}) => {
  const stdinFile = path.join(world.root, 'inNode-stdin');
  fs.writeFileSync(stdinFile, input);
  const fd = fs.openSync(stdinFile, 'r');
  const res = runSync(process.execPath, callArgs(call), {
    cwd: cwd || world.root,
    env: { ...world.env, ...env },
    stdio: [fd, 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  fs.closeSync(fd);
  expect(!res.error, `the step's node finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return viewsOf(res);
};

/**
 * inNode's call started without waiting, for a case that acts while the step
 * runs (a signal, a held child): the harness `start` handle. `detached` puts the
 * node at the head of its own process group.
 */
const startInNode = (world, {
  input = '', env = {}, cwd, detached = false, ...call
}) => start(process.execPath, callArgs(call), {
  cwd: cwd || world.root, env: { ...world.env, ...env }, input, detached,
});

/** A scratch user npmrc, so an npm the system PATH holds reads and writes no other. */
const npmrcEnv = (world) => ({ NPM_CONFIG_USERCONFIG: path.join(world.root, 'npmrc') });

/** The machine steps setup and update run, called through inNode with npmrcEnv under `env`. */
const machineLinks = (world, { env = {}, ...call } = {}) => inNode(world, {
  file: 'workkit/links.js', fn: 'machineLinks', env: { ...npmrcEnv(world), ...env }, ...call,
});

/** A path as a workkit.cmd, the Windows PATH line and the compiler spell it: native, every `/` a `\`. */
const windowsForm = (p) => gitPath(p).replace(/\//g, '\\');

/** Each line of `text`, trimmed. */
const lines = (text) => text.split('\n').map((l) => l.trim());

// An acted line, by its words: where quiet cannot answer, the verbs the kit uses
// when it changes something do. It proves a first run did something, and reads
// `setup`, which has no quiet variant.
const ACTED = /\b(linked|repointed|reloaded|created|cloned|seeded|corrected|released)\b|installed \S+ from|installed and loaded/;

// A real (empty) git repo, optionally already in the workflow.
const mkRepo = ({ optIn = false } = {}) => {
  const dir = mkTmp('workkit-cli-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (optIn) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), OPT_IN_SHAPES.current);
  }
  return dir;
};

/**
 * Give `repo` the origin github.com/`slug`, its HEAD on main as a clone's is, and
 * enable it on the roster through the entry at `script`, with `env` naming the
 * user's dir the roster lives in.
 */
const rosterRepo = (world, repo, slug, { script, env } = {}) => {
  mkOriginRepo(repo, `https://github.com/${slug}.git`);
  const head = runSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: repo, encoding: 'utf8' });
  expect(head.status === 0, `origin/HEAD points at main, got: ${head.stderr}`).toBeTruthy();
  const enabled = runCli(world, ['enable', repo], { script, env });
  expect(enabled.code === 0, `${slug} joins the roster, got: ${enabled.said}`).toBeTruthy();
};

/**
 * The env a sign-in-aware run lays over `world.env`: the user dir at the scratch
 * home's ~/.workkit where the login file lives, GitHub's hosts at nothing
 * listening so no case reaches github.com, node on PATH unless `node` is false,
 * and `extra` on top.
 */
const signInEnv = (world, { node = true, extra = {} } = {}) => ({
  WORKFLOW_HOME: path.join(world.home, '.workkit'),
  GITHUB_SERVER_URL: 'http://127.0.0.1:9',
  GITHUB_API_URL: 'http://127.0.0.1:9',
  ...(node ? { PATH: joinPath(world.env.PATH, NODE_DIR) } : {}),
  ...extra,
});

const installSchedule = (world) => runSync(process.execPath, [JOBS_INSTALL], { env: world.env, encoding: 'utf8', timeout: SPAWN_DEADLINE });

// The machine's hand-edited settings file, written the way a heal seeds it.
// `site` is whatever the test wants the site options to be: a `publish` of
// null is the unanswered switch, which is the state setup has a question about.
const userSettings = (world) => path.join(world.workflowHome, 'settings.json');
const seedSettings = (world, site) => {
  const file = userSettings(world);
  fs.mkdirSync(world.workflowHome, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, site }, null, 2)}\n`);
  return file;
};

/**
 * The world's machine signed in, as `workkit setup --login` leaves it: the login
 * file in its user dir, the world's WORKFLOW_HOME. The doctor then says signed
 * in and counts nothing for the sign-in.
 */
const signIn = (world) => writeLogin(world.home, { token: 'ghu_doctoruser', login: 'octocat' }, world.workflowHome);

// The workflow/ entries of the command and of every module it loads; the programs it starts stay out.
const COMMAND_FILES = ['workkit.js', 'workkit.cmd', 'workkit', 'lib', 'user-dir.js', 'slug.js'];

// The files outside hooks/ that hooks/ itself loads (test-bar.js's two imports), and the package.json that makes them ES modules.
const HOOKS_REACH = ['packages/core/package.json', 'packages/core/test/lib/lexer.js', 'packages/core/test/lib/serial-name.js'];

/** Copy HOOKS_REACH into the kit copy at `kit`. */
const copyHooksReach = (kit) => {
  for (const rel of HOOKS_REACH) {
    fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
    fs.copyFileSync(path.join(KIT_ROOT, rel), path.join(kit, rel));
  }
};

/** The whole hooks/ folder and HOOKS_REACH, which the command's settings and roster reads load, into the kit copy at `kit`. */
const copyHooks = (kit) => {
  fs.cpSync(path.join(KIT_ROOT, 'hooks'), path.join(kit, 'hooks'), { recursive: true });
  copyHooksReach(kit);
};

/**
 * A partial checkout: the command and every module it loads (COMMAND_FILES and
 * hooks/), copied whole (a symlink would resolve back to the real one), with
 * none of the programs it starts beside them (standards.js, home.js, publish.js,
 * the identity client, the shims, jobs/, tower/). Returns the entry point to run.
 * @returns {{kit: string, script: string}}
 */
const mkPartialKit = () => {
  const kit = mkTmp('workkit-cli-');
  fs.mkdirSync(path.join(kit, 'workflow'), { recursive: true });
  for (const name of COMMAND_FILES) {
    const from = path.join(WORKFLOW_DIR, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(kit, 'workflow', name), { recursive: true });
  }
  copySettingsKit(kit);
  copyHooks(kit);
  return { kit, script: path.join(kit, 'workflow', 'workkit.js') };
};

// One kit per origin slug and per `jobs/` or none, built once per process: the
// git init and origin are the cost a case would repeat.
const copyKit = seeded((seed, { slug, jobs }) => {
  fs.cpSync(WORKFLOW_DIR, path.join(seed, 'workflow'), { recursive: true });
  copySettingsKit(seed);
  copyHooks(seed);
  if (jobs) fs.cpSync(path.join(KIT_ROOT, 'jobs'), path.join(seed, 'jobs'), { recursive: true });
  mkOriginRepo(seed, `https://github.com/${slug}.git`);
});
const mkKitCopy = (slug, jobs) => {
  const kit = mkTmp('workkit-cli-');
  copyKit(kit, { slug, jobs });
  return { kit, script: path.join(kit, 'workflow', 'workkit.js') };
};

/**
 * A checkout of the engine with an origin of its own, a different slug from the
 * machine's home repo, so a run that reached for the checkout's origin instead
 * of the home repo is visible. Only `workflow/` and `hooks/` are copied, so the
 * schedule step is the named skip a partial checkout gets.
 */
const mkKit = (slug) => mkKitCopy(slug, false);

/**
 * A kit `setup` runs against end to end, so nothing it writes lands in this
 * checkout: mkKit's copy under an origin naming the workkit repo, which the
 * engine address accepts, plus the schedule installer. Returns `{ kit, script }`.
 */
const mkSetupKit = () => mkKitCopy('checkout/workkit', true);

/**
 * mkKit's kit under the workkit origin, with a stand-in installer: `lines` as `jobs/install.js`,
 * each run's arguments recorded first. `runs()` is every run's arguments,
 * `installs()` the runs in install mode. Returns them with `{ kit, script }`.
 */
const mkInstallerKit = (lines) => {
  const { kit, script } = mkKitCopy('checkout/workkit', false);
  const runLog = path.join(kit, 'installer-argv.log');
  writeKitFile(path.join(kit, 'jobs', 'install.js'), [recordCall(runLog), ...lines]);
  const runs = () => readArgv(runLog);
  return {
    kit, script, runs, installs: () => runs().filter((args) => args[0] !== '--check'),
  };
};

/**
 * mkInstallerKit's kit whose installer's `--check` prints `check(line)`'s line
 * ('' for nothing, a `→ not installed` or `→ out of date for this kit` line),
 * and whose run in install mode prints the installed line. Returns `check`
 * with mkInstallerKit's answer.
 */
const mkScheduleKit = (answer = '') => {
  // The answer sits beside jobs/, where the installer finds it from its own folder.
  const sched = mkInstallerKit([
    "const fs = require('fs');",
    "if (process.argv[2] === '--check') {",
    "  const line = fs.readFileSync(require('path').join(__dirname, '..', 'check-answer'), 'utf8');",
    '  if (line) console.log(line);',
    '} else {',
    `  console.log(${JSON.stringify(`✓ ${LABEL} → installed (9:00 AM daily)`)});`,
    '}',
  ]);
  const check = (line) => fs.writeFileSync(path.join(sched.kit, 'check-answer'), line);
  check(answer);
  return { ...sched, check };
};

/**
 * The kit as a plugin install leaves it: a copy with no `.git` and no origin,
 * in the world's own Claude plugin cache, whose manifest names the kit. The
 * schedule installer and the tower are stubs that do nothing. Returns the
 * entry point to run.
 */
const mkCacheKit = (world, version = '0.0.0') => {
  const kit = path.join(world.claudeHome, 'plugins', 'cache', 'workkit', 'workkit', version);
  // hooks/ beside workflow/, as the plugin ships it: the engine's settings read loads hooks/mods/settings.js.
  const engine = mkPluginCopy(kit, { version, dirs: ['workflow', 'hooks'] });
  copyHooksReach(kit);
  writeKitFile(path.join(kit, 'jobs', 'install.js'), ['process.exit(0);']);
  writeKitFile(path.join(kit, 'tower', 'start.js'), ['process.exit(0);']);
  return { kit, script: path.join(engine, 'workkit.js') };
};

// The checkout's own origin, and the machine's home repo. The cloud secrets
// live on the second: the plugin repo is distributed to everyone who installs
// the kit, and a consumer cannot set secrets on a repo they do not own.
const SLUG = 'owner/kit';
const HOME = 'owner/home';

/** A machine whose home repo is `HOME`: where the cloud secrets belong. */
const mkHomeWorld = (opts = {}) => {
  const world = mkWorld(opts);
  seedSettings(world, { repo: HOME, publish: false, url: null });
  return world;
};

module.exports = {
  WORKFLOW_DIR, CLI, LABEL, COMMAND_TABLE, cleanup, recordCall, mkWorld, withNpm, skipWithoutPty, runCli, inNode, startInNode, npmrcEnv, machineLinks, windowsForm, lines,
  signInEnv, ACTED, mkRepo, rosterRepo,
  installSchedule, seedSettings, signIn, copyHooks, mkPartialKit, mkKit, mkSetupKit, mkCacheKit,
  mkInstallerKit, mkScheduleKit, SLUG, HOME, mkHomeWorld,
};
