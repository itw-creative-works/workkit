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

// The two agents this checkout installs, each with the runner it schedules and
// the hour it runs at.
const AGENTS = [
  { label: 'com.workkit.claude-daily', runner: 'claude-daily.sh', hour: '9' },
  { label: 'com.workkit.claude-nightly', runner: 'claude-nightly.sh', hour: '3' },
];
const LABEL = AGENTS[0].label;

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workkit-install-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home plus a `launchctl` recorder. `loaded` decides what
 * `launchctl print` answers — the difference between an agent already running
 * and one that has never been bootstrapped.
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
    `[[ "$1" == 'print' ]] && exit ${loaded ? 0 : 1}`,
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(stub, 0o755);

  return {
    root,
    home,
    calls: () => readArgv(log),
    plist: (label) => path.join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    installed: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  };
};

const install = (world) => spawnSync('bash', [SCRIPT], { encoding: 'utf8', timeout: 30000, env: world.env });

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('launchd and plutil are macOS');

  group('jobs/install: rendering');

  await test('both agents are rendered, for this checkout and this home', () => {
    const world = mkWorld();
    const res = install(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    for (const agent of AGENTS) {
      const plist = fs.readFileSync(world.plist(agent.label), 'utf8');
      assert(!plist.includes('{{'), `no placeholder survives in ${agent.label}: ${plist}`);
      assert(plist.includes(`${fs.realpathSync(REPO)}/jobs/${agent.runner}`), `${agent.runner} is this checkout’s`);
      assert(plist.includes(`${world.home}/Library/Logs/${agent.label}.log`), 'and the log is under this home');
    }
    cleanup(world.root);
  });

  await test('each is a valid plist, scheduled on its own hour', () => {
    const world = mkWorld();
    install(world);
    for (const agent of AGENTS) {
      const file = world.plist(agent.label);
      const lint = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
      assertEq(lint.status, 0, `plutil -lint: ${lint.stdout}${lint.stderr}`);
      const key = (name) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${name}`, file], { encoding: 'utf8' }).stdout.trim();
      assertEq(key('Label'), agent.label, 'the label');
      assertEq(key('StartCalendarInterval:Hour'), agent.hour, `${agent.label} runs at ${agent.hour}`);
      assertEq(key('StartCalendarInterval:Minute'), '0', 'o’clock');
    }
    cleanup(world.root);
  });

  group('jobs/install: loading');

  await test('a first install boots each agent out and back in', () => {
    const world = mkWorld();
    install(world);
    const calls = world.calls();
    for (const agent of AGENTS) {
      assert(calls.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${agent.label}`)), `the old ${agent.label} goes first: ${fmtCalls(calls)}`);
      assert(calls.some((c) => isCall(c, 'bootstrap', `gui/${process.getuid()}`, world.plist(agent.label))), `then the new one loads: ${fmtCalls(calls)}`);
    }
    cleanup(world.root);
  });

  await test('a second run with both agents loaded changes nothing', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    const first = AGENTS.map((a) => fs.readFileSync(world.plist(a.label), 'utf8'));
    const before = world.calls().length;

    const res = install(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    for (const agent of AGENTS) {
      assert(new RegExp(`${agent.label} → already installed and loaded`).test(res.stdout), `it says so for ${agent.label}: ${res.stdout}`);
    }
    AGENTS.forEach((agent, i) => {
      assertEq(fs.readFileSync(world.plist(agent.label), 'utf8'), first[i], `${agent.label} is untouched`);
    });

    const added = world.calls().slice(before);
    assertEq(added.length, AGENTS.length, `only one print check each: ${fmtCalls(added)}`);
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
    assertEq(added.length, AGENTS.length * 2, `print, then bootstrap, per agent: ${fmtCalls(added)}`);
    assert(isCall(added[1], 'bootstrap'), 'no bootout — there was nothing to remove');
    assert(!added.some((c) => isCall(c, 'bootout')), `and nothing was booted out: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  await test('a changed plist is reinstalled, and its sibling is left alone', () => {
    const world = mkWorld({ loaded: true });
    install(world);
    fs.appendFileSync(world.installed, '\n<!-- stale -->\n');
    const sibling = AGENTS[1];
    const untouched = fs.readFileSync(world.plist(sibling.label), 'utf8');
    const before = world.calls().length;

    install(world);
    assert(!fs.readFileSync(world.installed, 'utf8').includes('stale'), 'the stale copy is replaced');
    assertEq(fs.readFileSync(world.plist(sibling.label), 'utf8'), untouched, 'the other agent does not churn');
    const added = world.calls().slice(before);
    assert(added.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${LABEL}`)), `and the running agent is booted out: ${fmtCalls(added)}`);
    assert(!added.some((c) => isCall(c, 'bootout', `gui/${process.getuid()}/${sibling.label}`)), `only that one: ${fmtCalls(added)}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
