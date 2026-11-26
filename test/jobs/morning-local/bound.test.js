// Tests for jobs/morning.sh as this machine runs it: the job's bound on a child
// that never answers, held with no `timeout` program on the machine. A `gh`
// that never answers one call stands in for the network that does not either.
// The bound on a morning.d script is ./morning-d.test.js.
// The shared prologue (world factory, job runner, the bare PATH) is ./helpers.js.

const { describe, test, expect, alive, pidIn } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, mkWorld, runJob, plantStaleRunner, withoutTools, hangingGh, SHORT_BOUND,
} = require('./helpers');

describe('jobs/morning (local): the bound, with no timeout program', () => {
  test('a summaries run that outlasts the bound is ended, logged as 124, and the brief still goes', () => {
    const world = mkWorld({ home: 'owner/private-home' });
    withoutTools(world, ['timeout']);
    world.env.WORKKIT_JOB_TIMEOUT = SHORT_BOUND;
    // The summaries ask the board for a category before anything else; the
    // morning's own steps never do.
    const pidFile = hangingGh(world, '/discussionCategories|categoryId/');

    const res = runJob(world);
    expect(res.status, `the morning is not lost to the night before: ${res.stderr}`).toBe(0);
    const logText = world.log();
    const ended = logText.indexOf('[summaries exit 124; the brief continues]');
    expect(ended >= 0, `the block names the bound's code: ${logText}`).toBeTruthy();
    const handed = logText.indexOf('dispatched brief.yml on');
    expect(handed > ended, `and the day went over after it: ${logText}`).toBeTruthy();
    const pid = pidIn(pidFile);
    expect(pid > 0, `the summaries reached the call that never answers: ${fmtCalls(world.ghCalls())}\n${logText}`).toBeTruthy();
    expect(!alive(pid), `the hung call ${pid} was ended with the run that made it`).toBeTruthy();
    cleanup(world.root);
  });

  test('a site publish that outlasts the bound is ended, logged as 124, and the marker still runs', () => {
    const world = mkWorld({ home: 'owner/private-home', homeClone: true });
    plantStaleRunner(world);
    withoutTools(world, ['timeout']);
    world.env.WORKKIT_JOB_TIMEOUT = SHORT_BOUND;
    // The publish heals the home repo's labels; no step before it reads them.
    const pidFile = hangingGh(world, '/^label list/');

    const res = runJob(world);
    expect(res.status, `the morning is untouched: ${res.stderr}`).toBe(0);
    const logText = world.log();
    const handed = logText.indexOf('dispatched brief.yml on');
    const ended = logText.indexOf('[publish exit 124; the brief was already sent]');
    const marker = logText.indexOf('marker: ');
    expect(handed >= 0, `the day went over first: ${logText}`).toBeTruthy();
    expect(ended > handed, `then the publish's block names the bound's code: ${logText}`).toBeTruthy();
    expect(marker > ended, `and the marker step ran after it: ${logText}`).toBeTruthy();
    const pid = pidIn(pidFile);
    expect(pid > 0, `the publish reached the call that never answers: ${fmtCalls(world.ghCalls())}\n${logText}`).toBeTruthy();
    expect(!alive(pid), `the hung call ${pid} was ended with the run that made it`).toBeTruthy();
    cleanup(world.root);
  });
});
