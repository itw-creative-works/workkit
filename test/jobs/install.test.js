// Tests for jobs/install.js, the 9am job's installer. HOME is scratch and
// `launchctl` (on a Mac) or `schtasks` (the Windows half, on every system) is a recorder on PATH, so the
// suite reads what would be installed and the commands that would register it,
// never the machine's own scheduler.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  recordArgv, recordArgvJs, readArgv, isCall, fmtCalls,
} = require('../lib/argv-log');
// The installer starts through run.js as every case's child does; the plist
// tools below stay raw.
const {
  homeEnv, nodeHomeEnv, stubTool, stubToolJs, pathWith, gitPath, spawnSync: spawnThroughRun,
} = require('../lib/platform');
const { schtasksStub } = require('../lib/schtasks-stub');
const { mkPluginCopy } = require('../lib/plugin-copy');
const { mkOriginRepo } = require('../lib/git-repo');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'install.js');
const TEMPLATE = path.join(__dirname, '..', '..', 'jobs', 'com.workkit.claude-daily.plist');
const REPO = path.join(__dirname, '..', '..');

// The one agent this checkout installs: the 9am job, which runs the summaries
// step and then the brief. The label is the schedule's name and outlives the
// script it points at, the one morning entry point.
const AGENT = { label: 'com.workkit.claude-daily', runner: 'morning.sh', hour: '9' };
const LABEL = AGENT.label;

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home plus a `launchctl` recorder. `loaded` decides what
 * `launchctl print` answers for the agent this checkout installs (the
 * difference between one already running and one never bootstrapped) and
 * `loadedPath` the plist that answer says the label is registered from, which
 * is the checkout's own unless a test wants a stray registration.
 * HOME is never the account's home, so the guard would skip every launchctl
 * call: `scheduleOk` sets the override it reads, so a launchd case rehearses
 * against the recorder. `engineLink` is the ~/.claude/workkit address the plist
 * runs the job through, at this checkout's engine.
 */
const mkWorld = ({
  loaded = false, loadedPath = null, scheduleOk = true, engineLink = true,
} = {}) => {
  const root = mkTmp('workkit-install-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (engineLink) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(REPO, 'workflow'), path.join(home, '.claude', 'workkit'));
  }

  const agents = path.join(home, 'Library', 'LaunchAgents');
  const body = loadedPath === null ? path.join(agents, `${LABEL}.plist`) : loadedPath;

  const logFile = path.join(root, 'launchctl-argv.log');
  const stub = stubTool(bin, 'launchctl', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1" == \'print\' ]]; then',
    '  case "$2" in',
    `    */${LABEL})`,
    ...(loaded
      ? [`      printf '\\tpath = %s\\n' '${body}'`, '      exit 0 ;;']
      : ['      exit 1 ;;']),
    '  esac',
    '  exit 1',
    'fi',
    'exit 0',
  ]);

  // The Claude home named, so a caller's WORKFLOW_CLAUDE_HOME (a proof run's) never stands in for it.
  const env = homeEnv(home, { ...process.env, PATH: pathWith(bin), WORKFLOW_CLAUDE_HOME: path.join(home, '.claude') });
  if (scheduleOk) env.WORKKIT_SCHEDULE_OK = '1';
  else delete env.WORKKIT_SCHEDULE_OK;

  return {
    root,
    home,
    bin,
    logFile,
    calls: () => readArgv(logFile),
    plist: (label) => path.join(agents, `${label}.plist`),
    rendered: () => (fs.existsSync(agents) ? fs.readdirSync(agents).sort() : []),
    installed: path.join(agents, `${LABEL}.plist`),
    env,
  };
};

// The calls that unload and load an agent, in the order they were made.
const bootCalls = (calls) => calls.filter((c) => isCall(c, 'bootout') || isCall(c, 'bootstrap'));

const runInstaller = (script, args, env) => spawnThroughRun(process.execPath, [script, ...args], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
const install = (world) => runInstaller(SCRIPT, [], world.env);
const check = (world) => runInstaller(SCRIPT, ['--check'], world.env);

// A copy of the engine somewhere else: no git, no plugin cache around it.
const strayKit = () => {
  const kit = mkTmp('workkit-install-');
  fs.cpSync(path.join(REPO, 'workflow'), path.join(kit, 'workflow'), { recursive: true });
  return path.join(kit, 'workflow');
};

describe('jobs/install', { skip: process.platform !== 'darwin' && 'launchd and plutil are macOS' }, () => {
  describe('jobs/install: rendering', () => {
    // The job is reached through the engine address, which `workkit update`
    // repoints; a plugin cache path changes with every version, so a plist that
    // baked one in would run a removed copy after the next update.
    test('the daily agent is rendered through the engine address, for this home', () => {
      const world = mkWorld();
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);

      const plist = fs.readFileSync(world.plist(LABEL), 'utf8');
      expect(!plist.includes('{{'), `no placeholder survives: ${plist}`).toBeTruthy();
      const program = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :ProgramArguments:1', world.plist(LABEL)], { encoding: 'utf8' }).stdout.trim();
      expect(program, `${AGENT.runner} is reached through the engine address`).toBe(`${world.home}/.claude/workkit/../jobs/${AGENT.runner}`);
      expect(!plist.includes(fs.realpathSync(REPO)), `and no absolute kit path is baked in: ${plist}`).toBeTruthy();
      expect(plist.includes(`${world.home}/Library/Logs/${LABEL}.log`), 'and the log is under this home').toBeTruthy();
      cleanup(world.root);
    });

    // launchd reads the file as written, so every byte is the template's but
    // the home: the fixture is the committed template with HOME put in.
    test('the rendered plist is the template with this home put in, byte for byte', () => {
      const world = mkWorld();
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const fixture = fs.readFileSync(TEMPLATE, 'utf8').split('{{HOME}}').join(world.env.HOME);
      expect(fs.readFileSync(world.plist(LABEL), 'utf8'), 'the installed plist').toBe(fixture);
      cleanup(world.root);
    });

    test('it is a valid plist, scheduled at nine', () => {
      const world = mkWorld();
      install(world);
      const file = world.plist(LABEL);
      const lint = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
      expect(lint.status, `plutil -lint: ${lint.stdout}${lint.stderr}`).toBe(0);
      const key = (name) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, file], { encoding: 'utf8' }).stdout.trim();
      expect(key('Label'), 'the label').toBe(LABEL);
      expect(key('StartCalendarInterval:Hour'), `it runs at ${AGENT.hour}`).toBe(AGENT.hour);
      expect(key('StartCalendarInterval:Minute'), 'o’clock').toBe('0');
      cleanup(world.root);
    });

    test('it is the only agent installed: one job, one cron', () => {
      const world = mkWorld();
      install(world);
      expect(world.rendered().join(','), 'nothing else is rendered into LaunchAgents').toBe(`${LABEL}.plist`);
      cleanup(world.root);
    });

    // The plist reaches the job through the engine address, so a home without
    // one would install a schedule that runs nothing: both modes name it.
    test('no engine address: install and --check both name the missing link', () => {
      const world = mkWorld({ engineLink: false });
      const link = `${world.home}/.claude/workkit`;
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const said = `${res.stdout}${res.stderr}`;
      expect(said.split('\n').some((l) => l.includes('⚠') && l.includes(link)), `install warns, naming ${link}: ${said}`).toBeTruthy();
      const checked = check(world);
      const checkSaid = `${checked.stdout}${checked.stderr}`;
      expect(checkSaid.split('\n').some((l) => l.includes('⚠') && l.includes(link)), `and so does --check: ${checkSaid}`).toBeTruthy();
      cleanup(world.root);
    });

    test('with the engine address in place, neither mode mentions it', () => {
      const world = mkWorld();
      const link = `${world.home}/.claude/workkit`;
      const res = install(world);
      const checked = check(world);
      expect(res.status, `install exits 0, stderr: ${res.stderr}`).toBe(0);
      expect(checked.status, `--check exits 0, stderr: ${checked.stderr}`).toBe(0);
      const said = `${res.stdout}${res.stderr}${checked.stdout}${checked.stderr}`;
      expect(!said.includes(link), `no line names the link: ${said}`).toBeTruthy();
      cleanup(world.root);
    });

    test('an engine address at some other copy: install names where it points', () => {
      const world = mkWorld({ engineLink: false });
      const other = strayKit();
      fs.mkdirSync(path.join(world.home, '.claude'), { recursive: true });
      fs.symlinkSync(other, path.join(world.home, '.claude', 'workkit'));
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const said = `${res.stdout}${res.stderr}`;
      expect(said.split('\n').some((l) => l.includes('⚠') && l.includes(other)), `a warn names ${other}: ${said}`).toBeTruthy();
      cleanup(world.root); cleanup(path.dirname(other));
    });

    // The plugin cache copy installs beside a clone its owner chose: the clone
    // keeps the address, and that is the expected state, not a fault.
    test('an engine address at a workkit clone, installed from the plugin cache: no warn', () => {
      const world = mkWorld({ engineLink: false });
      const cloneRoot = mkTmp('workkit-install-');
      fs.cpSync(path.join(REPO, 'workflow'), path.join(cloneRoot, 'workflow'), { recursive: true });
      mkOriginRepo(cloneRoot, 'https://github.com/owner/workkit.git');
      const claude = path.join(world.home, '.claude');
      fs.mkdirSync(claude, { recursive: true });
      fs.symlinkSync(path.join(cloneRoot, 'workflow'), path.join(claude, 'workkit'));
      const cache = path.join(claude, 'plugins', 'cache', 'workkit', 'workkit', '0.0.0');
      mkPluginCopy(cache, { dirs: ['workflow', 'jobs', 'hooks'] });
      const res = runInstaller(path.join(cache, 'jobs', 'install.js'), [], world.env);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const said = `${res.stdout}${res.stderr}`;
      expect(!said.includes('⚠'), `the clone outranks the cache copy, so nothing is wrong: ${said}`).toBeTruthy();
      expect(fs.existsSync(world.installed), 'and the schedule is installed').toBeTruthy();
      cleanup(world.root); cleanup(cloneRoot);
    });
  });

  describe('jobs/install: loading', () => {

    test('a first install boots the agent out and back in', () => {
      const world = mkWorld();
      install(world);
      const loads = bootCalls(world.calls());
      expect(loads.length, `one bootout, one bootstrap: ${fmtCalls(loads)}`).toBe(2);
      expect(isCall(loads[0], 'bootout', `gui/${process.getuid()}/${LABEL}`), `the old one goes first: ${fmtCalls(loads)}`).toBeTruthy();
      expect(isCall(loads[1], 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL)), `then the new one loads: ${fmtCalls(loads)}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a launchctl bootstrap that fails ends the installer with that command\'s code', () => {
      const world = mkWorld();
      // The agent is not loaded, and its load is refused with launchd's I/O error code.
      stubToolJs(world.bin, 'launchctl', [
        recordArgvJs(JSON.stringify(world.logFile), 'process.argv.slice(2)'),
        'const verb = process.argv[2];',
        "process.exitCode = verb === 'print' ? 1 : verb === 'bootstrap' ? 5 : 0;",
      ].join('\n'));
      const res = install(world);
      expect(bootCalls(world.calls()).some((c) => isCall(c, 'bootstrap')), `the load was asked for: ${fmtCalls(world.calls())}`).toBeTruthy();
      expect(res.status, `the refused load's code, stderr: ${res.stderr}`).toBe(5);
      cleanup(world.root);
    });

    test('a second run with the agent loaded changes nothing', () => {
      const world = mkWorld({ loaded: true });
      install(world);
      const first = fs.readFileSync(world.installed, 'utf8');
      const before = world.calls().length;

      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(new RegExp(`✓ ${LABEL} → already installed and loaded`).test(res.stdout), `it says so: ${res.stdout}`).toBeTruthy();
      expect(fs.readFileSync(world.installed, 'utf8'), 'the plist is untouched').toBe(first);

      const added = world.calls().slice(before);
      expect(added.length, `only the print check: ${fmtCalls(added)}`).toBe(1);
      expect(added.every((c) => isCall(c, 'print')), 'and it was the print check').toBeTruthy();
      cleanup(world.root);
    });

    test('an installed but unloaded agent is loaded without being rewritten', () => {
      const world = mkWorld({ loaded: false });
      install(world);
      const before = world.calls().length;

      const res = install(world);
      expect(/loaded \(plist unchanged\)/.test(res.stdout), `it says what it did: ${res.stdout}`).toBeTruthy();
      const added = world.calls().slice(before);
      expect(added.length, `print, then bootstrap: ${fmtCalls(added)}`).toBe(2);
      expect(isCall(added[1], 'bootstrap'), 'no bootout: there was nothing to remove').toBeTruthy();
      expect(!added.some((c) => isCall(c, 'bootout')), `and nothing was booted out: ${fmtCalls(added)}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a changed plist is reinstalled', () => {
      const world = mkWorld({ loaded: true });
      install(world);
      fs.appendFileSync(world.installed, '\n<!-- stale -->\n');
      const before = world.calls().length;

      install(world);
      expect(!fs.readFileSync(world.installed, 'utf8').includes('stale'), 'the stale copy is replaced').toBeTruthy();
      const loads = bootCalls(world.calls().slice(before));
      expect(loads.length, `one bootout, one bootstrap: ${fmtCalls(loads)}`).toBe(2);
      expect(isCall(loads[0], 'bootout', `gui/${process.getuid()}/${LABEL}`), `the running agent is booted out first: ${fmtCalls(loads)}`).toBeTruthy();
      expect(isCall(loads[1], 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL)), `then the new copy loads: ${fmtCalls(loads)}`).toBeTruthy();
      cleanup(world.root);
    });

    test('an agent loaded from someone else’s plist is re-registered', () => {
      const world = mkWorld({ loaded: true, loadedPath: '/somewhere/stale.plist' });
      install(world);
      const before = world.calls().length;

      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(/reloaded \(was registered from \/somewhere\/stale\.plist\)/.test(res.stdout), `it names the stray path: ${res.stdout}`).toBeTruthy();

      const added = world.calls().slice(before);
      expect(added.length, `print, bootout, bootstrap: ${fmtCalls(added)}`).toBe(3);
      expect(isCall(added[1], 'bootout', `gui/${process.getuid()}/${LABEL}`), `the stray registration goes first: ${fmtCalls(added)}`).toBeTruthy();
      expect(isCall(added[2], 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL)), `then this checkout’s plist loads: ${fmtCalls(added)}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a loaded agent whose path cannot be read is re-registered too', () => {
      const world = mkWorld({ loaded: true, loadedPath: '' });
      install(world);
      const before = world.calls().length;

      const res = install(world);
      expect(/reloaded \(was registered from an unreadable path\)/.test(res.stdout), `it says what it could not read: ${res.stdout}`).toBeTruthy();
      const added = world.calls().slice(before);
      expect(added.some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL))), `and loads this one: ${fmtCalls(added)}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/install: the real-home guard', () => {
    // The line is the one `workkit update` relays.
    test('a run under a scratch home asks launchd for nothing', () => {
      const world = mkWorld({ scheduleOk: false });
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fmtCalls(world.calls()), 'not one launchctl call: the gui domain is the whole machine’s').toBe('');
      expect(res.stdout.split('\n'), `and it says what it would have done: ${res.stdout}`).toContain(
        `✓ ${LABEL} → would bootout and bootstrap it (skipped: HOME is not this account's home; set WORKKIT_SCHEDULE_OK=1 to force)`,
      );
      expect(fs.existsSync(world.installed), 'the plist is still rendered into the scratch home').toBeTruthy();
      cleanup(world.root);
    });

    test('a scratch home with an installed plist still skips the load', () => {
      const world = mkWorld({ loaded: false });
      install(world);
      const before = world.calls().length;

      const res = runInstaller(SCRIPT, [], { ...world.env, WORKKIT_SCHEDULE_OK: '' });
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fmtCalls(world.calls().slice(before)), 'launchd is not even asked whether it is loaded').toBe('');
      expect(/would bootstrap it \(plist unchanged\)/.test(res.stdout), `it says so: ${res.stdout}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/install: --check, the drift report', () => {
    test('a machine with nothing installed says the agent is not installed', () => {
      const world = mkWorld();
      const res = check(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, 'it says so, in the one line the update relays').toBe(`✓ ${LABEL} → not installed\n`);
      expect(world.rendered().join(','), 'and writes nothing').toBe('');
      cleanup(world.root);
    });

    test('a current machine reports nothing, and never asks launchd', () => {
      const world = mkWorld({ loaded: true });
      install(world);
      const before = world.calls().length;
      const res = check(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, `silence is "current": ${res.stdout}`).toBe('');
      expect(world.calls().length, `no launchctl call at all: ${fmtCalls(world.calls().slice(before))}`).toBe(before);
      cleanup(world.root);
    });

    test('a plist from another checkout reads as out of date, and is not replaced', () => {
      const world = mkWorld({ loaded: true });
      install(world);
      fs.appendFileSync(world.installed, '\n<!-- from an older checkout -->\n');
      const res = check(world);
      expect(res.stdout, 'it names the drift, in the one line the update relays').toBe(`✓ ${LABEL} → out of date for this kit\n`);
      expect(fs.readFileSync(world.installed, 'utf8').includes('older checkout'), 'and the check writes nothing').toBeTruthy();
      cleanup(world.root);
    });
  });
});

/**
 * A scratch home and machine folder plus the `schtasks` stand-in. HOME is native,
 * as Git Bash hands it to a Windows program, and so is USERPROFILE. `scheduleOk`
 * sets the guard's override; `engineLink` is the ~/.claude/workkit address.
 * `entry` is a scratch program running the installer for `platform` on any system,
 * its Windows half by default.
 */
const mkTaskWorld = ({ scheduleOk = true, engineLink = true, platform = 'win32' } = {}) => {
  const root = mkTmp('workkit-install-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const machine = path.join(root, 'machine');
  const entry = path.join(root, `install-${platform}.js`);
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (engineLink) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(REPO, 'workflow'), path.join(home, '.claude', 'workkit'), 'junction');
  }
  fs.writeFileSync(entry, `process.exitCode = require(${JSON.stringify(SCRIPT)}).main(process.argv.slice(2), { platform: ${JSON.stringify(platform)} });\n`);
  const env = nodeHomeEnv(home, {
    ...process.env, PATH: pathWith(bin), WORKFLOW_HOME: machine, WORKFLOW_CLAUDE_HOME: path.join(home, '.claude'),
  });
  if (scheduleOk) env.WORKKIT_SCHEDULE_OK = '1';
  else delete env.WORKKIT_SCHEDULE_OK;
  return {
    root, home, env, entry, stub: schtasksStub(bin), copy: path.join(machine, 'scheduled', `${LABEL}.xml`),
  };
};

const installWin = (world) => runInstaller(world.entry, [], world.env);
const checkWin = (world) => runInstaller(world.entry, ['--check'], world.env);

describe('jobs/install on Windows, reached through the system argument', () => {
  test('a first run registers the task through the starter and keeps its copy', () => {
    const world = mkTaskWorld();
    const res = installWin(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.split('\n'), `the installed line: ${res.stdout}`).toContain(`✓ ${LABEL} → installed (9:00 AM daily)`);
    expect(world.stub.creates().length, `one /create: ${fmtCalls(world.stub.calls())}`).toBe(1);
    const task = world.stub.kept().subarray(2).toString('utf16le');
    // The task names the home in the Windows spelling, which a Mac's home is not.
    const winHome = world.home.split(path.sep).join('\\');
    expect(task, 'the task starts the starter through the engine address').toContain(`${winHome}\\.claude\\workkit\\morning-task.js`);
    expect(task, 'under the Node that ran the installer').toContain(fs.realpathSync(process.execPath));
    expect(task, 'only while the person is signed in').toContain('InteractiveToken');
    expect(fs.readFileSync(world.copy, 'utf8'), `the machine folder keeps the task text at ${world.copy}`).toBe(task);
    cleanup(world.root);
  });

  test('--check after a first run prints nothing, and never asks schtasks', () => {
    const world = mkTaskWorld();
    installWin(world);
    const before = world.stub.calls().length;
    const res = checkWin(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout, 'silence is "current"').toBe('');
    expect(world.stub.calls().length, `no schtasks call: ${fmtCalls(world.stub.calls().slice(before))}`).toBe(before);
    cleanup(world.root);
  });

  test('a scratch home asks schtasks for nothing, and says what it would have done', () => {
    const world = mkTaskWorld({ scheduleOk: false });
    const res = installWin(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(fmtCalls(world.stub.calls()), 'not one schtasks call').toBe('');
    expect(res.stdout.split('\n'), `the would-register line: ${res.stdout}`).toContain(
      `✓ ${LABEL} → would register it (skipped: HOME is not this account's home; set WORKKIT_SCHEDULE_OK=1 to force)`,
    );
    cleanup(world.root);
  });

  test('no engine address: install and --check both name the missing link', () => {
    const world = mkTaskWorld({ engineLink: false });
    const link = gitPath(path.join(world.home, '.claude', 'workkit'));
    for (const [mode, res] of [['install', installWin(world)], ['--check', checkWin(world)]]) {
      const said = `${res.stdout}${res.stderr}`;
      expect(res.status, `${mode} exits 0, stderr: ${res.stderr}`).toBe(0);
      expect(said.split('\n').some((l) => l.includes('⚠') && l.includes(link)), `${mode} warns, naming ${link}: ${said}`).toBeTruthy();
    }
    cleanup(world.root);
  });
});

describe('jobs/install on another system, reached through the system argument', () => {
  test('linux: exit 1, one line naming the two systems it knows, and no scheduler asked', () => {
    const world = mkTaskWorld({ platform: 'linux' });
    const res = runInstaller(world.entry, [], world.env);
    expect(res.status, `exit 1, stdout: ${res.stdout}`).toBe(1);
    expect(res.stderr, 'the refusal, whole').toBe('✖ install: the 9am job runs on macOS and Windows; linux has no scheduler it knows\n');
    expect(fmtCalls(world.stub.calls()), 'not one schtasks call').toBe('');
    expect(fs.existsSync(world.copy), 'and no copy').toBe(false);
    cleanup(world.root);
  });
});
