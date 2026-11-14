// Tests for jobs/morning.sh as this machine runs it: the folder it runs from,
// and the PATH a send runs on.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, SPAWN_DEADLINE } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
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
      const res = spawnSync(BASH, [...NO_RC, viaLink, '--now'], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
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
  });
});
