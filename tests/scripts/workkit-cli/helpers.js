//
// The shared prologue of the workflow/workkit.sh suites, the `*.test.js` files
// beside this one, which test the one command (setup, update, doctor, enable,
// decline, note). A plain module, never a suite: the runner only loads files
// ending in `.test.js`.
//
// Every world is a scratch HOME with `launchctl`, `claude`, and `gh` recorders
// on PATH, so nothing here reaches the real ~/Library/LaunchAgents, the real
// plugin install, or the network: the suite reads what WOULD be installed and
// which commands WOULD have run. The engine's two address overrides
// (WORKFLOW_HOME, WORKFLOW_CLAUDE_HOME) point at the same scratch tree, because
// `update` asks standards.sh to repoint the engine link on every run.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, assert, skip, WORKKIT_DIR: W } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC, shellPath, which, homeEnv, stubTool, joinPath,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const CLI = path.join(WORKFLOW_DIR, 'workkit.sh');
const JOBS_INSTALL = path.join(__dirname, '..', '..', '..', 'jobs', 'install.sh');
const LABEL = 'com.workkit.claude-daily';

// A PATH with the ordinary system tools and nothing else: the shims are
// prepended per world, so a command this script looks for is present only when
// the test put it there.
const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-cli-')));
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
 * A scratch machine. `claude` reports the plugin as installed or not,
 * `gh auth status` succeeds or fails, and `launchctl print` always answers "not
 * loaded" so an install path bootstraps. `binOnPath` puts ~/.local/bin on PATH,
 * which is the difference between a doctor that is all green and one asking for
 * a shell-rc line.
 *
 * The cloud-secrets world (issue #88) is the same machine with a `gh` that can
 * answer for a repo's secrets: `secrets` null is the default gh. It prints
 * nothing, which is every unreadable repo, and an array is a listing. Since
 * issue #91 the repo those secrets live on is the HOME repo, which the machine
 * settings name. `secret set` and `auth token` are recorded the same way, and
 * what arrived on a `secret set`'s STDIN is kept, because the piping is the
 * whole point of that step. `claudeToken` is what a stub `claude setup-token`
 * prints; it is fiction, and the only token any of this ever handles.
 *
 * The mint stub is shaped like the CLI issue #174 was filed against: the whole
 * screen (the browser message AND the paste-the-code prompt that follows it)
 * is drawn on the terminal, and the token is the last thing on it. `mintExit`
 * is a mint that did not finish.
 *
 * The token-handover world (issue #230) is that same `gh` answering two more
 * reads: `pagesRef` is the `gh-pages` head the publish pushed, and `pagesBuilds`
 * is what `pages/builds/latest` says, ONE ENTRY PER POLL as `[status, commit]`,
 * so a wait can be given a `building` answer first and a `built` one after. The
 * last entry repeats, the way a served build stays served. Both openers are on
 * PATH as recorders whatever the test asks for, because `/usr/bin/open` is real
 * on every mac and a step that reached it unshadowed would open a browser; each
 * one copies the page it was handed, mode and all, so the test can read what
 * the browser would have.
 */
const mkWorld = ({
  pluginInstalled = false, ghAuthed = true, claude = true, binOnPath = false,
  secrets = null, authToken = '', claudeToken = '', mintExit = 0,
  pagesRef = '', pagesBuilds = [],
} = {}) => {
  const root = mkTmp();
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
    // Shaped like the live API: GitHub refuses a secret whose name STARTS with
    // `GITHUB_`, and only that: a name that merely contains it is accepted,
    // which is what the rename in issue #91 rests on.
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

  // The browser opener, whichever name this machine's kind of desktop uses.
  // Both are recorders, and both keep a copy of the page they were handed: the
  // CLI removes the original at exit, and its MODE is half of what the test is
  // asking about, so the copy is made with `cp -p`.
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
    // The world's own paths stay NATIVE for everything this suite reads and
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
      // HOME here is a scratch directory, which jobs/install.sh refuses to load
      // a schedule from: launchd is machine-global, so a fake home is exactly
      // the run it guards against (issue #95). launchctl on this PATH is a
      // recorder, so this world says out loud that it is the rehearsal the
      // override exists for; the guard itself is pinned in tests/jobs.
      WORKKIT_LAUNCHD_OK: '1',
    }),
  };
};

// A mint hands `claude setup-token` a terminal, which takes a PTY tool the
// machine has to ship: `expect`, or `script`. Where it has neither, the CLI
// refuses before the question these cases ask is ever reached
// (workflow/workkit/secrets.sh, can_mint_claude_token), so they name their
// skip rather than assert on the refusal.
const HAS_PTY = Boolean(which('expect', SYSTEM_PATH) || which('script', SYSTEM_PATH));
const mintTest = (name, fn) => (HAS_PTY
  ? test(name, fn)
  : skip(name, 'this machine has neither expect nor script, so no mint can be given a terminal'));

// stdin is a pipe, never a terminal: that is the non-interactive machine, and
// any prompt that forgot to check would hang here instead of in production.
// `script` runs a DIFFERENT entry point: the world's symlink, or a copy of the
// CLI in a partial checkout, which is how the suite asks where a run thinks it
// is standing.
const runCli = (world, args, { cwd, script, env } = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(script || CLI), ...args], {
    cwd: cwd || world.root,
    env: { ...world.env, ...(env || {}) },
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(res.status !== null, `workkit ${args.join(' ')} finished (no timeout, no signal): ${res.error || ''}`);
  // Three views of one run: stdout, stderr, and `said`, the whole transcript
  // in the order a terminal shows it. Since issue #237 the level IS the stream
  // (an action and a skip on stdout, a warning and an error on stderr), so a
  // check about what the user was told reads `said` and a check about WHICH
  // stream reads `out` or `err`.
  return {
    code: res.status,
    out: res.stdout || '',
    err: res.stderr || '',
    said: `${res.stdout || ''}${res.stderr || ''}`,
  };
};

// An ACTED line, by its words. The glyphs are gone (issue #237) and an action
// and a skip are both plain lines on stdout, so where QUIET cannot answer the
// question the verbs the kit uses when it changes something do. Used twice: to
// prove a first run DID something, and for `setup`, which has no quiet variant
// to read the answer structurally from.
const ACTED = /\b(linked|repointed|reloaded|created|cloned|seeded|corrected|released)\b|installed \S+ from|installed and loaded/;

// A real (empty) git repo, optionally already in the workflow.
const mkRepo = ({ optIn = false } = {}) => {
  const dir = mkTmp();
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
 * One of the CLI's own functions, called directly: the pattern the home suites
 * (tests/scripts/home/) use for the engine's libraries. Sourcing the script with
 * `help` loads every function and prints the map, which is thrown away.
 *
 * The answers arrive on stdin from a FILE rather than through spawnSync's
 * `input`: node's pipes are socketpairs on macOS, and BSD `script` (which the
 * mint now runs the CLI under) refuses a socket for stdin outright. A file is
 * still not a terminal, so every `interactive` check answers exactly as it did.
 */
const inCli = (world, script, { input = '', env } = {}) => {
  const driver = `. ${JSON.stringify(CLI)} help >/dev/null\n${script}`;
  const stdinFile = path.join(world.root, 'inCli-stdin');
  fs.writeFileSync(stdinFile, input);
  const fd = fs.openSync(stdinFile, 'r');
  const res = spawnSync(BASH, [...NO_RC, '-c', driver], {
    cwd: world.root,
    // `env` for the values the CLI reads at SOURCE time, which a line prepended
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
 * A partial checkout: this CLI COPIED whole, the entry and the `workkit/`
 * pieces it sources (never symlinked: the link chain now resolves back to the
 * real one), into a `workflow/` holding nothing else of the kit, beside
 * whatever the test decides to give it. `installer` is the body of a stub
 * `jobs/install.sh`; without it the checkout simply has none. Returns the
 * entry point to run.
 */
const mkPartialKit = ({ installer } = {}) => {
  const kit = mkTmp();
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
 * A checkout of the ENGINE that has an origin of its own: a DIFFERENT slug
 * from the machine's home repo, on purpose: since issue #91 the cloud secrets
 * live on the home repo, and a run that still reached for the checkout's origin
 * would be visible here. The whole `workflow/` is copied because the CLI sources
 * its libraries; nothing else is, so the schedule step is the named skip a
 * partial checkout already gets.
 */
const mkKit = (slug) => {
  const kit = mkTmp();
  fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: kit });
  spawnSync('git', ['remote', 'add', 'origin', `https://github.com/${slug}.git`], { cwd: kit });
  return { kit, script: path.join(kit, 'workflow', 'workkit.sh') };
};

// The checkout's own origin, and the machine's home repo. They are different
// slugs on purpose: since issue #91 the cloud secrets live on the SECOND one,
// because the plugin repo is distributed to everyone who installs the kit and
// a consumer cannot set secrets on a repo they do not own.
const SLUG = 'owner/kit';
const HOME = 'owner/home';

/** A machine whose home repo is `HOME`: where the cloud secrets belong. */
const mkHomeWorld = (opts = {}) => {
  const world = mkWorld(opts);
  seedSettings(world, { repo: HOME, publish: false, url: null });
  return world;
};

module.exports = {
  WORKFLOW_DIR, CLI, LABEL, mkTmp, cleanup, writeStub, mkWorld, mintTest, runCli, ACTED, mkRepo,
  installSchedule, seedSettings, inCli, AT_TERMINAL, mkPartialKit, mkKit, SLUG, HOME, mkHomeWorld,
};
