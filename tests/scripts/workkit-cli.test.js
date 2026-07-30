//
// Tests for workflow/workkit.sh — the one command (setup, update, doctor,
// enable, decline, note).
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
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const CLI = path.join(WORKFLOW_DIR, 'workkit.sh');
const JOBS_INSTALL = path.join(__dirname, '..', '..', 'jobs', 'install.sh');
const LABEL = 'com.workkit.claude-daily';

// A PATH with the ordinary system tools and nothing else — the shims are
// prepended per world, so a command this script looks for is present only when
// the test put it there.
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const mkTmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-cli-')));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const writeStub = (file, lines) => {
  fs.writeFileSync(file, `${['#!/usr/bin/env bash', ...lines, ''].join('\n')}`);
  fs.chmodSync(file, 0o755);
};

// A secret listing as `gh secret list --json name,updatedAt` renders it. `days`
// is how long ago the secret was last set — the only thing the age check reads.
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
 * answer for a repo's secrets: `secrets` null is the default gh — it prints
 * nothing, which is every unreadable repo — and an array is a listing. Since
 * issue #91 the repo those secrets live on is the HOME repo, which the machine
 * settings name. `secret set` and `auth token` are recorded the same way, and
 * what arrived on a `secret set`'s STDIN is kept, because the piping is the
 * whole point of that step. `claudeToken` is what a stub `claude setup-token`
 * prints; it is fiction, and the only token any of this ever handles.
 */
const mkWorld = ({
  pluginInstalled = false, ghAuthed = true, claude = true, binOnPath = false,
  secrets = null, authToken = '', claudeToken = '',
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

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
      '  printf \'%s\\n\' \'Paste this into the browser…\' >&2',
      ...(claudeToken ? [`  printf '%s\\n' '${claudeToken}'`] : []),
      'fi',
      'exit 0',
    ]);
  }

  const ghLog = path.join(root, 'gh-argv.log');
  const stdinDir = path.join(root, 'gh-stdin');
  fs.mkdirSync(stdinDir, { recursive: true });
  writeStub(path.join(bin, 'gh'), [
    recordArgv(ghLog),
    'if [[ "$1" == \'secret\' && "$2" == \'set\' ]]; then',
    // Shaped like the live API: GitHub refuses a secret whose name STARTS with
    // `GITHUB_`, and only that — a name that merely contains it is accepted,
    // which is what the rename in issue #91 rests on.
    '  if [[ "$3" == GITHUB_* ]]; then printf \'refusing to set %s: secret names must not start with GITHUB_\\n\' "$3" >&2; exit 1; fi',
    `  cat > "${stdinDir}/$3"`,
    '  exit 0',
    'fi',
    ...(secrets ? [
      'if [[ "$1" == \'secret\' && "$2" == \'list\' ]]; then',
      `  printf '%s\\n' '${secretList(secrets)}'`,
      '  exit 0',
      'fi',
    ] : []),
    ...(authToken ? [
      'if [[ "$1" == \'auth\' && "$2" == \'token\' ]]; then',
      `  printf '%s\\n' '${authToken}'`,
      '  exit 0',
      'fi',
    ] : []),
    `exit ${ghAuthed ? 0 : 1}`,
  ]);

  const agents = path.join(home, 'Library', 'LaunchAgents');
  const localBin = path.join(home, '.local', 'bin');

  return {
    root,
    home,
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
    seedPlist: (label, text) => {
      fs.mkdirSync(agents, { recursive: true });
      fs.writeFileSync(path.join(agents, `${label}.plist`), text);
    },
    env: {
      HOME: home,
      PATH: `${binOnPath ? `${localBin}:` : ''}${bin}:${BASE_PATH}`,
      WORKFLOW_HOME: path.join(root, 'workflow-home'),
      WORKFLOW_CLAUDE_HOME: path.join(home, '.claude'),
    },
  };
};

// stdin is a pipe, never a terminal: that is the non-interactive machine, and
// any prompt that forgot to check would hang here instead of in production.
// `script` runs a DIFFERENT entry point — the world's symlink, or a copy of the
// CLI in a partial checkout — which is how the suite asks where a run thinks it
// is standing.
const runCli = (world, args, { cwd, script } = {}) => {
  const res = spawnSync('bash', [script || CLI, ...args], {
    cwd: cwd || world.root,
    env: world.env,
    input: '',
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(res.status !== null, `workkit ${args.join(' ')} finished (no timeout, no signal): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

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

const installSchedule = (world) => spawnSync('bash', [JOBS_INSTALL], { env: world.env, encoding: 'utf8', timeout: 30000 });

// The machine's hand-edited settings file, written the way a heal seeds it.
// `site` is whatever the test wants the site options to be — a `publish` of
// null is the unanswered switch, which is the state setup has a question about.
const userSettings = (world) => path.join(world.env.WORKFLOW_HOME, 'settings.json');
const seedSettings = (world, site) => {
  const file = userSettings(world);
  fs.mkdirSync(world.env.WORKFLOW_HOME, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, site }, null, 2)}\n`);
  return file;
};

/**
 * One of the CLI's own functions, called directly — the pattern home.test.js
 * uses for the engine's libraries. Sourcing the script with `help` loads every
 * function and prints the map, which is thrown away.
 */
const inCli = (world, script, { input = '' } = {}) => {
  const driver = `. ${JSON.stringify(CLI)} help >/dev/null\n${script}`;
  const res = spawnSync('bash', ['-c', driver], {
    cwd: world.root, env: world.env, input, encoding: 'utf8', timeout: 30000,
  });
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

// The one thing a piped test cannot hand a prompt is a terminal. Prepended to
// an `inCli` script, this answers the CLI's own `interactive` check yes while
// the answers arrive on stdin — the prompt, the read and the write are all the
// real thing.
const AT_TERMINAL = 'interactive() { return 0; }';

/**
 * A partial checkout: this CLI COPIED (never symlinked — the link chain now
 * resolves back to the real one) into a `workflow/` beside whatever the test
 * decides to give it. `installer` is the body of a stub `jobs/install.sh`;
 * without it the checkout simply has none. Returns the entry point to run.
 */
const mkPartialKit = ({ installer } = {}) => {
  const kit = mkTmp();
  fs.mkdirSync(path.join(kit, 'workflow'), { recursive: true });
  fs.copyFileSync(CLI, path.join(kit, 'workflow', 'workkit.sh'));
  if (installer) {
    fs.mkdirSync(path.join(kit, 'jobs'), { recursive: true });
    writeStub(path.join(kit, 'jobs', 'install.sh'), installer);
  }
  return { kit, script: path.join(kit, 'workflow', 'workkit.sh') };
};

/**
 * A checkout of the ENGINE that has an origin of its own — a DIFFERENT slug
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

const run = async () => {
  group('workkit: the map');

  await test('no arguments print the map', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, []);
    assertEq(code, 0, 'exit 0');
    for (const word of ['usage: workkit', 'setup', 'update', 'doctor', 'enable', 'decline', 'note']) {
      assert(out.includes(word), `the map names ${word}, got: ${out}`);
    }
    cleanup(world.root);
  });

  await test('help prints the same map', () => {
    const world = mkWorld();
    assertEq(runCli(world, ['help']).out, runCli(world, []).out, 'no arguments IS help');
    cleanup(world.root);
  });

  await test('an unknown command prints usage on stderr and exits 1', () => {
    const world = mkWorld();
    const { code, out, err } = runCli(world, ['dance']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('unknown command dance'), `names what it did not understand, got: ${err}`);
    assert(err.includes('usage: workkit'), 'and shows the map');
    assertEq(out, '', 'nothing on stdout');
    cleanup(world.root);
  });

  await test('it is executable and parses', () => {
    // eslint-disable-next-line no-bitwise
    assert((fs.statSync(CLI).mode & 0o111) !== 0, 'the executable bit is set');
    assertEq(spawnSync('bash', ['-n', CLI], { encoding: 'utf8' }).status, 0, 'bash -n is clean');
  });

  group('workkit update: the two links');

  await test('the engine address is pointed at this checkout', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const { code, out } = runCli(world, ['update']);
    assertEq(code, 0, `exit 0 — stderr says: ${out}`);
    assertEq(fs.realpathSync(world.engineLink), fs.realpathSync(WORKFLOW_DIR), 'the address resolves to the engine');
    assert(out.includes('engine:'), `and it reported the link, got: ${out}`);
    cleanup(world.root);
  });

  await test('a second run reads the address back before calling it current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { out } = runCli(world, ['update']);
    assert(out.includes(`engine: ${world.engineLink} is current`), `an address that resolves here IS current, got: ${out}`);
    cleanup(world.root);
  });

  await test('an engine that refuses the address never reports "is current"', () => {
    // A copy of the engine outside any checkout: standards.sh declines to take
    // the machine's address, and says nothing about it. Silence read as
    // agreement printed a link that was never written.
    const world = mkWorld();
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const kit = mkTmp();
    fs.cpSync(WORKFLOW_DIR, path.join(kit, 'workflow'), { recursive: true });
    const { code, out } = runCli(world, ['update'], { script: path.join(kit, 'workflow', 'workkit.sh') });
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.engineLink), 'nothing was written at the address');
    assert(!out.includes('is current'), `a refusal never reads as up to date, got: ${out}`);
    assert(out.includes('was left as it is'), `and the run says the address went unwritten, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('the command is linked into ~/.local/bin', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    assertEq(fs.readlinkSync(world.link), CLI, 'the symlink points at this script');
    assert(out.includes('linked'), `and says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a link left by a moved checkout is repointed', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.symlinkSync('/somewhere/else/workflow/workkit.sh', world.link);
    const { out } = runCli(world, ['update']);
    assertEq(fs.readlinkSync(world.link), CLI, 'repointed at this checkout');
    assert(out.includes('repointed'), `and says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a real file at the address is reported, never replaced', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    fs.writeFileSync(world.link, 'someone else’s script\n');
    const { code, out } = runCli(world, ['update']);
    assertEq(code, 0, 'exit 0');
    assert(out.includes('is a real file'), `it says what is in the way, got: ${out}`);
    assertEq(fs.readFileSync(world.link, 'utf8'), 'someone else’s script\n', 'and the file is untouched');
    cleanup(world.root);
  });

  await test('run THROUGH the symlink, it still stands in the real checkout', () => {
    // The failure this guards: taking the dirname before resolving the link
    // makes ~/.local/bin the checkout, so every path under it — the engine, the
    // installer, the symlink itself — names a file that does not exist, and the
    // command repoints its own address at nothing.
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });

    const viaLink = runCli(world, ['update'], { cwd: repo, script: world.link });
    assertEq(viaLink.code, 0, `exit 0 — stderr: ${viaLink.err}`);
    assert(viaLink.out.includes(path.dirname(WORKFLOW_DIR)), `it names the real checkout, got: ${viaLink.out}`);
    assertEq(fs.readlinkSync(world.link), CLI, 'and its own address still points at the real CLI');

    const doctor = runCli(world, ['doctor'], { cwd: repo, script: world.link });
    assert(doctor.out.includes('Everything this command can see is current'), `no invented drift through the link, got: ${doctor.out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('a PATH without ~/.local/bin gets the export line, and no rc file is touched', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    assert(out.includes('export PATH='), `it prints the line to add, got: ${out}`);
    assert(!fs.existsSync(path.join(world.home, '.zshrc')), 'and writes nobody’s shell rc');
    cleanup(world.root);
  });

  await test('a second update reports nothing to do', () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { code, out } = runCli(world, ['update']);
    assertEq(code, 0, 'exit 0');
    assert(!out.includes('✓'), `nothing was done the second time, got: ${out}`);
    cleanup(world.root);
  });

  group('workkit update --auto: the quiet variant');

  await test('a machine with nothing to do says nothing at all', () => {
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assertEq(out, '', `session start hears nothing, got: ${out}`);
    cleanup(world.root);
  });

  await test('it introduces no ~/.local/bin to a machine that has none', () => {
    // The same restraint the engine shows with ~/.claude: the automatic path
    // keeps an address current, and never invents a convention at session start.
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.localBin), 'the directory is a human’s to ask for');
    assertEq(out, '', `and nothing is said about it, got: ${out}`);
    cleanup(world.root);
  });

  await test('an existing ~/.local/bin gets the link kept current', () => {
    const world = mkWorld();
    fs.mkdirSync(world.localBin, { recursive: true });
    const { out } = runCli(world, ['update', '--auto']);
    assertEq(fs.readlinkSync(world.link), CLI, 'a machine with the convention gets the address');
    assert(out.includes('command:'), `and hears about it, got: ${out}`);
    cleanup(world.root);
  });

  await test('an unknown option is refused', () => {
    const world = mkWorld();
    const { code, err } = runCli(world, ['update', '--everything']);
    assertEq(code, 1, 'exit 1');
    assert(err.includes('unknown option'), `says so, got: ${err}`);
    cleanup(world.root);
  });

  await test('with no schedule installed, launchd is never asked', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, ['update', '--auto']);
    assertEq(code, 0, 'exit 0');
    assert(!fs.existsSync(world.plist()), 'the quiet path never installs a schedule fresh');
    assertEq(world.launchctl().length, 0, `and launchd is not touched: ${fmtCalls(world.launchctl())}`);
    assert(!out.includes('schedule'), `the missing schedule is not news at session start, got: ${out}`);
    cleanup(world.root);
  });

  await test('run by a human, a missing schedule names the command that installs it', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['update']);
    assert(out.includes('workkit setup'), `it points at setup, got: ${out}`);
    assert(!fs.existsSync(world.plist()), 'and still installs nothing');
    cleanup(world.root);
  });

  if (process.platform === 'darwin') {
    group('workkit update --auto: the schedule (macOS)');

    await test('a current schedule is left alone, and launchd is not asked', () => {
      const world = mkWorld();
      installSchedule(world);
      const before = world.launchctl().length;
      const { out } = runCli(world, ['update', '--auto']);
      assertEq(world.launchctl().length, before, `no launchctl call for a current schedule: ${fmtCalls(world.launchctl())}`);
      assert(!out.includes('schedule'), `and nothing to report, got: ${out}`);
      cleanup(world.root);
    });

    await test('a schedule that drifted is re-rendered and reloaded', () => {
      const world = mkWorld();
      installSchedule(world);
      fs.appendFileSync(world.plist(), '\n<!-- from an older checkout -->\n');
      const before = world.launchctl().length;

      const { code, out } = runCli(world, ['update', '--auto']);
      assertEq(code, 0, 'exit 0');
      assert(!fs.readFileSync(world.plist(), 'utf8').includes('older checkout'), 'the stale plist is replaced');
      const added = world.launchctl().slice(before);
      assert(added.some((c) => isCall(c, 'bootstrap')), `and it is reloaded: ${fmtCalls(added)}`);
      assert(out.includes('schedule:'), `the session hears what changed, got: ${out}`);
      cleanup(world.root);
    });

    group('workkit: a checkout or an installer that cannot answer (macOS)');

    await test('a checkout missing its installer says so, never "current"', () => {
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit();
      const { code, out } = runCli(world, ['update'], { script });
      assertEq(code, 0, 'exit 0');
      assert(out.includes('standards.sh is missing'), `the missing engine is named, got: ${out}`);
      assert(out.includes('installer is missing'), `and so is the missing installer, got: ${out}`);
      assert(!out.includes('is current'), 'an incomplete checkout never reads as up to date');
      cleanup(world.root); cleanup(kit);
    });

    await test('an installer that fails is reported, and the run still finishes', () => {
      // install.sh exits hard on a missing template or a plist that fails lint.
      // Unguarded under `set -e` that abort is invisible inside the hook, which
      // discards stderr, and retries silently every day.
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit({
        installer: [
          'if [[ "$1" == \'--check\' ]]; then printf \'com.workkit.claude-daily → out of date for this checkout\\n\'; exit 0; fi',
          'printf \'template missing\\n\' >&2',
          'exit 1',
        ],
      });
      const { code, out } = runCli(world, ['update', '--auto'], { script });
      assertEq(code, 0, 'a failed install never aborts the caller');
      assert(out.includes('did not finish'), `it says the install failed, got: ${out}`);
      assert(out.includes('install.sh'), 'and names the command to run by hand');
      cleanup(world.root); cleanup(kit);
    });

    await test('a drift check that cannot answer is not "current" either', () => {
      const world = mkWorld();
      world.seedPlist(LABEL, '<!-- installed by a human, once -->\n');
      const { kit, script } = mkPartialKit({ installer: ['exit 3'] });
      const { code, out } = runCli(world, ['update', '--auto'], { script });
      assertEq(code, 0, 'exit 0');
      assert(out.includes('drift check did not finish'), `it says the check failed, got: ${out}`);
      cleanup(world.root); cleanup(kit);
    });
  } else {
    group('workkit update --auto: the schedule — skipped, launchd is macOS');
  }

  group('workkit setup');

  await test('a machine without the plugin has it installed from this checkout', () => {
    const world = mkWorld({ pluginInstalled: false });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, `exit 0 — stderr: ${out}`);
    const calls = world.claudeCalls();
    assert(calls.some((c) => isCall(c, 'plugin', 'marketplace', 'add', path.dirname(WORKFLOW_DIR))), `the marketplace is this checkout: ${fmtCalls(calls)}`);
    assert(calls.some((c) => isCall(c, 'plugin', 'install', 'workkit@workkit')), `and the plugin is installed: ${fmtCalls(calls)}`);
    cleanup(world.root);
  });

  await test('a machine that already has it is left alone', () => {
    const world = mkWorld({ pluginInstalled: true });
    const { out } = runCli(world, ['setup']);
    const calls = world.claudeCalls();
    assert(!calls.some((c) => isCall(c, 'plugin', 'install')), `nothing is reinstalled: ${fmtCalls(calls)}`);
    assert(out.includes('is installed'), `and it says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a machine with no claude CLI is a named skip, not a failure', () => {
    const world = mkWorld({ claude: false });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(out.includes('claude CLI is not on this machine'), `it names the skip, got: ${out}`);
    assert(fs.existsSync(world.link), 'and everything else still happens');
    cleanup(world.root);
  });

  await test('an unauthenticated gh is reported with the command that fixes it', () => {
    const world = mkWorld({ ghAuthed: false });
    const { out } = runCli(world, ['setup']);
    assert(out.includes('gh auth login'), `it prints the fix, got: ${out}`);
    cleanup(world.root);
  });

  await test('without a terminal it prints the enable command instead of asking', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code, out } = runCli(world, ['setup'], { cwd: repo });
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(out.includes('workkit enable'), `and hands over the command, got: ${out}`);
    assert(!fs.existsSync(path.join(repo, W)), 'a repo that never answered is not written to');
    cleanup(world.root); cleanup(repo);
  });

  await test('a repo already in the workflow is not offered again', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { out } = runCli(world, ['setup'], { cwd: repo });
    assert(out.includes('is in the workflow'), `it reports the state, got: ${out}`);
    assert(!out.includes('workkit enable'), 'and asks nothing');
    cleanup(world.root); cleanup(repo);
  });

  await test('a second setup reports nothing to do', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });
    const { code, out } = runCli(world, ['setup'], { cwd: repo });
    assertEq(code, 0, 'exit 0');
    assert(!out.includes('✓'), `an already-set-up machine acts on nothing, got: ${out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('setup offers the home repo, and a non-interactive run only says what it would do', () => {
    // The gh shim answers `auth status` and nothing else, so `gh api user`
    // prints nothing: the home step has no login to work from and hands over
    // the command instead of guessing one. What this proves is the OFFER — the
    // wizard reaches the home steps at all, and creates nothing without a
    // terminal (workflow/home.sh's own suite covers the steps themselves).
    const world = mkWorld();
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/home:/.test(out), `the home repo is part of setup, got: ${out}`);
    assert(!fs.existsSync(path.join(world.env.WORKFLOW_HOME, '.git')), 'and nothing was converted without an answer');
    cleanup(world.root);
  });

  group('workkit setup: the site question');

  await test('an unanswered switch is left unanswered where nobody can answer it', () => {
    // Non-interactive is the piped run: the question waits for a terminal
    // rather than being decided by silence, so a later `workkit setup` asks
    // (issue #84).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/site: nobody has been asked/.test(out), `it says the question is still open, got: ${out}`);
    assert(/workkit setup/.test(out), 'and which run puts it');
    assertEq(fs.readFileSync(file, 'utf8'), before, 'nothing was written on the machine’s behalf');
    cleanup(world.root);
  });

  await test('an answered switch is never asked again, either way', () => {
    for (const [answer, said] of [[true, 'publishing is on'], [false, 'publishing is off']]) {
      const world = mkWorld();
      const file = seedSettings(world, { repo: 'owner/workkit', publish: answer, url: null });
      const before = fs.readFileSync(file, 'utf8');
      const { out } = runCli(world, ['setup']);
      assert(out.includes(`site: ${said}`), `${answer} reads back as the answer it is, got: ${out}`);
      assert(!/nobody has been asked/.test(out), 'and the question is not put again');
      assertEq(fs.readFileSync(file, 'utf8'), before, 'the file is left exactly as the owner has it');
      cleanup(world.root);
    }
  });

  await test('no home repo, no question — there would be nowhere to publish from', () => {
    const world = mkWorld();
    seedSettings(world, { repo: null, publish: null, url: null });
    const { out } = runCli(world, ['setup']);
    assert(/site: no home repo yet/.test(out), `it names why it did not ask, got: ${out}`);
    assert(!/nobody has been asked/.test(out), 'and does not hold the question open against nothing');
    cleanup(world.root);
  });

  await test('a settings file that does not parse is reported, never written over', () => {
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    fs.writeFileSync(file, '{ "version": 1, "site": {\n');
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'a broken file is not a crash');
    assert(/site: .*does not parse as JSON/.test(out), `it says what is wrong, got: ${out}`);
    assertEq(fs.readFileSync(file, 'utf8'), '{ "version": 1, "site": {\n', 'and the owner’s file is untouched');
    cleanup(world.root);
  });

  await test('the answer is recorded in the site options, and nothing else is', () => {
    // The write path the prompt calls, exercised directly: a terminal is the
    // one thing a test harness has no way to hand it.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: 'tower.example.com' });

    const yes = inCli(world, 'set_site_publish true');
    assertEq(yes.code, 0, `exit 0, got: ${yes.err}`);
    let site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, true, 'the yes is on disk');
    assertEq(site.repo, 'owner/workkit', 'the home repo is still there');
    assertEq(site.url, 'tower.example.com', 'and the custom domain');
    assert(/site: publishing is on/.test(yes.out), `and it says what it did, got: ${yes.out}`);

    const no = inCli(world, 'set_site_publish false');
    site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, false, 'a no is an answer too — false, not a missing key');
    assert(/site: publishing stays off/.test(no.out), `and it says so, got: ${no.out}`);
    cleanup(world.root);
  });

  await test('the write takes the state mutex, and gives it back', () => {
    // The same whole-file read-modify-write every other writer of this file
    // does, so it takes the one lock they all take (workflow/lib.sh).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.env.WORKFLOW_HOME, '.state.lock');
    fs.mkdirSync(lock, { recursive: true });
    const held = inCli(world, 'set_site_publish true');
    // Held by someone else: the write still happens (the engine never stops a
    // run on a lock), and the holder's lock is not removed by this one.
    assertEq(held.code, 0, 'exit 0');
    assert(fs.existsSync(lock), 'the lock is left to whoever took it');
    assertEq(JSON.parse(fs.readFileSync(file, 'utf8')).site.publish, true, 'and the answer landed');

    fs.rmdirSync(lock);
    inCli(world, 'set_site_publish false');
    assert(!fs.existsSync(lock), 'a run that took the lock drops it again');
    cleanup(world.root);
  });

  await test('a fresh yes is asked for the custom domain, and what is typed is written', () => {
    // The terminal check is the ONE thing a piped test cannot satisfy, so the
    // question step is called with `interactive` answering yes and the answers
    // arriving on stdin — everything else is the real function (issue #85).
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const lock = path.join(world.env.WORKFLOW_HOME, '.state.lock');

    const { code, out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\ntower.example.com\n' });
    assertEq(code, 0, `exit 0, got: ${out}`);
    assert(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up is put, got: ${out}`);
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assertEq(site.publish, true, 'the yes landed');
    assertEq(site.url, 'tower.example.com', 'and the domain beside it');
    assertEq(site.repo, 'owner/workkit', 'the rest of the site options are untouched');
    assert(!fs.existsSync(lock), 'the domain write gave the state mutex back');
    cleanup(world.root);
  });

  await test('an empty domain answer leaves the plain github.io address', () => {
    // Nothing written means `site.url` stays null, and publish.sh writes no
    // CNAME — enter IS an answer.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'y\n\n' });
    const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
    assert(/Custom domain for the site\? \[enter for none\]/.test(out), `the follow-up was put, got: ${out}`);
    assertEq(site.publish, true, 'the yes is still recorded');
    assertEq(site.url, null, 'and no domain is invented');
    assert(/publishing is on/.test(out), `the publish answer still speaks, got: ${out}`);
    cleanup(world.root);
  });

  await test('a no is never asked about a domain', () => {
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: null, url: null });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'n\ntyped.example.com\n' });
    assert(!/Custom domain/.test(out), `no follow-up on the no leg, got: ${out}`);
    assertEq(JSON.parse(fs.readFileSync(file, 'utf8')).site.url, null, 'and nothing was read into the file');
    cleanup(world.root);
  });

  await test('an already-answered machine is asked about the domain no more than about the switch', () => {
    // The domain question rides the FRESH yes only: a machine that said yes
    // last week changes its domain by hand edit, as it does today.
    const world = mkWorld();
    const file = seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const before = fs.readFileSync(file, 'utf8');
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_site_publish`, { input: 'sneaky.example.com\n' });
    assert(!/Custom domain/.test(out), `no question, got: ${out}`);
    assertEq(fs.readFileSync(file, 'utf8'), before, 'and the owner’s file is exactly as it was');
    cleanup(world.root);
  });

  group('workkit setup: the site publish');

  await test('the switch ending on publishes before setup exits', () => {
    // Already true is an answer, and a piped run is not a reason to hold the
    // site back — the publish is not a question (issue #85). The engine's own
    // script names why it stopped, which is how the call is seen from here.
    const world = mkWorld();
    seedSettings(world, { repo: 'owner/workkit', publish: true, url: null });
    const { code, out } = runCli(world, ['setup']);
    assertEq(code, 0, 'exit 0');
    assert(/publish: nothing is cloned at/.test(out), `publish.sh ran and named its own skip, got: ${out}`);
    cleanup(world.root);
  });

  await test('an off or unanswered switch adds no publish at all', () => {
    for (const publish of [false, null]) {
      const world = mkWorld();
      seedSettings(world, { repo: 'owner/workkit', publish, url: null });
      const { out } = runCli(world, ['setup']);
      assert(!/^.*publish: /m.test(out), `${publish} publishes nothing, got: ${out}`);
      cleanup(world.root);
    }
  });

  group('workkit setup: the cloud secrets');

  // The fictional values these tests move around. Nothing here is a real token,
  // and nothing here carries a vendor's prefix either — a committed literal
  // shaped like a credential trips push protection for everyone who clones the
  // repo. What is asserted is that the value went from the command that
  // produced it to `gh secret set`'s stdin, and appeared nowhere else.
  const MINTED = 'FAKEmintedTOKENvalue0123456789';
  const LOGIN_TOKEN = 'gho_FAKEloginTOKENfakeLOGINtoken00';
  // The checkout's own origin, and the machine's home repo. They are different
  // slugs on purpose: since issue #91 the cloud secrets live on the SECOND one,
  // because the plugin repo is distributed to everyone who installs the kit and
  // a consumer cannot set secrets on a repo they do not own.
  const SLUG = 'owner/kit';
  const HOME = 'owner/home';

  /** A machine whose home repo is `HOME` — where the cloud secrets belong. */
  const mkHomeWorld = (opts = {}) => {
    const world = mkWorld(opts);
    seedSettings(world, { repo: HOME, publish: false, url: null });
    return world;
  };

  await test('a machine with no home repo is a named skip, and nothing is asked of GitHub', () => {
    const world = mkWorld({ secrets: [] });
    seedSettings(world, { repo: null, publish: false, url: null });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    assertEq(code, 0, 'exit 0');
    assert(/secrets: this machine names no home repo/.test(out), `it names the skip, got: ${out}`);
    assert(!world.ghCalls().some((c) => isCall(c, 'secret')), `and asks about no repo's secrets: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('the secrets go to the home repo, never to the checkout’s own', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    runCli(world, ['setup'], { script });
    const calls = world.ghCalls().filter((c) => c[0] === 'secret');
    assert(calls.length > 0, `the secrets were asked about: ${fmtCalls(world.ghCalls())}`);
    assert(calls.every((c) => c.includes(HOME)), `every call names the home repo: ${fmtCalls(calls)}`);
    assert(!calls.some((c) => c.includes(SLUG)), `and none names this checkout's repo: ${fmtCalls(calls)}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a listing that cannot be read is a skip, never a missing secret', () => {
    // The default gh prints nothing for `secret list` — an unauthenticated CLI,
    // a repo without Actions, no network. Reporting that as "not set" would
    // send a human to mint a token that is already there.
    const world = mkHomeWorld();
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    assert(new RegExp(`secrets: ${HOME}'s secrets could not be read`).test(out), `it says it could not read them, got: ${out}`);
    assert(!/is not set/.test(out), `and claims nothing about what is on the repo, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('without a terminal, an absent Claude token gets the two commands, never a mint', () => {
    const world = mkHomeWorld({ secrets: [] });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['setup'], { script });
    assertEq(code, 0, 'it finishes rather than waiting for an answer');
    assert(out.includes('claude setup-token'), `it hands over the mint, got: ${out}`);
    assert(out.includes(`gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo ${HOME}`), 'and the command that pushes it');
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), `nothing was minted: ${fmtCalls(world.claudeCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('answered yes, the mint goes straight into the secret and is never printed', () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out, err } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    const calls = world.ghCalls();
    assert(calls.some((c) => isCall(c, 'secret', 'set', 'CLAUDE_CODE_OAUTH_TOKEN', '--repo', HOME)), `the secret is written on the named repo: ${fmtCalls(calls)}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, 'and the value arrived on stdin — a pipe, not an argument');
    assert(!calls.some((c) => c.includes(MINTED)), `the token is not an argument to anything: ${fmtCalls(calls)}`);
    assert(!out.includes(MINTED) && !err.includes(MINTED), `and never reaches the terminal, got: ${out}${err}`);
    assert(out.includes('is set on'), `the run says the secret is set, got: ${out}`);
    cleanup(world.root);
  });

  await test('the default answer is no, and nothing is minted or written', () => {
    const world = mkWorld({ claudeToken: MINTED });
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: '\n' });
    assert(/left as it is/.test(out), `an empty answer is a no, got: ${out}`);
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'nothing was minted');
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and no secret was written');
    cleanup(world.root);
  });

  await test('a mint that printed no token warns instead of writing an empty secret', () => {
    // An empty `gh secret set` would overwrite a working token with nothing.
    const world = mkWorld();
    const { out } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
    assert(/printed no token/.test(out), `it says what did not happen, got: ${out}`);
    assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), undefined, 'and nothing was written');
    cleanup(world.root);
  });

  await test('the token is found whatever shape the mint printed it in', () => {
    // Two shapes the mint has been seen in: a bare opaque value on the last
    // line, and the same value wrapped in a terminal's color codes. Both must
    // reach the secret byte for byte — a stray escape in a pushed token is a
    // cloud brief that fails to authenticate a month later.
    const ESC = '\u001b';
    for (const [shape, printed] of [
      ['a bare opaque value', MINTED],
      ['a value wrapped in color codes', `${ESC}[1;32m${MINTED}${ESC}[0m`],
    ]) {
      const world = mkWorld({ claudeToken: printed });
      const { out, err } = inCli(world, `${AT_TERMINAL}\noffer_claude_token ${HOME} 'is not set'`, { input: 'y\n' });
      assertEq(world.secretStdin('CLAUDE_CODE_OAUTH_TOKEN'), MINTED, `${shape} arrives as the value alone`);
      assert(!out.includes(MINTED) && !err.includes(MINTED), `and never reaches the terminal, got: ${out}${err}`);
      cleanup(world.root);
    }
  });

  await test('a vendor-prefixed token wins over any other line in the output', () => {
    // The prefixed shape is what the mint prints today, so it is read first —
    // asserted on the extraction itself, because a literal long enough to look
    // like the real thing has no business in a committed file.
    const world = mkWorld();
    const { out } = inCli(world, `printf '%s' "$(extract_token 'approve it in the browser
sk-ant-EXAMPLE
FAKEtrailingLINEthatIsLongEnough')"`);
    assertEq(out, 'sk-ant-EXAMPLE', 'the prefixed match, not the trailing opaque line');
    cleanup(world.root);
  });

  await test('a token past eleven months is offered as a refresh; a fresh one is silent', () => {
    const stale = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }] });
    const staleKit = mkKit(SLUG);
    const staleOut = runCli(stale, ['setup'], { script: staleKit.script }).out;
    assert(/CLAUDE_CODE_OAUTH_TOKEN was set 40\d days ago/.test(staleOut), `it names the age, got: ${staleOut}`);
    assert(/lives about a year/.test(staleOut), 'and why that is worth a refresh');
    cleanup(stale.root); cleanup(staleKit.kit);

    const fresh = mkHomeWorld({ secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 10 }] });
    const freshKit = mkKit(SLUG);
    const freshOut = runCli(fresh, ['setup'], { script: freshKit.script }).out;
    assert(!/claude setup-token/.test(freshOut), `a fresh token is not offered again, got: ${freshOut}`);
    assert(/CLAUDE_CODE_OAUTH_TOKEN is set on/.test(freshOut), 'it is reported as set, and nothing more');
    cleanup(fresh.root); cleanup(freshKit.kit);
  });

  await test('the cross-repo token is set zero-click from the gh login, with no prompt at all', () => {
    // Owner ruling 2026-07-30: maximum automation. A piped run — no terminal to
    // ask — still writes it, which is what "no prompt" means here. The name
    // CONTAINS `GITHUB_`, which the stub refuses only as a prefix the way the
    // live API does — so a write that lands proves the name is a legal one.
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    const calls = world.ghCalls();
    assert(calls.some((c) => isCall(c, 'auth', 'token')), `the login's own token is read: ${fmtCalls(calls)}`);
    assert(calls.some((c) => isCall(c, 'secret', 'set', 'WORKKIT_GITHUB_TOKEN', '--repo', HOME)), `and pushed to the home repo: ${fmtCalls(calls)}`);
    assertEq(world.secretStdin('WORKKIT_GITHUB_TOKEN'), LOGIN_TOKEN, 'through stdin');
    assert(!out.includes(LOGIN_TOKEN), `and never printed, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('only a name that STARTS with GITHUB_ is refused — the shipped one is accepted', () => {
    // The rename in issue #91 rests on GitHub's actual rule, so it is asserted
    // against a stub that enforces that rule rather than against a comment: the
    // same push, twice, differing only in the secret's name.
    const world = mkHomeWorld({ authToken: LOGIN_TOKEN });
    const refused = inCli(world, `SECRET_HOME=GITHUB_TOKEN\npush_home_token ${HOME}`);
    assert(/GITHUB_TOKEN could not be written/.test(refused.out), `a leading GITHUB_ is refused: ${refused.out}`);
    assertEq(world.secretStdin('GITHUB_TOKEN'), undefined, 'and nothing was written under it');

    const shipped = inCli(world, `push_home_token ${HOME}`);
    assert(/WORKKIT_GITHUB_TOKEN is set on/.test(shipped.out), `a name that merely contains it lands: ${shipped.out}`);
    assertEq(world.secretStdin('WORKKIT_GITHUB_TOKEN'), LOGIN_TOKEN, 'with the value on stdin');
    cleanup(world.root);
  });

  await test('a cross-repo token already on the repo is left exactly as it is', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 900 }],
      authToken: LOGIN_TOKEN,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['setup'], { script });
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `no secret is rewritten: ${fmtCalls(world.ghCalls())}`);
    assert(!/✓/.test(out.split('\n').filter((l) => l.includes('secrets:')).join('\n')), `and a set-up machine acts on nothing, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a second setup writes neither of them again', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 3 }],
      authToken: LOGIN_TOKEN,
    });
    const { kit, script } = mkKit(SLUG);
    runCli(world, ['setup'], { script });
    const before = world.ghCalls().filter((c) => isCall(c, 'secret', 'set')).length;
    runCli(world, ['setup'], { script });
    const after = world.ghCalls().filter((c) => isCall(c, 'secret', 'set')).length;
    assertEq(after, before, 'running twice equals running once');
    assertEq(before, 0, 'and a repo that already has both is not written to at all');
    cleanup(world.root); cleanup(kit);
  });

  group('workkit: the cloud secrets in the automatic and the report paths');

  await test('update --auto warns about each missing value and prompts for none', () => {
    const world = mkHomeWorld({ secrets: [], authToken: LOGIN_TOKEN, claudeToken: MINTED, binOnPath: true });
    const { kit, script } = mkKit(SLUG);
    const { code, out } = runCli(world, ['update', '--auto'], { script });
    assertEq(code, 0, 'exit 0');
    for (const name of ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN']) {
      assert(new RegExp(`secrets: ${name} is not set on ${HOME} — run \`workkit setup\``).test(out), `one line for ${name}, got: ${out}`);
    }
    assert(!world.claudeCalls().some((c) => isCall(c, 'setup-token')), 'the automatic path mints nothing');
    assert(!world.ghCalls().some((c) => isCall(c, 'secret', 'set')), `and writes nothing: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('a listing that never answers is bounded, and the bound is a quiet skip', () => {
    // A captive portal answers the handshake and never the request. The daily
    // path runs this at session start, so an unbounded read would hold the
    // session open for as long as the portal felt like it. `exec` matters: the
    // stub must BE the process the bound signals, the way real gh is.
    const world = mkHomeWorld({ binOnPath: true });
    writeStub(path.join(world.root, 'bin', 'gh'), [
      'if [[ "$1" == \'secret\' && "$2" == \'list\' ]]; then exec sleep 60; fi',
      'exit 0',
    ]);
    world.env.WORKKIT_GH_TIMEOUT = '2';
    const { kit, script } = mkKit(SLUG);
    const started = Date.now();
    const { code, out } = runCli(world, ['update', '--auto'], { script });
    const elapsed = (Date.now() - started) / 1000;
    assertEq(code, 0, 'exit 0');
    assert(elapsed < 20, `the read is bounded rather than waited out, took ${elapsed}s`);
    assert(!/secrets:/.test(out), `and the quiet path stays quiet about it, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('update --auto says nothing about secrets that are set and fresh', () => {
    const world = mkHomeWorld({
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 3 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 3 }],
      binOnPath: true,
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['update', '--auto'], { script });
    assert(!/secrets:/.test(out), `a session start hears nothing, got: ${out}`);
    cleanup(world.root); cleanup(kit);
  });

  await test('doctor reports one line per value, and counts what needs attention', () => {
    const world = mkHomeWorld({
      pluginInstalled: true,
      binOnPath: true,
      secrets: [{ name: 'CLAUDE_CODE_OAUTH_TOKEN', days: 400 }, { name: 'WORKKIT_GITHUB_TOKEN', days: 5 }],
    });
    const { kit, script } = mkKit(SLUG);
    const { out } = runCli(world, ['doctor'], { script });
    assert(new RegExp(`⚠.*CLAUDE_CODE_OAUTH_TOKEN on ${HOME} was set 40\\d days ago`).test(out), `the old one is a warning with its age, got: ${out}`);
    assert(new RegExp(`✓.*WORKKIT_GITHUB_TOKEN is set on ${HOME} \\(5 days ago\\)`).test(out), `the fresh one is a check, got: ${out}`);
    assert(/item\(s\) need attention/.test(out), 'the stale token is counted');
    cleanup(world.root); cleanup(kit);
  });

  group('workkit publish');

  await test('publish delegates to the engine’s script, which skips while the site is off', () => {
    // `site.publish` is default off (issue #80), so an untouched machine is the
    // switch's own named skip — the engine's reason, printed in this voice.
    const world = mkWorld();
    const { code, out } = runCli(world, ['publish']);
    assertEq(code, 0, 'a machine that publishes nothing is not broken');
    assert(/publish: `site.publish` is off/.test(out), `the engine's own reason comes through, got: ${out}`);
    cleanup(world.root);
  });

  await test('the map names it', () => {
    const world = mkWorld();
    assert(runCli(world, ['help']).out.includes('publish'), 'one command, and publish is reachable from it');
    cleanup(world.root);
  });

  await test('update --auto never builds a site at session start', () => {
    // The daily job publishes; a session start that ran an app build would cost
    // minutes nobody asked for.
    const world = mkWorld({ binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['update']);
    const { out } = runCli(world, ['update', '--auto']);
    assert(!/publish:/.test(out), `the quiet path says nothing about the site, got: ${out}`);
    cleanup(world.root);
  });

  group('workkit doctor');

  await test('a bare machine hears what is missing and how to fix each', () => {
    const world = mkWorld({ pluginInstalled: false, ghAuthed: false });
    const { code, out } = runCli(world, ['doctor']);
    assertEq(code, 0, 'a report is a report — exit 0');
    assert(out.includes('plugin:') && out.includes('workkit setup'), `the plugin is missing, got: ${out}`);
    assert(out.includes('gh auth login'), 'gh is not authenticated');
    assert(out.includes('engine:'), 'the engine address is reported');
    assert(out.includes('command:'), 'and the symlink');
    assert(/\d+ item\(s\) need attention/.test(out), `it counts them, got: ${out}`);
    cleanup(world.root);
  });

  await test('a set-up machine reports everything current', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.claudeHome, { recursive: true });
    const repo = mkRepo({ optIn: true });
    runCli(world, ['setup'], { cwd: repo });
    const { out } = runCli(world, ['doctor'], { cwd: repo });
    assert(out.includes('Everything this command can see is current'), `no drift after a setup, got: ${out}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('the global layer is reported: the roster count and the home repo', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const repo = mkRepo({ optIn: true });
    // A heal of the repo is what puts it on the roster, so `doctor` has a real
    // count to read rather than a seeded one.
    runCli(world, ['enable', repo]);
    const { out } = runCli(world, ['doctor'], { cwd: repo });
    assert(/roster: 1 repo\(s\) registered/.test(out), `it counts the roster, got: ${out}`);
    assert(/home: not set/.test(out) && out.includes('workkit setup'), `and says which command makes one, got: ${out}`);

    const settings = path.join(world.env.WORKFLOW_HOME, 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settings, 'utf8'));
    parsed.site = { ...(parsed.site || {}), repo: 'owner/private-home' };
    fs.writeFileSync(settings, JSON.stringify(parsed, null, 2));
    const named = runCli(world, ['doctor'], { cwd: repo }).out;
    assert(/home: owner\/private-home/.test(named), `it reports the home repo once it is named, got: ${named}`);
    assert(/nothing is cloned at/.test(named), `and that the tower is not cloned yet, got: ${named}`);
    assert(/tower/.test(named), 'naming the path setup would clone it into');
    cleanup(world.root); cleanup(repo);
  });

  await test('a machine with no user settings yet is told the first heal writes it', () => {
    const world = mkWorld();
    const { out } = runCli(world, ['doctor']);
    assert(/roster: .*does not exist yet/.test(out), `no invented count, got: ${out}`);
    cleanup(world.root);
  });

  await test('an empty roster reports as a notice, not as a green check', () => {
    // Zero registered means the tower, the board and the brief have nothing to
    // read — the one count that must not read as everything being fine.
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    fs.mkdirSync(world.env.WORKFLOW_HOME, { recursive: true });
    fs.writeFileSync(
      path.join(world.env.WORKFLOW_HOME, '.repos.json'),
      JSON.stringify({ version: 1, repos: {} }, null, 2),
    );
    const { out } = runCli(world, ['doctor']);
    const line = out.split('\n').find((l) => l.includes('roster:'));
    assert(line && !/✓/.test(line), `no green check on an empty roster, got: ${line}`);
    assert(/fills as a session opens/.test(line), `and it says how it fills, got: ${line}`);
    cleanup(world.root);
  });

  group('workkit: the engine commands');

  await test('note delegates to the capture CLI', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, out } = runCli(world, ['note', 'fix', 'the', 'tower', 'poller'], { cwd: repo });
    assertEq(code, 0, 'exit 0');
    assert(out.includes('noted →'), `the capture CLI answered, got: ${out}`);
    assert(fs.readFileSync(path.join(repo, W, 'inbox.md'), 'utf8').endsWith('- fix the tower poller\n'), 'one bullet, in the repo inbox');
    cleanup(world.root); cleanup(repo);
  });

  await test('an empty note fails the way the capture CLI fails', () => {
    const world = mkWorld();
    const repo = mkRepo({ optIn: true });
    const { code, err } = runCli(world, ['note'], { cwd: repo });
    assertEq(code, 1, 'exit 1');
    assert(err.includes('usage: wk.sh note'), `the delegate’s own usage, got: ${err}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('enable writes the repo’s committed opt-in', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['enable', repo]);
    assertEq(code, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, W, 'settings.json')), 'the repo’s yes is on disk');
    cleanup(world.root); cleanup(repo);
  });

  await test('decline records the answer in the user’s own settings, not the repo’s', () => {
    const world = mkWorld();
    const repo = mkRepo();
    const { code } = runCli(world, ['decline', repo]);
    assertEq(code, 0, 'exit 0');
    const user = JSON.parse(fs.readFileSync(path.join(world.env.WORKFLOW_HOME, '.repos.json'), 'utf8'));
    assertEq(user.repos[repo], 'declined', 'the personal file carries it');
    assert(!fs.existsSync(path.join(repo, W)), 'and the repo is never written to');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
