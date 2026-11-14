// Tests for jobs/install.sh, the LaunchAgent installer. HOME is scratch and
// `launchctl` is a recorder on PATH, so the suite reads the plist that would be
// installed and the commands that would load it, never the real gui domain.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');
const { BASH, NO_RC, shellPath, homeEnv, stubTool, pathWith } = require('../lib/platform');
const { mkPluginCopy } = require('../lib/plugin-copy');
const { mkOriginRepo } = require('../lib/git-repo');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'install.sh');
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
 *
 * HOME here is never the account's home, so the installer's own guard would
 * skip every launchctl call: `launchdOk` sets the override the guard reads, and
 * every test that asserts on launchd behaviour is rehearsing against the
 * recorder rather than the machine. `engineLink` is the ~/.claude/workkit
 * address the plist runs the job through, at this checkout's engine.
 */
const mkWorld = ({
  loaded = false, loadedPath = null, launchdOk = true, engineLink = true,
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

  const env = homeEnv(home, { ...process.env, PATH: pathWith(bin) });
  if (launchdOk) env.WORKKIT_LAUNCHD_OK = '1';
  else delete env.WORKKIT_LAUNCHD_OK;

  return {
    root,
    home,
    calls: () => readArgv(logFile),
    plist: (label) => path.join(agents, `${label}.plist`),
    rendered: () => (fs.existsSync(agents) ? fs.readdirSync(agents).sort() : []),
    installed: path.join(agents, `${LABEL}.plist`),
    env,
  };
};

const install = (world) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
const check = (world) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), '--check'], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });

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
      mkPluginCopy(cache, { dirs: ['workflow', 'jobs'] });
      const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(cache, 'jobs', 'install.sh'))], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
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
      const calls = world.calls();
      expect(calls.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${LABEL}`)), `the old one goes first: ${fmtCalls(calls)}`).toBeTruthy();
      expect(calls.some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL))), `then the new one loads: ${fmtCalls(calls)}`).toBeTruthy();
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
      const added = world.calls().slice(before);
      expect(added.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${LABEL}`)), `and the running agent is booted out: ${fmtCalls(added)}`).toBeTruthy();
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
    test('a run under a scratch home asks launchd for nothing', () => {
      const world = mkWorld({ launchdOk: false });
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fmtCalls(world.calls()), 'not one launchctl call: the gui domain is the whole machine’s').toBe('');
      expect(/would boot.*\(skipped: HOME is not this account's home/.test(res.stdout), `and it says what it would have done: ${res.stdout}`).toBeTruthy();
      expect(fs.existsSync(world.installed), 'the plist is still rendered into the scratch home').toBeTruthy();
      cleanup(world.root);
    });

    test('a scratch home with an installed plist still skips the load', () => {
      const world = mkWorld({ loaded: false });
      install(world);
      const before = world.calls().length;

      const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
        encoding: 'utf8',
        timeout: SPAWN_DEADLINE,
        env: { ...world.env, WORKKIT_LAUNCHD_OK: '' },
      });
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
      expect(new RegExp(`✓ ${LABEL} → not installed`).test(res.stdout), `it says so: ${res.stdout}`).toBeTruthy();
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
      expect(new RegExp(`✓ ${LABEL} → out of date`).test(res.stdout), `it names the drift: ${res.stdout}`).toBeTruthy();
      expect(fs.readFileSync(world.installed, 'utf8').includes('older checkout'), 'and the check writes nothing').toBeTruthy();
      cleanup(world.root);
    });
  });
});
