// Tests for jobs/morning.js as this machine runs it: the folder it runs from,
// the PATH a send runs on, and the scratch folder a TERM mid-send leaves behind.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, start, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  joinPath, spawnSync, stubToolJs, skipWithoutCaughtSignal, skipWithoutHomebrewPath,
} = require('../../lib/platform');
const { mkPluginCopy } = require('../../lib/plugin-copy');
const {
  SCRIPT, BRIEF_TITLE_PREFIX, cleanup, mkWorld, runJob, skipOnUsrLocalBin, withBarePath,
} = require('./helpers');

const INSTALL = path.join(__dirname, '..', '..', '..', 'jobs', 'install.js');
const ENGINE = path.join(path.dirname(SCRIPT), '..', 'workflow');

const SKIP_OFF_MAC = process.platform !== 'darwin' && 'the launchd file is a Mac\'s; the Windows task names workflow/morning-task.js';

/**
 * The launchd file jobs/install.js renders for the world's home, read back as
 * JSON. No launchd is asked: the home is scratch, so the installer's guard
 * skips every launchctl call, and a stand-in that does nothing is first on PATH.
 */
const renderedAgent = (world) => {
  const bin = path.join(world.root, 'bin');
  stubToolJs(bin, 'launchctl', 'process.exitCode = 0;');
  const entry = path.join(world.root, 'install-darwin.js');
  fs.writeFileSync(entry, `process.exitCode = require(${JSON.stringify(INSTALL)}).main([], { platform: 'darwin' });\n`);
  const env = { ...world.env };
  delete env.WORKKIT_SCHEDULE_OK;
  const res = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
  expect(res.status, `the installer rendered the agent: ${res.stdout}${res.stderr}`).toBe(0);
  const file = path.join(world.home, 'Library', 'LaunchAgents', 'com.workkit.claude-daily.plist');
  const json = spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  expect(json.status, `plutil read ${file}: ${json.stderr}`).toBe(0);
  return JSON.parse(json.stdout);
};

/** The agent's program started as launchd starts it: its own arguments, on its own PATH, the fake tools ahead. */
const startAgent = (world, agent) => {
  const [program, ...args] = agent.ProgramArguments;
  const env = { ...world.env, PATH: joinPath(path.join(world.root, 'bin'), agent.EnvironmentVariables.PATH) };
  return spawnSync(program, args, { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
};

/** What the morning wrote to the job's log and its own, for a failure message. */
const logsOf = (world) => {
  const jobLog = path.join(world.home, 'Library', 'Logs', 'com.workkit.claude-daily.log');
  return `${fs.existsSync(jobLog) ? fs.readFileSync(jobLog, 'utf8') : ''}${world.log()}`;
};

/**
 * Every node the world starts loads a file first that writes the pid of the one
 * whose program is a `morning.js` to the file it returns, so a case can wait for
 * the detached morning to end before its world is removed.
 */
const recordMorningPid = (world) => {
  const pidFile = path.join(world.root, 'morning.pid');
  const preload = path.join(world.root, 'morning-pid.js');
  fs.writeFileSync(preload, [
    "if (require('path').basename(process.argv[1] || '') === 'morning.js') {",
    `  require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    '}',
  ].join('\n'));
  world.env.NODE_OPTIONS = `--require ${preload}`;
  return pidFile;
};

/** Whether the morning whose pid `pidFile` holds started and has ended, by the shared deadline. */
const morningEnded = (pidFile) => until(() => pidIn(pidFile) > 0 && !alive(pidIn(pidFile)));

describe('jobs/morning (local)', () => {
  describe('jobs/morning (local): the folder it runs from', () => {
    // launchd runs the job exactly as its file names it: `/usr/bin/env node`
    // on the file's own PATH. The starter ends before the morning does, so a
    // case waits for the morning to end, then reads what it left behind.
    test('started as the launchd file starts it, the morning of the kit the engine link names runs', { skip: SKIP_OFF_MAC }, async (t) => {
      const world = mkWorld({ home: 'owner/private-home', dispatch: true, posted: [{ title: `${BRIEF_TITLE_PREFIX}2026-08-17` }] });
      fs.symlinkSync(ENGINE, path.join(world.home, '.claude', 'workkit'));
      const agent = renderedAgent(world);
      const pidFile = recordMorningPid(world);
      t.after(() => { const pid = pidIn(pidFile); if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL'); });
      const res = startAgent(world, agent);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(await morningEnded(pidFile), `the morning ran to its end: ${logsOf(world)}`).toBeTruthy();
      expect(world.marker() !== null, `it reached its marker step: ${logsOf(world)}`).toBeTruthy();
      expect(world.dispatched().length, `the day was handed to the cloud: ${fmtCalls(world.ghCalls())}`).toBe(1);
      expect(JSON.parse(world.marker()).lastBrief, `and the marker read the board: ${logsOf(world)}`).toBe('2026-08-17');
      cleanup(world.root);
    });

    test('the engine link moved to a second kit after the install: the same file starts that kit\'s morning', { skip: SKIP_OFF_MAC }, async (t) => {
      const world = mkWorld();
      const link = path.join(world.home, '.claude', 'workkit');
      fs.symlinkSync(ENGINE, link);
      const agent = renderedAgent(world);
      // The second kit's morning only says where it ran from.
      const second = path.join(world.root, 'second-kit');
      mkPluginCopy(second, { dirs: ['workflow', 'jobs', 'hooks'] });
      const mark = path.join(world.root, 'second-morning');
      fs.writeFileSync(path.join(second, 'jobs', 'morning.js'), `require('fs').writeFileSync(${JSON.stringify(mark)}, __filename);\n`);
      fs.unlinkSync(link);
      fs.symlinkSync(path.join(second, 'workflow'), link);
      const pidFile = recordMorningPid(world);
      t.after(() => { const pid = pidIn(pidFile); if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL'); });

      const res = startAgent(world, agent);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(await morningEnded(pidFile), `a morning ran to its end: ${logsOf(world)}`).toBeTruthy();
      const ran = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : '';
      expect(ran !== '', `the second kit's morning ran: ${logsOf(world)}`).toBeTruthy();
      expect(fs.realpathSync(ran), 'from the second kit\'s jobs folder').toBe(fs.realpathSync(path.join(second, 'jobs', 'morning.js')));
      cleanup(world.root);
    });
  });

  describe('jobs/morning (local): sending', () => {
    test('the send runs on a PATH that carries /usr/local/bin', { skip: skipOnUsrLocalBin() || skipWithoutHomebrewPath() }, () => {
      // Intel Homebrew and the nodejs.org installer both put node there.
      const world = mkWorld();
      withBarePath(world);
      const res = runJob(world, ['hello']);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const seen = world.sendPaths();
      expect(seen.length, `claude ran once: ${seen.join(' | ')}`).toBe(1);
      expect(seen[0].split(':').includes('/usr/local/bin'), `the job's own PATH adds it: ${seen[0]}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a run ended by TERM mid-send leaves no morning- scratch folder in its temp folder', { skip: skipWithoutCaughtSignal() }, async (t) => {
      const world = mkWorld();
      const temp = mkTmp('morning-local-temp-');
      world.env.TMPDIR = temp;
      // A send that never answers, its pid written first; ~/.local/bin is first on the job's PATH.
      const sendPid = path.join(world.root, 'send.pid');
      stubToolJs(world.localBin, 'claude', [
        `require('fs').writeFileSync(${JSON.stringify(sendPid)}, String(process.pid));`,
        'setInterval(() => {}, 2 ** 30);',
      ].join('\n'));
      t.after(() => { const pid = pidIn(sendPid); if (pid > 0 && alive(pid)) process.kill(pid, 'SIGKILL'); });

      const job = start(process.execPath, [SCRIPT, 'hello'], { env: world.env });
      t.after(() => job.end('SIGKILL'));
      expect(await until(() => pidIn(sendPid) > 0), `the send started: ${job.output()}`).toBeTruthy();
      const scratches = () => fs.readdirSync(temp).filter((name) => name.startsWith('morning-'));
      expect(scratches().length, `the run's scratch folder is there while it sends: ${fs.readdirSync(temp).join(', ')}`).toBe(1);
      // A sync send holds the morning until it ends, so the case ends it after the signal.
      process.kill(job.pid, 'SIGTERM');
      if (alive(pidIn(sendPid))) process.kill(pidIn(sendPid), 'SIGKILL');
      const { signal } = await job.done;
      expect(signal, `the morning ended by the TERM: ${job.output()}`).toBe('SIGTERM');
      expect(scratches(), `and its scratch folder is gone: ${job.output()}`).toEqual([]);
      cleanup(world.root);
    });
  });
});
