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
// The 3am agent it replaced. An install has to take it off a machine that still
// carries it, or the summaries would run twice a day.
const RETIRED = 'com.workkit.claude-nightly';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-install-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home plus a `launchctl` recorder. `loaded` and `retiredLoaded`
 * decide what `launchctl print` answers PER LABEL — the difference between an
 * agent already running and one that has never been bootstrapped, asked
 * separately of the agent this checkout installs and of the one it retires.
 */
const mkWorld = ({ loaded = false, retiredLoaded = false } = {}) => {
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
    `    */${RETIRED}) exit ${retiredLoaded ? 0 : 1} ;;`,
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
    seedPlist: (label, text) => {
      fs.mkdirSync(agents, { recursive: true });
      fs.writeFileSync(path.join(agents, `${label}.plist`), text);
    },
    installed: path.join(agents, `${LABEL}.plist`),
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  };
};

const install = (world) => spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30000, env: world.env });

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
    // The print that confirms the daily is loaded, and the print that asks
    // whether the retired agent still is.
    assertEq(added.length, 2, `only the print checks: ${fmtCalls(added)}`);
    assert(added.every((c) => isCall(c, 'print')), 'and they were the print checks');
    cleanup(world.root);
  });

  await test('an installed but unloaded agent is loaded without being rewritten', () => {
    const world = mkWorld({ loaded: false });
    install(world);
    const before = world.calls().length;

    const res = install(world);
    assert(/loaded \(plist unchanged\)/.test(res.stdout), `it says what it did: ${res.stdout}`);
    const added = world.calls().slice(before);
    assertEq(added.length, 3, `print, bootstrap, then the retirement check: ${fmtCalls(added)}`);
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

  group('jobs/install: retiring the 3am agent');

  await test('a machine still carrying it has it unloaded and its plist removed', () => {
    const world = mkWorld({ loaded: true, retiredLoaded: true });
    world.seedPlist(RETIRED, '<!-- the 3am agent, from before -->\n');
    const res = install(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    const calls = world.calls();
    assert(calls.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${RETIRED}`)), `it is booted out: ${fmtCalls(calls)}`);
    assert(!fs.existsSync(world.plist(RETIRED)), 'and its plist is gone');
    assertEq(world.rendered().join(','), `${LABEL}.plist`, 'leaving one agent behind');
    assert(new RegExp(`${RETIRED} → retired`).test(res.stdout), `it says what it removed: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('a machine that never had it hears nothing', () => {
    const world = mkWorld({ loaded: false });
    const res = install(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(!/retired/.test(res.stdout), `no noise about an agent that was never there: ${res.stdout}`);
    assert(!world.calls().some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${RETIRED}`)), 'and nothing is booted out for it');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
