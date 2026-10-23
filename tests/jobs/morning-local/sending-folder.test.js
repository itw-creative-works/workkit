// Tests for jobs/morning.sh as this machine runs it: the folder it runs from,
// and the PATH a send runs on.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  skipUnlessDarwin, SCRIPT, INSTRUCTION, cleanup, mkWorld, runJob, barePathTest, withBarePath,
} = require('./helpers');
const { SPAWN_DEADLINE } = require('../../lib/process');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the folder it runs from');

  // launchd runs the job as `<home>/.claude/workkit/../jobs/morning.sh`. A
  // logical cd reads that `..` lexically, so a stray ~/.claude/jobs would
  // become the job's folder; it must resolve its real one through the link.
  await test('run through the engine address, a stray ~/.claude/jobs is not its folder', () => {
    const world = mkWorld();
    fs.symlinkSync(path.join(path.dirname(SCRIPT), '..', 'workflow'), path.join(world.home, '.claude', 'workkit'));
    fs.mkdirSync(path.join(world.home, '.claude', 'jobs'));
    const viaLink = `${shellPath(world.home)}/.claude/workkit/../jobs/morning.sh`;
    const res = spawnSync(BASH, [...NO_RC, viaLink, '--now'], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `the brief was composed and sent: ${fmtCalls(calls)}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'from the real jobs folder\'s payload builder');
    cleanup(world.root);
  });

  group('jobs/morning (local): sending');

  await barePathTest('the send runs on a PATH that carries /usr/local/bin', () => {
    // Intel Homebrew and the nodejs.org installer both put node there.
    const world = mkWorld();
    withBarePath(world);
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const seen = world.sendPaths();
    assertEq(seen.length, 1, `claude ran once: ${seen.join(' | ')}`);
    assert(seen[0].split(':').includes('/usr/local/bin'), `the job's own PATH adds it: ${seen[0]}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
