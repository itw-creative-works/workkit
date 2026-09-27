// The shared prologue of the workflow/workkit.sh suites beside this one, which
// test the one command. Every world is a scratch HOME with `launchctl`, `claude`
// and `gh` recorders on PATH, so the suite reads what would be installed and
// which commands would have run; WORKFLOW_HOME and WORKFLOW_CLAUDE_HOME point
// at the same scratch tree.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, skip, WORKKIT_DIR: W } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC, shellPath, which, homeEnv, stubTool, joinPath,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { mkTmp } = require('../../lib/scratch');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const CLI = path.join(WORKFLOW_DIR, 'workkit.sh');
const JOBS_INSTALL = path.join(__dirname, '..', '..', '..', 'jobs', 'install.sh');
const LABEL = 'com.workkit.claude-daily';

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const writeStub = (file, lines) => stubTool(
  path.dirname(file), path.basename(file), ['#!/usr/bin/env bash', ...lines],
);

// A secret listing as `gh secret list --json name,updatedAt` renders it. `days`
// is how long ago the secret was last set: the only thing the age check reads.
const secretList = (secrets) => JSON.stringify(secrets.map(({ name, days }) => ({
  name,
  updatedAt: new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z'),
})));

/**
 * A scratch machine. `claude` reports the plugin as installed or not, `gh auth
 * status` succeeds or fails, `launchctl print` answers "not loaded", and
 * `binOnPath` puts ~/.local/bin on PATH. `secrets` is the home repo's secret
 * listing (null: an unreadable repo); what a `secret set` got on stdin is kept.
 * `claudeToken` is what a stub `claude setup-token` prints, drawing the whole
 * screen with the token last; `mintExit` is a mint that did not finish.
 * `pagesRef` and `pagesBuilds` answer the token handover's reads, one
 * `[status, commit]` per poll with the last repeating. Both openers record and
 * copy the page they were handed, so no real browser opens.
 */
const mkWorld = ({
  pluginInstalled = false, ghAuthed = true, claude = true, binOnPath = false,
  secrets = null, authToken = '', claudeToken = '', mintExit = 0,
  pagesRef = '', pagesBuilds = [],
} = {}) => {
  const root = mkTmp('workkit-cli-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });

  const launchctlLog = path.join(root, 'launchctl-argv.log');
  writeStub(path.join(bin, 'launchctl'), [recordArgv(launchctlLog), 'if [[ "$1" == \'print\' ]]; then exit 1; fi', 'exit 0']);

  const claudeLog = path.join(root, 'claude-argv.log');
  if (claude) {
    writeStub(path.join(bin, 'claude'), [
      recordArgv(claudeLog),
      'if [[ "$1" == \'plugin\' && "$2" == \'list\' ]]; then',
      `  printf '%s\\n' '${pluginInstalled ? '[{ "id": "workkit@workkit" }]' : '[]'}'`,
      'fi',
      'if [[ "$1" == \'setup-token\' ]]; then',
      '  printf \'%s\\n\' \'Opening your browser to approve this token…\' >&2',
      '  printf \'%s\\n\' \'Paste the authorization code here:\'',
      ...(claudeToken ? [`  printf '%s\\n' '${claudeToken}'`] : []),
      `  exit ${mintExit}`,
      'fi',
      'exit 0',
    ]);
  }

  const ghLog = path.join(root, 'gh-argv.log');
  const stdinDir = path.join(root, 'gh-stdin');
  fs.mkdirSync(stdinDir, { recursive: true });
  // The Pages answers, one file for the sequence and one for how far through it
  // this world has been read: the stub is a fresh process per poll, so the count
  // has to live on disk for the second answer to differ from the first.
  const pollSeq = path.join(root, 'pages-builds.tsv');
  const pollCount = path.join(root, 'pages-polls');
  fs.writeFileSync(pollSeq, pagesBuilds.map(([status, commit]) => `${status}\t${commit}\n`).join(''));
  writeStub(path.join(bin, 'gh'), [
    recordArgv(ghLog),
    'if [[ "$1" == \'secret\' && "$2" == \'set\' ]]; then',
    // Shaped like the live API: GitHub refuses a secret whose name starts with
    // `GITHUB_`, and only that; a name that merely contains it is accepted.
    '  if [[ "$3" == GITHUB_* ]]; then printf \'refusing to set %s: secret names must not start with GITHUB_\\n\' "$3" >&2; exit 1; fi',
    `  cat > "${stdinDir}/$3"`,
    '  exit 0',
    'fi',
    ...(secrets ? [
      'if [[ "$1" == \'secret\' && "$2" == \'list\' ]]; then',
      // Shaped like the live tool, which answers JSON only when asked for it:
      // the secrets wizard reads `--json name,updatedAt`, and the brief dispatch
      // reads the plain listing, one `NAME<tab>Updated <date>` per line.
      '  if [[ "$*" == *--json* ]]; then',
      `    printf '%s\\n' '${secretList(secrets)}'`,
      '  else',
      `    printf '%s\\n'${secrets.map(({ name }) => ` '${name}\tUpdated 2026-07-01'`).join('')}`,
      '  fi',
      '  exit 0',
      'fi',
    ] : []),
    ...(authToken ? [
      'if [[ "$1" == \'auth\' && "$2" == \'token\' ]]; then',
      `  printf '%s\\n' '${authToken}'`,
      '  exit 0',
      'fi',
    ] : []),
    // The two reads the token handover makes. Both are answered as the tool
    // renders them for the flags the step passes: `--jq` reduces the ref to its
    // sha and the latest build to a status/commit pair, so the stub prints those
    // values and nothing around them.
    'if [[ "$1" == \'api\' && "$2" == repos/*/git/ref/heads/* ]]; then',
    `  printf '%s\\n' '${pagesRef}'`,
    '  exit 0',
    'fi',
    'if [[ "$1" == \'api\' && "$2" == */pages/builds/latest ]]; then',
    `  polls="$(cat "${pollCount}" 2>/dev/null || printf 0)"`,
    '  polls=$((polls + 1))',
    `  printf '%s' "$polls" > "${pollCount}"`,
    `  total="$(grep -c '' "${pollSeq}" 2>/dev/null || printf 0)"`,
    '  if [[ "$total" -gt 0 ]]; then',
    '    if [[ "$polls" -gt "$total" ]]; then polls="$total"; fi',
    `    sed -n "\${polls}p" "${pollSeq}"`,
    '  fi',
    '  exit 0',
    'fi',
    `exit ${ghAuthed ? 0 : 1}`,
  ]);

  // The browser opener, whichever name this machine's desktop uses. Both record
  // and keep a copy of the page: the CLI removes the original at exit, and its
  // mode is half the question, so the copy is made with `cp -p`.
  const openerLog = path.join(root, 'opener-argv.log');
  const openedFile = path.join(root, 'opened.html');
  for (const opener of ['open', 'xdg-open']) {
    writeStub(path.join(bin, opener), [
      recordArgv(openerLog),
      `if [[ -f "$1" ]]; then cp -p "$1" "${openedFile}"; fi`,
      'exit 0',
    ]);
  }

  const agents = path.join(home, 'Library', 'LaunchAgents');
  const localBin = path.join(home, '.local', 'bin');

  return {
    root,
    home,
    bin,
    // The world's own paths stay native for everything this suite reads and
    // writes; the environment below carries the same places in the spelling the
    // shell under test sees.
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
    seedPlist: (label, text) => {
      fs.mkdirSync(agents, { recursive: true });
      fs.writeFileSync(path.join(agents, `${label}.plist`), text);
    },
    env: homeEnv(home, {
      // Scratch too: the mint writes its capture file here, and a test that
      // asks whether one was left behind must be asking about this world's.
      TMPDIR: shellPath(tmp),
      PATH: joinPath(...(binOnPath ? [localBin] : []), bin, SYSTEM_PATH),
      WORKFLOW_HOME: shellPath(path.join(root, 'workflow-home')),
      WORKFLOW_CLAUDE_HOME: shellPath(path.join(home, '.claude')),
      // jobs/install.sh refuses a scratch HOME, since launchd is machine-global;
      // launchctl here is a recorder, so this world is the rehearsal the override
      // exists for. The guard itself is pinned in tests/jobs.
      WORKKIT_LAUNCHD_OK: '1',
    }),
  };
};

// A mint needs a PTY tool the machine ships, `expect` or `script`; without one
// the CLI refuses first (can_mint_claude_token), so those cases name their skip.
const HAS_PTY = Boolean(which('expect', SYSTEM_PATH) || which('script', SYSTEM_PATH));
const mintTest = (name, fn) => (HAS_PTY
  ? test(name, fn)
  : skip(name, 'this machine has neither expect nor script, so no mint can be given a terminal'));

// stdin is a pipe, never a terminal: a prompt that forgot to check hangs here
// rather than in production. `script` runs another entry point (the world's
// symlink, or a partial checkout's copy) to ask where a run thinks it stands.
const runCli = (world, args, { cwd, script, env } = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(script || CLI), ...args], {
    cwd: cwd || world.root,
    env: { ...world.env, ...(env || {}) },
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(res.status !== null, `workkit ${args.join(' ')} finished (no timeout, no signal): ${res.error || ''}`);
  // Three views of one run: stdout, stderr, and `said`, the whole transcript in
  // terminal order. The level is the stream, so a check about what the user was
  // told reads `said` and a check about which stream reads `out` or `err`.
  return {
    code: res.status,
    out: res.stdout || '',
    err: res.stderr || '',
    said: `${res.stdout || ''}${res.stderr || ''}`,
  };
};

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
    fs.writeFileSync(path.join(dir, W, 'settings.json'), '{ "version": 1, "enabled": true }\n');
  }
  return dir;
};

const installSchedule = (world) => spawnSync(BASH, [...NO_RC, shellPath(JOBS_INSTALL)], { env: world.env, encoding: 'utf8', timeout: 30000 });

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
 * One of the CLI's own functions, called directly, the way the home suites call
 * the engine's libraries: sourcing with `help` loads every function. Answers
 * arrive on stdin from a file, not spawnSync's `input`: node's pipes are
 * socketpairs on macOS and BSD `script` refuses a socket for stdin.
 */
const inCli = (world, script, { input = '', env } = {}) => {
  const driver = `. ${JSON.stringify(CLI)} help >/dev/null\n${script}`;
  const stdinFile = path.join(world.root, 'inCli-stdin');
  fs.writeFileSync(stdinFile, input);
  const fd = fs.openSync(stdinFile, 'r');
  const res = spawnSync(BASH, [...NO_RC, '-c', driver], {
    cwd: world.root,
    // `env` for the values the CLI reads at source time, which a line prepended
    // to the script would be too late for.
    env: { ...world.env, ...(env || {}) },
    stdio: [fd, 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 30000,
  });
  fs.closeSync(fd);
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return {
    code: res.status,
    out: res.stdout || '',
    err: res.stderr || '',
    said: `${res.stdout || ''}${res.stderr || ''}`,
  };
};

// The one thing a piped test cannot hand a prompt is a terminal. Prepended to
// an `inCli` script, this answers the CLI's own `interactive` check yes while
// the answers arrive on stdin: the prompt, the read and the write are all the
// real thing.
const AT_TERMINAL = 'interactive() { return 0; }';

/**
 * A partial checkout: this CLI copied whole (the entry and the `workkit/`
 * pieces it sources; a symlink would resolve back to the real one) into a
 * `workflow/` holding nothing else of the kit. `installer` is the body of a stub
 * `jobs/install.sh`, none without it. Returns the entry point to run.
 */
const mkPartialKit = ({ installer } = {}) => {
  const kit = mkTmp('workkit-cli-');
  fs.mkdirSync(path.join(kit, 'workflow'), { recursive: true });
  fs.copyFileSync(CLI, path.join(kit, 'workflow', 'workkit.sh'));
  fs.cpSync(path.join(WORKFLOW_DIR, 'workkit'), path.join(kit, 'workflow', 'workkit'), { recursive: true });
  if (installer) {
    fs.mkdirSync(path.join(kit, 'jobs'), { recursive: true });
    writeStub(path.join(kit, 'jobs', 'install.sh'), installer);
  }
  return { kit, script: path.join(kit, 'workflow', 'workkit.sh') };
};

/**
 * A checkout of the engine with an origin of its own, a different slug from the
 * machine's home repo, so a run that reached for the checkout's origin instead
 * of the home repo is visible. Only `workflow/` is copied, so the schedule step
 * is the named skip a partial checkout gets.
 */
const mkKit = (slug) => {
  const kit = mkTmp('workkit-cli-');
  fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: kit });
  spawnSync('git', ['remote', 'add', 'origin', `https://github.com/${slug}.git`], { cwd: kit });
  return { kit, script: path.join(kit, 'workflow', 'workkit.sh') };
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
  WORKFLOW_DIR, CLI, LABEL, cleanup, writeStub, mkWorld, mintTest, runCli, ACTED, mkRepo,
  installSchedule, seedSettings, inCli, AT_TERMINAL, mkPartialKit, mkKit, SLUG, HOME, mkHomeWorld,
};
