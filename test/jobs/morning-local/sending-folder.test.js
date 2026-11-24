// Tests for jobs/morning.sh as this machine runs it: the folder it runs from,
// the PATH a send runs on, and the scratch folder a TERM mid-send leaves behind.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, until, alive, pidIn, start, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  BASH, NO_RC, shellPath, spawnBash, stubToolJs,
} = require('../../lib/platform');
const {
  skipUnlessDarwin, SCRIPT, INSTRUCTION, cleanup, mkWorld, runJob, skipOnUsrLocalBin, withBarePath,
} = require('./helpers');

describe('jobs/morning (local)', { skip: skipUnlessDarwin() }, () => {
  describe('jobs/morning (local): the folder it runs from', () => {
    // launchd runs the job as `<home>/.claude/workkit/../jobs/morning.sh`. A
    // logical cd reads that `..` lexically, so a stray ~/.claude/jobs would
    // become the job's folder; it must resolve its real one through the link.
    test('run through the engine address, a stray ~/.claude/jobs is not its folder', () => {
      const world = mkWorld();
      fs.symlinkSync(path.join(path.dirname(SCRIPT), '..', 'workflow'), path.join(world.home, '.claude', 'workkit'));
      fs.mkdirSync(path.join(world.home, '.claude', 'jobs'));
      const viaLink = `${shellPath(world.home)}/.claude/workkit/../jobs/morning.sh`;
      const res = spawnBash([...NO_RC, viaLink, '--now'], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const calls = world.calls();
      expect(calls.length, `the brief was composed and sent: ${fmtCalls(calls)}`).toBe(1);
      expect(calls[0][1].startsWith(INSTRUCTION), 'from the real jobs folder\'s payload builder').toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/morning (local): sending', () => {
    test('the send runs on a PATH that carries /usr/local/bin', { skip: skipOnUsrLocalBin() }, () => {
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

    test('a run ended by TERM mid-send leaves no morning- scratch folder in its temp folder', async (t) => {
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

      const job = start(BASH, [...NO_RC, shellPath(SCRIPT), 'hello'], { env: world.env });
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
