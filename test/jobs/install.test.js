// Tests for jobs/install.js, the 9am job's installer. HOME is scratch and
// `launchctl` (on a Mac) or `schtasks` (the Windows half, on every system) is a recorder on PATH, so the
// suite reads what would be installed and the commands that would register it,
// never the machine's own scheduler.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  recordArgvJs, readArgv, isCall, fmtCalls,
} = require('../lib/argv-log');
// The installer starts through run.js as every case's child does; the plist
// tools below stay raw.
const {
  IS_WINDOWS, NODE_DIR, homeEnv, nodeHomeEnv, shellPath, stubToolJs, pathWith, gitPath, spawnSync: spawnThroughRun,
} = require('../lib/platform');
const { schtasksStub } = require('../lib/schtasks-stub');
const { mkPluginCopy } = require('../lib/plugin-copy');
const { mkOriginRepo } = require('../lib/git-repo');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'install.js');
const REPO = path.join(__dirname, '..', '..');

// The one agent this checkout installs: the 9am job, which runs the summaries
// step and then the brief. The label is the schedule's name and outlives the
// script it points at, the one morning entry point.
const AGENT = { label: 'com.workkit.claude-daily', hour: '9' };
const LABEL = AGENT.label;

// The PATH launchd hands a job when its file names none.
const LAUNCHD_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/**
 * The daily agent's whole text for a home and the folder of the Node that ran
 * the install, written out: launchd reads the file as written. It starts the
 * starter through the engine address, and launchd leaves the morning it starts.
 */
const dailyAgent = ({ home, nodeDir }) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>Label</key>',
  '\t<string>com.workkit.claude-daily</string>',
  '\t<key>ProgramArguments</key>',
  '\t<array>',
  '\t\t<string>/usr/bin/env</string>',
  '\t\t<string>node</string>',
  `\t\t<string>${home}/.claude/workkit/morning-task.js</string>`,
  '\t</array>',
  '\t<key>AbandonProcessGroup</key>',
  '\t<true/>',
  '\t<key>EnvironmentVariables</key>',
  '\t<dict>',
  '\t\t<key>PATH</key>',
  `\t\t<string>${nodeDir}:${home}/.local/bin:${home}/.nvm/default-bin:/opt/homebrew/bin:/usr/local/bin:${LAUNCHD_PATH.join(':')}</string>`,
  '\t</dict>',
  '\t<key>StartCalendarInterval</key>',
  '\t<dict>',
  '\t\t<key>Hour</key>',
  '\t\t<integer>9</integer>',
  '\t\t<key>Minute</key>',
  '\t\t<integer>0</integer>',
  '\t</dict>',
  '\t<key>StandardOutPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '\t<key>StandardErrorPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '</dict>',
  '</plist>',
  '',
].join('\n');

// The agent a kit that named its own folder in the program line installed.
const kitAgent = ({ home, nodeDir, kit }) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>Label</key>',
  '\t<string>com.workkit.claude-daily</string>',
  '\t<key>ProgramArguments</key>',
  '\t<array>',
  '\t\t<string>/usr/bin/env</string>',
  '\t\t<string>node</string>',
  `\t\t<string>${kit}/jobs/morning.js</string>`,
  '\t</array>',
  '\t<key>EnvironmentVariables</key>',
  '\t<dict>',
  '\t\t<key>PATH</key>',
  `\t\t<string>${nodeDir}:${home}/.local/bin:${home}/.nvm/default-bin:/opt/homebrew/bin:/usr/local/bin:${LAUNCHD_PATH.join(':')}</string>`,
  '\t</dict>',
  '\t<key>StartCalendarInterval</key>',
  '\t<dict>',
  '\t\t<key>Hour</key>',
  '\t\t<integer>9</integer>',
  '\t\t<key>Minute</key>',
  '\t\t<integer>0</integer>',
  '\t</dict>',
  '\t<key>StandardOutPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '\t<key>StandardErrorPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '</dict>',
  '</plist>',
  '',
].join('\n');

// The agent a kit that still had its shell starter installed.
const shellAgent = (home) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>Label</key>',
  '\t<string>com.workkit.claude-daily</string>',
  '\t<key>ProgramArguments</key>',
  '\t<array>',
  '\t\t<string>/bin/bash</string>',
  `\t\t<string>${home}/.claude/workkit/../jobs/morning.sh</string>`,
  '\t</array>',
  '\t<key>StartCalendarInterval</key>',
  '\t<dict>',
  '\t\t<key>Hour</key>',
  '\t\t<integer>9</integer>',
  '\t\t<key>Minute</key>',
  '\t\t<integer>0</integer>',
  '\t</dict>',
  '\t<key>StandardOutPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '\t<key>StandardErrorPath</key>',
  `\t<string>${home}/Library/Logs/com.workkit.claude-daily.log</string>`,
  '</dict>',
  '</plist>',
  '',
].join('\n');

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
 * starts the morning through, at this checkout's engine. `homeName` is the home folder's name.
 */
const mkWorld = ({
  loaded = false, loadedPath = null, scheduleOk = true, engineLink = true, homeName = 'home',
} = {}) => {
  const root = mkTmp('workkit-install-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, homeName);
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  if (engineLink) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(REPO, 'workflow'), path.join(home, '.claude', 'workkit'));
  }

  const agents = path.join(home, 'Library', 'LaunchAgents');
  const body = loadedPath === null ? path.join(agents, `${LABEL}.plist`) : loadedPath;

  const logFile = path.join(root, 'launchctl-argv.log');
  const stub = stubToolJs(bin, 'launchctl', [
    recordArgvJs(JSON.stringify(logFile)),
    'const argv = process.argv.slice(2);',
    "if (argv[0] === 'print') {",
    ...(loaded ? [`  if ((argv[1] ?? '').endsWith(${JSON.stringify(`/${LABEL}`)})) process.stdout.write(${JSON.stringify(`\tpath = ${body}\n`)});`, '  else process.exitCode = 1;'] : ['  process.exitCode = 1;']),
    '}',
  ].join('\n'));

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
    // The job starts under the first node on the file's own PATH, the folder of
    // the Node that ran the install first, and reaches the kit through the
    // engine address when it runs, so a moved kit needs no new file.
    test('the daily agent for a home and a Node folder is its whole text, starting the engine address\'s starter', () => {
      const world = mkWorld();
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fs.readFileSync(world.plist(LABEL), 'utf8'), 'the installed plist')
        .toBe(dailyAgent({ home: world.env.HOME, nodeDir: NODE_DIR }));
      cleanup(world.root);
    });

    test('the agent is the same text whatever the engine link names: this kit, another kit, or no link', () => {
      const other = strayKit();
      const states = [['this kit', path.join(REPO, 'workflow')], ['another kit', other], ['no link', null]];
      for (const [state, target] of states) {
        const world = mkWorld({ engineLink: false });
        if (target) {
          fs.mkdirSync(path.join(world.home, '.claude'), { recursive: true });
          fs.symlinkSync(target, path.join(world.home, '.claude', 'workkit'));
        }
        const res = install(world);
        expect(res.status, `${state}: exit 0, stderr: ${res.stderr}`).toBe(0);
        expect(fs.readFileSync(world.plist(LABEL), 'utf8'), `${state}: the installed plist`)
          .toBe(dailyAgent({ home: world.env.HOME, nodeDir: NODE_DIR }));
        cleanup(world.root);
      }
      cleanup(path.dirname(other));
    });

    // launchd parses the file as XML, so a home holding `&` is written escaped.
    test('a home whose path holds & renders it as &amp; in every line that names it', () => {
      const world = mkWorld({ homeName: 'a&b' });
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fs.readFileSync(world.plist(LABEL), 'utf8'), 'the installed plist')
        .toBe(dailyAgent({ home: `${world.root}/a&amp;b`, nodeDir: NODE_DIR }));
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
    test('no engine address: install and --check both warn, naming the link, that the job cannot reach the kit', () => {
      const world = mkWorld({ engineLink: false });
      const link = `${world.home}/.claude/workkit`;
      const unreached = (text) => text.split('\n').some((l) => l.includes('⚠') && l.includes(link) && l.includes('cannot reach'));
      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const said = `${res.stdout}${res.stderr}`;
      expect(unreached(said), `install warns, naming ${link}: ${said}`).toBeTruthy();
      const checked = check(world);
      const checkSaid = `${checked.stdout}${checked.stderr}`;
      expect(unreached(checkSaid), `and so does --check: ${checkSaid}`).toBeTruthy();
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
        recordArgvJs(JSON.stringify(world.logFile)),
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

    // The edge between the kit's update and `workkit update`: the installed file
    // starts morning.sh, a file this kit does not hold.
    test('an installed agent that starts morning.sh is rewritten and reloaded', () => {
      const world = mkWorld({ loaded: true });
      fs.mkdirSync(path.dirname(world.installed), { recursive: true });
      fs.writeFileSync(world.installed, shellAgent(world.env.HOME));

      const res = install(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(fs.readFileSync(world.installed, 'utf8'), 'the file is the agent this kit renders')
        .toBe(dailyAgent({ home: world.env.HOME, nodeDir: NODE_DIR }));
      const loads = bootCalls(world.calls());
      expect(loads.length, `one bootout, one bootstrap: ${fmtCalls(loads)}`).toBe(2);
      expect(isCall(loads[0], 'bootout', `gui/${process.getuid()}/${LABEL}`), `the running agent goes first: ${fmtCalls(loads)}`).toBeTruthy();
      expect(isCall(loads[1], 'bootstrap', `gui/${process.getuid()}`, world.plist(LABEL)), `then the new file loads: ${fmtCalls(loads)}`).toBeTruthy();
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

    // The installed file names the kit's own folder, which a moved kit leaves behind.
    test('an installed agent that starts the kit\'s own jobs/morning.js reads as out of date, and is neither rewritten nor loaded', () => {
      const world = mkWorld({ loaded: true });
      const old = kitAgent({ home: world.env.HOME, nodeDir: NODE_DIR, kit: fs.realpathSync(REPO) });
      fs.mkdirSync(path.dirname(world.installed), { recursive: true });
      fs.writeFileSync(world.installed, old);

      const res = check(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, 'the one line the update relays').toBe(`✓ ${LABEL} → out of date for this kit\n`);
      expect(fs.readFileSync(world.installed, 'utf8'), 'the installed file is as it was').toBe(old);
      expect(fmtCalls(world.calls()), 'and launchd was never asked').toBe('');
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

    test('a current machine whose engine link then moves to another kit: --check says nothing about the agent', () => {
      const world = mkWorld({ loaded: true });
      install(world);
      const link = path.join(world.home, '.claude', 'workkit');
      const other = strayKit();
      fs.unlinkSync(link);
      fs.symlinkSync(other, link);
      const res = check(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      // A matching machine prints nothing; the one line left is the link's own warning.
      const said = `${res.stdout}${res.stderr}`;
      const rest = said.split('\n').filter(Boolean).filter((l) => !(l.includes('⚠') && l.includes(other)));
      expect(rest, `nothing but the warning naming where the link points: ${said}`).toEqual([]);
      cleanup(world.root); cleanup(path.dirname(other));
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

// The launchd file's PATH and the one a job builds for its children, asked in this process.
describe('jobs/lib/machine: jobPath', { skip: IS_WINDOWS && 'a launchd PATH is a Mac\'s, spelled with /' }, () => {
  test('the Node folder, then the folders enterMachine puts in front, in its order, then launchd\'s own', () => {
    const { jobPath, enterMachine } = require('../../jobs/lib/machine');
    const env = { HOME: '/Users/ada', PATH: LAUNCHD_PATH.join(':') };
    enterMachine(env, { platform: 'darwin' });
    const entered = env.PATH.split(':');
    const front = entered.slice(0, entered.length - LAUNCHD_PATH.length);
    expect(front.length > 0, `enterMachine put folders in front: ${env.PATH}`).toBeTruthy();
    expect(jobPath('/Users/ada', '/opt/node/bin').split(':'), 'the launchd file\'s PATH')
      .toEqual(['/opt/node/bin', ...front, ...LAUNCHD_PATH]);
  });
});

describe('jobs/install: a HOME no cygpath can read', () => {
  // The installer itself reads HOME before it renders a task or asks schtasks.
  // PATH is node's folder alone: Git's usr/bin, where cygpath lives, is left off.
  test('a HOME in the shell\'s spelling with no cygpath on PATH: the one line naming HOME and the fix, exit 1, no stack', {
    skip: !IS_WINDOWS && 'off Windows a home is never handed to cygpath',
  }, () => {
    const world = mkTaskWorld();
    const home = shellPath(world.home);
    const res = runInstaller(SCRIPT, [], { ...world.env, HOME: home, PATH: NODE_DIR });
    expect(res.status, `exit 1, got: ${res.stdout}${res.stderr}`).toBe(1);
    expect(res.stdout, 'nothing on stdout').toBe('');
    expect(res.stderr, 'the one line').toBe(`workkit: cannot read HOME (${home}): cygpath could not convert it (ENOENT); start the command from Git Bash, or set HOME to a drive path (C:/Users/name)\n`);
    expect(/^ {4}at /m.test(res.stderr), `no stack line, got: ${res.stderr}`).toBe(false);
    expect(fs.existsSync(world.copy), 'and no copy').toBe(false);
    cleanup(world.root);
  });
});
