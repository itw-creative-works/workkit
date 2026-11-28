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
const {
  SCRIPT, INSTRUCTION, cleanup, mkWorld, runJob, skipOnUsrLocalBin, withBarePath,
} = require('./helpers');

const INSTALL = path.join(__dirname, '..', '..', '..', 'jobs', 'install.js');

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

describe('jobs/morning (local)', () => {
  describe('jobs/morning (local): the folder it runs from', () => {
    // launchd runs the job exactly as its file names it: `/usr/bin/env node`
    // on the file's own PATH, and the kit the engine link resolved to at install.
    // So the rendered file, run as it is, must start the morning whole.
    test('started as the launchd file starts it, the job runs from the kit\'s jobs folder', {
      skip: process.platform !== 'darwin' && 'the launchd file is a Mac\'s; the Windows task names workflow/morning-task.js',
    }, () => {
      const world = mkWorld();
      // The engine link the installer reads the kit from, at this checkout.
      fs.symlinkSync(path.join(path.dirname(SCRIPT), '..', 'workflow'), path.join(world.home, '.claude', 'workkit'));
      const agent = renderedAgent(world);
      const [program, ...args] = agent.ProgramArguments;
      // launchd's PATH is the file's own; the fake tools stay ahead of it.
      const env = { ...world.env, PATH: joinPath(path.join(world.root, 'bin'), agent.EnvironmentVariables.PATH) };
      const res = spawnSync(program, [...args, '--now'], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const calls = world.calls();
      expect(calls.length, `the brief was composed and sent: ${fmtCalls(calls)}`).toBe(1);
      expect(calls[0][1].startsWith(INSTRUCTION), 'from the real jobs folder\'s payload builder').toBeTruthy();
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
