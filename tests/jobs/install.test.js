// Tests for jobs/install.sh, the LaunchAgent installer. HOME is scratch and
// `launchctl` is a recorder on PATH, so the suite reads the plist that would be
// installed and the commands that would load it, never the real gui domain.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');
const { BASH, NO_RC, shellPath, homeEnv, stubTool, pathWith } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
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

  const log = path.join(root, 'launchctl-argv.log');
  const stub = stubTool(bin, 'launchctl', [
    '#!/usr/bin/env bash',
    recordArgv(log),
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
    calls: () => readArgv(log),
    plist: (label) => path.join(agents, `${label}.plist`),
    rendered: () => (fs.existsSync(agents) ? fs.readdirSync(agents).sort() : []),
    installed: path.join(agents, `${LABEL}.plist`),
    env,
  };
};

const install = (world) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], { encoding: 'utf8', timeout: 30000, env: world.env });
const check = (world) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), '--check'], { encoding: 'utf8', timeout: 30000, env: world.env });

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('launchd and plutil are macOS');

  group('jobs/install: rendering');

  // The job is reached through the engine address, which `workkit update`
  // repoints; a plugin cache path changes with every version, so a plist that
  // baked one in would run a removed copy after the next update.
  await test('the daily agent is rendered through the engine address, for this home', () => {
    const world = mkWorld();
    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);

    const plist = fs.readFileSync(world.plist(LABEL), 'utf8');
    assert(!plist.includes('{{'), `no placeholder survives: ${plist}`);
    const program = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :ProgramArguments:1', world.plist(LABEL)], { encoding: 'utf8' }).stdout.trim();
    assertEq(program, `${world.home}/.claude/workkit/../jobs/${AGENT.runner}`, `${AGENT.runner} is reached through the engine address`);
    assert(!plist.includes(fs.realpathSync(REPO)), `and no absolute kit path is baked in: ${plist}`);
    assert(plist.includes(`${world.home}/Library/Logs/${LABEL}.log`), 'and the log is under this home');
    cleanup(world.root);
  });

  await test('it is a valid plist, scheduled at nine', () => {
    const world = mkWorld();
    install(world);
    const file = world.plist(LABEL);
    const lint = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
    assertEq(lint.status, 0, `plutil -lint: ${lint.stdout}${lint.stderr}`);
    const key = (name) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, file], { encoding: 'utf8' }).stdout.trim();
    assertEq(key('Label'), LABEL, 'the label');
    assertEq(key('StartCalendarInterval:Hour'), AGENT.hour, `it runs at ${AGENT.hour}`);
    assertEq(key('StartCalendarInterval:Minute'), '0', 'o’clock');
    cleanup(world.root);
  });

  await test('it is the only agent installed: one job, one cron', () => {
    const world = mkWorld();
    install(world);
    assertEq(world.rendered().join(','), `${LABEL}.plist`, 'nothing else is rendered into LaunchAgents');
    cleanup(world.root);
  });

  // The plist reaches the job through the engine address, so a home without
  // one would install a schedule that runs nothing: both modes name it.
  await test('no engine address: install and --check both name the missing link', () => {
    const world = mkWorld({ engineLink: false });
    const link = `${world.home}/.claude/workkit`;
    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const said = `${res.stdout}${res.stderr}`;
    assert(said.split('\n').some((l) => l.includes('⚠') && l.includes(link)), `install warns, naming ${link}: ${said}`);
    const checked = check(world);
    const checkSaid = `${checked.stdout}${checked.stderr}`;
    assert(checkSaid.split('\n').some((l) => l.includes('⚠') && l.includes(link)), `and so does --check: ${checkSaid}`);
    cleanup(world.root);
  });

  await test('with the engine address in place, neither mode mentions it', () => {
    const world = mkWorld();
    const link = `${world.home}/.claude/workkit`;
    const res = install(world);
    const checked = check(world);
    const said = `${res.stdout}${res.stderr}${checked.stdout}${checked.stderr}`;
    assert(!said.includes(link), `no line names the link: ${said}`);
    cleanup(world.root);
  });

  // A copy of the engine somewhere else: no git, no plugin cache around it.
  const strayKit = () => {
    const kit = mkTmp('workkit-install-');
    fs.cpSync(path.join(REPO, 'workflow'), path.join(kit, 'workflow'), { recursive: true });
    return path.join(kit, 'workflow');
  };

  await test('an engine address at some other copy: install names where it points', () => {
    const world = mkWorld({ engineLink: false });
    const other = strayKit();
    fs.mkdirSync(path.join(world.home, '.claude'), { recursive: true });
    fs.symlinkSync(other, path.join(world.home, '.claude', 'workkit'));
    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const said = `${res.stdout}${res.stderr}`;
    assert(said.split('\n').some((l) => l.includes('⚠') && l.includes(other)), `a warn names ${other}: ${said}`);
    cleanup(world.root); cleanup(path.dirname(other));
  });

  // The plugin cache copy installs beside a clone its owner chose: the clone
  // keeps the address, and that is the expected state, not a fault.
  await test('an engine address at a workkit clone, installed from the plugin cache: no warn', () => {
    const world = mkWorld({ engineLink: false });
    const cloneRoot = mkTmp('workkit-install-');
    fs.cpSync(path.join(REPO, 'workflow'), path.join(cloneRoot, 'workflow'), { recursive: true });
    mkOriginRepo(cloneRoot, 'https://github.com/owner/workkit.git');
    const claude = path.join(world.home, '.claude');
    fs.mkdirSync(claude, { recursive: true });
    fs.symlinkSync(path.join(cloneRoot, 'workflow'), path.join(claude, 'workkit'));
    const cache = path.join(claude, 'plugins', 'cache', 'workkit', 'workkit', '0.0.0');
    mkPluginCopy(cache, { dirs: ['workflow', 'jobs'] });
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(cache, 'jobs', 'install.sh'))], { encoding: 'utf8', timeout: 30000, env: world.env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const said = `${res.stdout}${res.stderr}`;
    assert(!said.includes('⚠'), `the clone outranks the cache copy, so nothing is wrong: ${said}`);
    assert(fs.existsSync(world.installed), 'and the schedule is installed');
    cleanup(world.root); cleanup(cloneRoot);
  });

  group('jobs/install: loading');

  await test('a first install boots the agent out and back in', () => {
    const world = mkWorld();
    install(world);
    const calls = world.calls();
    assert(calls.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${LABEL}`)), `the old one goes first: ${fmtCalls(calls)}`);
    assert(calls.some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL))), `then the new one loads: ${fmtCalls(calls)}`);
    cleanup(world.root);
  });

  await test('a second run with the agent loaded changes nothing', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    const first = fs.readFileSync(world.installed, 'utf8');
    const before = world.calls().length;

    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(new RegExp(`✓ ${LABEL} → already installed and loaded`).test(res.stdout), `it says so: ${res.stdout}`);
    assertEq(fs.readFileSync(world.installed, 'utf8'), first, 'the plist is untouched');

    const added = world.calls().slice(before);
    assertEq(added.length, 1, `only the print check: ${fmtCalls(added)}`);
    assert(added.every((c) => isCall(c, 'print')), 'and it was the print check');
    cleanup(world.root);
  });

  await test('an installed but unloaded agent is loaded without being rewritten', () => {
    const world = mkWorld({ loaded: false });
    install(world);
    const before = world.calls().length;

    const res = install(world);
    assert(/loaded \(plist unchanged\)/.test(res.stdout), `it says what it did: ${res.stdout}`);
    const added = world.calls().slice(before);
    assertEq(added.length, 2, `print, then bootstrap: ${fmtCalls(added)}`);
    assert(isCall(added[1], 'bootstrap'), 'no bootout: there was nothing to remove');
    assert(!added.some((c) => isCall(c, 'bootout')), `and nothing was booted out: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  await test('a changed plist is reinstalled', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    fs.appendFileSync(world.installed, '\n<!-- stale -->\n');
    const before = world.calls().length;

    install(world);
    assert(!fs.readFileSync(world.installed, 'utf8').includes('stale'), 'the stale copy is replaced');
    const added = world.calls().slice(before);
    assert(added.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${LABEL}`)), `and the running agent is booted out: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  await test('an agent loaded from someone else’s plist is re-registered', () => {
    const world = mkWorld({ loaded: true, loadedPath: '/somewhere/stale.plist' });
    install(world);
    const before = world.calls().length;

    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/reloaded \(was registered from \/somewhere\/stale\.plist\)/.test(res.stdout), `it names the stray path: ${res.stdout}`);

    const added = world.calls().slice(before);
    assertEq(added.length, 3, `print, bootout, bootstrap: ${fmtCalls(added)}`);
    assert(isCall(added[1], 'bootout', `gui/${process.getuid()}/${LABEL}`), `the stray registration goes first: ${fmtCalls(added)}`);
    assert(isCall(added[2], 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL)), `then this checkout’s plist loads: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  await test('a loaded agent whose path cannot be read is re-registered too', () => {
    const world = mkWorld({ loaded: true, loadedPath: '' });
    install(world);
    const before = world.calls().length;

    const res = install(world);
    assert(/reloaded \(was registered from an unreadable path\)/.test(res.stdout), `it says what it could not read: ${res.stdout}`);
    const added = world.calls().slice(before);
    assert(added.some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL))), `and loads this one: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  group('jobs/install: the real-home guard');

  await test('a run under a scratch home asks launchd for nothing', () => {
    const world = mkWorld({ launchdOk: false });
    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(fmtCalls(world.calls()), '', 'not one launchctl call: the gui domain is the whole machine’s');
    assert(/would boot.*\(skipped: HOME is not this account's home/.test(res.stdout), `and it says what it would have done: ${res.stdout}`);
    assert(fs.existsSync(world.installed), 'the plist is still rendered into the scratch home');
    cleanup(world.root);
  });

  await test('a scratch home with an installed plist still skips the load', () => {
    const world = mkWorld({ loaded: false });
    install(world);
    const before = world.calls().length;

    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...world.env, WORKKIT_LAUNCHD_OK: '' },
    });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(fmtCalls(world.calls().slice(before)), '', 'launchd is not even asked whether it is loaded');
    assert(/would bootstrap it \(plist unchanged\)/.test(res.stdout), `it says so: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('the override is what lets a fixture home talk to launchd', () => {
    const world = mkWorld({ launchdOk: true });
    const res = install(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(world.calls().some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL))), `the calls happen: ${fmtCalls(world.calls())}`);
    assert(!/skipped/.test(res.stdout), `and nothing is skipped: ${res.stdout}`);
    cleanup(world.root);
  });

  group('jobs/install: --check, the drift report');

  await test('a machine with nothing installed says the agent is not installed', () => {
    const world = mkWorld();
    const res = check(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(new RegExp(`✓ ${LABEL} → not installed`).test(res.stdout), `it says so: ${res.stdout}`);
    assertEq(world.rendered().join(','), '', 'and writes nothing');
    cleanup(world.root);
  });

  await test('a current machine reports nothing, and never asks launchd', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    const before = world.calls().length;
    const res = check(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(res.stdout, '', `silence is "current": ${res.stdout}`);
    assertEq(world.calls().length, before, `no launchctl call at all: ${fmtCalls(world.calls().slice(before))}`);
    cleanup(world.root);
  });

  await test('a plist from another checkout reads as out of date, and is not replaced', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    fs.appendFileSync(world.installed, '\n<!-- from an older checkout -->\n');
    const res = check(world);
    assert(new RegExp(`✓ ${LABEL} → out of date`).test(res.stdout), `it names the drift: ${res.stdout}`);
    assert(fs.readFileSync(world.installed, 'utf8').includes('older checkout'), 'and the check writes nothing');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
