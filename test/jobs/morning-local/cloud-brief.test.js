// Tests for jobs/morning.sh as this machine runs it: the brief is the cloud
// one, so the morning here is the dispatch and nothing else.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, SPAWN_DEADLINE } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { NO_RC, shellPath, spawnBash } = require('../../lib/platform');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, settle } = require('./helpers');

describe('jobs/morning (local): the brief is the cloud’s', { skip: skipUnlessDarwin() }, () => {
  // Everything below is about the day going over, or not going over, which is
  // a briefless morning and never a local compose.

  test('a dispatch that lands hands the day to the cloud and composes nothing here', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);

    const sent = world.dispatched();
    expect(sent.length, `one workflow run: ${fmtCalls(world.ghCalls()).slice(0, 400)}`).toBe(1);
    expect(sent[0][2], 'and it names the brief workflow').toBe('brief.yml');
    expect(sent[0][3], 'on a repo').toBe('--repo');
    // The home repo, which is where setup seeded the workflow and
    // wrote the secrets, never this checkout's own, which is distributed.
    expect(sent[0][4], 'the home repo this machine is configured for').toBe('owner/private-home');

    expect(world.calls().length, `claude never ran here: ${fmtCalls(world.calls()).slice(0, 200)}`).toBe(0);
    expect(world.created().length, 'and nothing was published from this machine').toBe(0);
    expect(/dispatched brief\.yml on /.test(world.log()), `the log records the dispatch: ${world.log()}`).toBeTruthy();
    expect(res.stdout.includes('dispatched brief.yml on'), 'and says so on screen').toBeTruthy();
    cleanup(world.root);
  });

  test('the summaries step still runs before the dispatch', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    expect(fs.existsSync(world.nightlyLog), 'yesterday is written up whether or not the day goes over').toBeTruthy();
    cleanup(world.root);
  });

  test('a dispatch that does not land is a logged, briefless morning', async () => {
    // The brief needs the sweep token and the roster, which live on the home
    // repo, so a morning the day cannot be handed over has no brief, and the
    // log is the only place that says why.
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.dispatched().length, 'the trigger was tried').toBe(1);
    expect(world.calls().length, `and nothing was composed here: ${fmtCalls(world.calls()).slice(0, 200)}`).toBe(0);
    expect(world.created().length, 'nothing was published from this machine').toBe(0);
    expect(/no brief this morning/.test(world.log()), `the log says the morning is briefless: ${world.log()}`).toBeTruthy();
    expect(/did not land/.test(world.log()), `and names the reason: ${world.log()}`).toBeTruthy();
    expect(/no brief this morning/.test(res.stderr), `it reaches the plist log too: ${res.stderr}`).toBeTruthy();
    expect(!(await settle(world)), 'and nothing was announced: there is no digest to announce').toBeTruthy();
    cleanup(world.root);
  });

  test('a kit missing its engine stops at once: one line naming the engine, exit 1', () => {
    // The starter alone, with no workflow/lib/platform.sh beside it: the kit is
    // incomplete, and no step runs on half of it. The runner's half, a kit
    // missing jobs/morning.js, is ../morning-cloud/machine.test.js.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const stray = path.join(world.root, 'stray', 'jobs');
    fs.mkdirSync(stray, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(stray, 'morning.sh'));
    const res = spawnBash([...NO_RC, shellPath(path.join(stray, 'morning.sh'))], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    expect(res.status, `the run refuses, stdout: ${res.stdout} stderr: ${res.stderr}`).toBe(1);
    expect(res.stderr, 'one line, naming the engine folder').toMatch(/^morning: the engine is missing at \S*workflow; the kit is incomplete\n$/);
    expect(res.stdout, 'and nothing else is said').toBe('');
    expect(world.log(), 'no step ran to log anything').toBe('');
    expect(world.dispatched().length, 'nothing was triggered').toBe(0);
    cleanup(world.root);
  });

  test('--now never dispatches: a rehearsal must not hand the day to a runner', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world, ['--now']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(world.dispatched().length, 'the cloud was never asked').toBe(0);
    expect(world.calls().length, 'the rehearsal ran here').toBe(1);
    expect(world.created().length, 'and published nothing, as it always did').toBe(0);
    cleanup(world.root);
  });

  test('a message argument never dispatches: the generic runner stays generic', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world, ['hello']);
    expect(world.dispatched().length, 'no workflow was triggered').toBe(0);
    expect(world.calls()[0][1], 'the message went straight to claude').toBe('hello');
    cleanup(world.root);
  });
});
