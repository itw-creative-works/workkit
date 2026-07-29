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

/**
 * A scratch machine. `claude` reports the plugin as installed or not,
 * `gh auth status` succeeds or fails, and `launchctl print` always answers "not
 * loaded" so an install path bootstraps. `binOnPath` puts ~/.local/bin on PATH,
 * which is the difference between a doctor that is all green and one asking for
 * a shell-rc line.
 */
const mkWorld = ({ pluginInstalled = false, ghAuthed = true, claude = true, binOnPath = false } = {}) => {
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
      'exit 0',
    ]);
  }

  const ghLog = path.join(root, 'gh-argv.log');
  writeStub(path.join(bin, 'gh'), [recordArgv(ghLog), `exit ${ghAuthed ? 0 : 1}`]);

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

  group('workkit publish');

  await test('publish delegates to the engine’s script, which skips with no home repo', () => {
    const world = mkWorld();
    const { code, out } = runCli(world, ['publish']);
    assertEq(code, 0, 'a machine with no home repo is not broken');
    assert(/publish: no home repo/.test(out), `the engine's own reason comes through, got: ${out}`);
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
    parsed.home = 'owner/private-home';
    fs.writeFileSync(settings, JSON.stringify(parsed, null, 2));
    const named = runCli(world, ['doctor'], { cwd: repo }).out;
    assert(/home: owner\/private-home/.test(named), `it reports the home repo once it is named, got: ${named}`);
    assert(/is not a clone of it/.test(named), `and that the folder is not its clone yet, got: ${named}`);
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
      path.join(world.env.WORKFLOW_HOME, 'settings.json'),
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
    const user = JSON.parse(fs.readFileSync(path.join(world.env.WORKFLOW_HOME, 'settings.json'), 'utf8'));
    assertEq(user.repos[repo], 'declined', 'the personal file carries it');
    assert(!fs.existsSync(path.join(repo, W)), 'and the repo is never written to');
    cleanup(world.root); cleanup(repo);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
