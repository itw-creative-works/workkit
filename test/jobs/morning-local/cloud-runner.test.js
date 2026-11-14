// Tests for jobs/morning.sh as this machine runs it: the cloud brief runner,
// reconciled on the home clone before the dispatch.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, STALE_RUNNER, plantStaleRunner, pushFromElsewhere, subjects, REFRESH } = require('./helpers');

describe('jobs/morning (local): the cloud brief’s runner', { skip: skipUnlessDarwin() }, () => {
  // The cloud composes the brief out of seeded copies of these scripts on the
  // home repo, so the morning reconciles them ahead of the dispatch that
  // consumes them.

  test('a seeded copy the checkout moved past is refreshed, committed and pushed', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);

    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(
      fs.readFileSync(dest, 'utf8'),
      'the clone carries this checkout’s script, byte for byte',
    ).toBe(fs.readFileSync(SCRIPT, 'utf8'));
    expect(subjects(world.tower).includes(REFRESH), `in a commit that says what it is: ${subjects(world.tower).join(' | ')}`).toBeTruthy();
    expect(subjects(world.homeRemote).includes(REFRESH), 'and the commit reached the home repo').toBeTruthy();

    // Ordering is the whole point: the run the dispatch starts is the consumer
    // of what this step just pushed.
    const logText = world.log();
    expect(logText.indexOf('seeded the cloud brief') < logText.indexOf('dispatched brief.yml'),
      `the reconcile lands before the day goes over: ${logText}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a runner already current writes nothing and commits nothing', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    runJob(world);
    const written = fs.statSync(dest).mtimeMs;

    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(fs.statSync(dest).mtimeMs, 'the file was not rewritten').toBe(written);
    expect(/runner in .* is current/.test(world.log()), `and the morning says so: ${world.log()}`).toBeTruthy();
    expect(subjects(world.tower).filter((s) => s === REFRESH).length,
      `one refresh commit, not one a day: ${subjects(world.tower).join(' | ')}`).toBe(1);
    cleanup(world.root);
  });

  test('a clone another push left behind is brought up to date before the seed', () => {
    // The seed guard reads the working copy's stamp, so a clone that never
    // caught up would seed over what the remote carries and commit something
    // it can never push, wedging every publish after it. The pull prevents it.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    pushFromElsewhere(world, 'NOTE.md', 'somebody else was here\n');

    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(world.tower, 'NOTE.md')), 'the clone carries what the remote had moved on to').toBeTruthy();
    expect(
      fs.readFileSync(dest, 'utf8'),
      'the runner was refreshed on top of it',
    ).toBe(fs.readFileSync(SCRIPT, 'utf8'));
    // Read off the reconcile's own log block, the first one the morning writes:
    // the later publish would carry a wedged commit out and hide the bug, so
    // the step has to push what it commits, in the step that committed it.
    const reconcile = world.log().split(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ---/)[1] || '';
    expect(!/could not push/.test(reconcile),
      `and it pushed under its own step rather than wedging in the clone: ${reconcile}`).toBeTruthy();
    expect(subjects(world.homeRemote).includes(REFRESH), 'the refresh reached the home repo').toBeTruthy();
    cleanup(world.root);
  });

  test('a clone that cannot be rebased skips the seed and says so', () => {
    // Offline, an auth refusal, and a divergence a rebase cannot settle all land
    // here. None of them is a morning's to force, so the step says one line and
    // leaves the clone exactly as it found it.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    pushFromElsewhere(world, 'README.md', 'the remote wrote this\n');
    fs.writeFileSync(path.join(world.tower, 'README.md'), 'the clone wrote this\n');
    const git = (...args) => spawnSync('git', ['-C', world.tower, ...args], { encoding: 'utf8' });
    git('add', '-A');
    git('-c', 'user.name=local', '-c', 'user.email=local@localhost', 'commit', '-q', '-m', 'chore: a local edit');

    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(/^runner: .*could not catch up with its upstream/m.test(world.log()), `the morning names the skip: ${world.log()}`).toBeTruthy();
    expect(fs.readFileSync(dest, 'utf8'), 'and nothing was seeded into a clone that cannot push').toBe(STALE_RUNNER);
    expect(!subjects(world.tower).includes(REFRESH),
      `no commit it could never push: ${subjects(world.tower).join(' | ')}`).toBeTruthy();
    expect(world.dispatched().length, 'the morning carries on regardless').toBe(1);
    cleanup(world.root);
  });

  test('no home clone is a named skip, and the morning carries on', () => {
    // Nothing is ever created, cloned or enabled by the daily path:
    // a machine that has not run `workkit setup` hears one line.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(/runner: nothing is cloned at .*tower/.test(world.log()), `the log names the skip: ${world.log()}`).toBeTruthy();
    expect(!fs.existsSync(world.tower), 'and nothing was cloned to make it go away').toBeTruthy();
    expect(fs.existsSync(world.nightlyLog), 'the summaries step still ran').toBeTruthy();
    expect(world.dispatched().length, 'and the day still went over').toBe(1);
    cleanup(world.root);
  });

  test('a message argument reconciles nothing: the generic runner stays generic', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    runJob(world, ['hello']);
    expect(fs.readFileSync(dest, 'utf8'), 'the clone was left exactly as it was').toBe(STALE_RUNNER);
    expect(!/runner:/.test(world.log()), `and the step never ran: ${world.log()}`).toBeTruthy();
    cleanup(world.root);
  });
});
