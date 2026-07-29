//
// Tests for jobs/install.sh — the LaunchAgent installer.
//
// HOME is a scratch directory and `launchctl` is a recorder on PATH, so nothing
// here touches ~/Library/LaunchAgents or the real gui domain: the suite reads
// the plist that WOULD be installed and the commands that WOULD load it.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, isCall, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'install.sh');
const REPO = path.join(__dirname, '..', '..');

// The one agent this checkout installs — the 9am job, which runs the summaries
// step and then the brief.
const AGENT = { label: 'com.workkit.claude-daily', runner: 'claude-daily.sh', hour: '9' };
const LABEL = AGENT.label;

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-install-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home plus a `launchctl` recorder. `loaded` decides what
 * `launchctl print` answers for the agent this checkout installs — the
 * difference between one already running and one never bootstrapped.
 */
const mkWorld = ({ loaded = false } = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const log = path.join(root, 'launchctl-argv.log');
  const stub = path.join(bin, 'launchctl');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    recordArgv(log),
    'if [[ "$1" == \'print\' ]]; then',
    '  case "$2" in',
    `    */${LABEL}) exit ${loaded ? 0 : 1} ;;`,
    '  esac',
    '  exit 1',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(stub, 0o755);

  const agents = path.join(home, 'Library', 'LaunchAgents');

  return {
    root,
    home,
    calls: () => readArgv(log),
    plist: (label) => path.join(agents, `${label}.plist`),
    rendered: () => (fs.existsSync(agents) ? fs.readdirSync(agents).sort() : []),
    installed: path.join(agents, `${LABEL}.plist`),
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  };
};

const install = (world) => spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30000, env: world.env });
const check = (world) => spawnSync('bash', [SCRIPT, '--check'], { encoding: 'utf8', timeout: 30000, env: world.env });

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('launchd and plutil are macOS');

  group('jobs/install: rendering');

  await test('the daily agent is rendered, for this checkout and this home', () => {
    const world = mkWorld();
    const res = install(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    const plist = fs.readFileSync(world.plist(LABEL), 'utf8');
    assert(!plist.includes('{{'), `no placeholder survives: ${plist}`);
    assert(plist.includes(`${fs.realpathSync(REPO)}/jobs/${AGENT.runner}`), `${AGENT.runner} is this checkout’s`);
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

  await test('it is the only agent installed — one job, one cron', () => {
    const world = mkWorld();
    install(world);
    assertEq(world.rendered().join(','), `${LABEL}.plist`, 'nothing else is rendered into LaunchAgents');
    cleanup(world.root);
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
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(new RegExp(`${LABEL} → already installed and loaded`).test(res.stdout), `it says so: ${res.stdout}`);
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
    assert(isCall(added[1], 'bootstrap'), 'no bootout — there was nothing to remove');
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

  group('jobs/install: --check, the drift report');

  await test('a machine with nothing installed says the agent is not installed', () => {
    const world = mkWorld();
    const res = check(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(new RegExp(`${LABEL} → not installed`).test(res.stdout), `it says so: ${res.stdout}`);
    assertEq(world.rendered().join(','), '', 'and writes nothing');
    cleanup(world.root);
  });

  await test('a current machine reports nothing, and never asks launchd', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    const before = world.calls().length;
    const res = check(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(res.stdout, '', `silence is "current": ${res.stdout}`);
    assertEq(world.calls().length, before, `no launchctl call at all: ${fmtCalls(world.calls().slice(before))}`);
    cleanup(world.root);
  });

  await test('a plist from another checkout reads as out of date, and is not replaced', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    fs.appendFileSync(world.installed, '\n<!-- from an older checkout -->\n');
    const res = check(world);
    assert(new RegExp(`${LABEL} → out of date`).test(res.stdout), `it names the drift: ${res.stdout}`);
    assert(fs.readFileSync(world.installed, 'utf8').includes('older checkout'), 'and the check writes nothing');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
