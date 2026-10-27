// Tests for jobs/morning.sh as this machine runs it: the brief is the cloud
// one, so the morning here is the dispatch and nothing else.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, SPAWN_DEADLINE } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, settle } = require('./helpers');

const cases = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the brief is the cloud’s');

  // Everything below is about the day going over, or not going over, which is
  // a briefless morning and never a local compose.

  await test('a dispatch that lands hands the day to the cloud and composes nothing here', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);

    const sent = world.dispatched();
    assertEq(sent.length, 1, `one workflow run: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assertEq(sent[0][2], 'brief.yml', 'and it names the brief workflow');
    assertEq(sent[0][3], '--repo', 'on a repo');
    // The home repo, which is where setup seeded the workflow and
    // wrote the secrets, never this checkout's own, which is distributed.
    assertEq(sent[0][4], 'owner/private-home', 'the home repo this machine is configured for');

    assertEq(world.calls().length, 0, `claude never ran here: ${fmtCalls(world.calls()).slice(0, 200)}`);
    assertEq(world.created().length, 0, 'and nothing was published from this machine');
    assert(/dispatched brief\.yml on /.test(world.log()), `the log records the dispatch: ${world.log()}`);
    assert(res.stdout.includes('dispatched brief.yml on'), 'and says so on screen');
    cleanup(world.root);
  });

  await test('the summaries step still runs before the dispatch', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    assert(fs.existsSync(world.nightlyLog), 'yesterday is written up whether or not the day goes over');
    cleanup(world.root);
  });

  await test('a dispatch that does not land is a logged, briefless morning', async () => {
    // The brief needs the sweep token and the roster, which live on the home
    // repo, so a morning the day cannot be handed over has no brief, and the
    // log is the only place that says why.
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 1, 'the trigger was tried');
    assertEq(world.calls().length, 0, `and nothing was composed here: ${fmtCalls(world.calls()).slice(0, 200)}`);
    assertEq(world.created().length, 0, 'nothing was published from this machine');
    assert(/no brief this morning/.test(world.log()), `the log says the morning is briefless: ${world.log()}`);
    assert(/did not land/.test(world.log()), `and names the reason: ${world.log()}`);
    assert(/no brief this morning/.test(res.stderr), `it reaches the plist log too: ${res.stderr}`);
    assert(!(await settle(world)), 'and nothing was announced: there is no digest to announce');
    cleanup(world.root);
  });

  await test('a checkout missing brief-dispatch.sh is a briefless morning, not an abort', async () => {
    // The lib is sourced under `set -e`: without its own guard a partial
    // checkout would end the morning at the source line, costing the publish.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const stray = path.join(world.root, 'stray-jobs');
    fs.mkdirSync(stray, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(stray, 'morning.sh'));
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(stray, 'morning.sh'))], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assert(/kit is incomplete/.test(world.log()), `the reason names the missing lib: ${world.log()}`);
    assert(/no brief this morning/.test(world.log()), `and the morning is briefless, not broken: ${world.log()}`);
    assert(/marker: the engine library is missing/.test(world.log()), `the marker names the missing lib: ${world.log()}`);
    const said = [world.log(), res.stdout, res.stderr].join('\n');
    assert(said.includes('morning.d: the engine library is missing'), `and so does the morning.d step: ${said}`);
    await settle(world);
    cleanup(world.root);
  });

  await test('--now never dispatches: a rehearsal must not hand the day to a runner', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'the cloud was never asked');
    assertEq(world.calls().length, 1, 'the rehearsal ran here');
    assertEq(world.created().length, 0, 'and published nothing, as it always did');
    cleanup(world.root);
  });

  await test('a message argument never dispatches: the generic runner stays generic', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world, ['hello']);
    assertEq(world.dispatched().length, 0, 'no workflow was triggered');
    assertEq(world.calls()[0][1], 'hello', 'the message went straight to claude');
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
