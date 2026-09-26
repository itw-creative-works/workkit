//
// Tests for jobs/morning.sh as this machine runs it: the cloud brief runner,
// reconciled on the home clone before the dispatch (issue #143).
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, STALE_RUNNER, plantStaleRunner, pushFromElsewhere, subjects, REFRESH } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the cloud brief’s runner');

  // Issue #143: the cloud composes the brief out of SEEDED COPIES of these
  // scripts on the home repo, and until now only `workkit setup` refreshed
  // them, so a checkout that moved on published stale briefs until somebody
  // remembered. The morning reconciles them, ahead of the dispatch that
  // consumes them.

  await test('a seeded copy the checkout moved past is refreshed, committed and pushed', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(
      fs.readFileSync(dest, 'utf8'),
      fs.readFileSync(SCRIPT, 'utf8'),
      'the clone carries this checkout’s script, byte for byte',
    );
    assert(subjects(world.tower).includes(REFRESH), `in a commit that says what it is: ${subjects(world.tower).join(' | ')}`);
    assert(subjects(world.homeRemote).includes(REFRESH), 'and the commit reached the home repo');

    // Ordering is the whole point: the run the dispatch starts is the consumer
    // of what this step just pushed.
    const log = world.log();
    assert(log.indexOf('seeded the cloud brief') < log.indexOf('dispatched brief.yml'),
      `the reconcile lands before the day goes over: ${log}`);
    cleanup(world.root);
  });

  await test('a runner already current writes nothing and commits nothing', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    runJob(world);
    const written = fs.statSync(dest).mtimeMs;

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(fs.statSync(dest).mtimeMs, written, 'the file was not rewritten');
    assert(/runner in .* is current/.test(world.log()), `and the morning says so: ${world.log()}`);
    assertEq(subjects(world.tower).filter((s) => s === REFRESH).length, 1,
      `one refresh commit, not one a day: ${subjects(world.tower).join(' | ')}`);
    cleanup(world.root);
  });

  await test('a clone another push left behind is brought up to date before the seed', () => {
    // The stamp the seed guard reads is the WORKING COPY's (issue #200), so a
    // clone that never caught up reads a stale one, seeds over what the remote
    // already carries, and commits something it can never push - wedging every
    // publish after it. The pull is what keeps that from being today's morning.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    pushFromElsewhere(world, 'NOTE.md', 'somebody else was here\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(fs.existsSync(path.join(world.tower, 'NOTE.md')), 'the clone carries what the remote had moved on to');
    assertEq(
      fs.readFileSync(dest, 'utf8'),
      fs.readFileSync(SCRIPT, 'utf8'),
      'the runner was refreshed on top of it',
    );
    // Read off the reconcile's OWN log block - the first one the morning writes.
    // The later publish pulls for its own reasons and would carry a wedged
    // commit out on its next run, which is precisely what hides this bug: the
    // step has to push what it commits, in the step that committed it.
    const reconcile = world.log().split(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ---/)[1] || '';
    assert(!/could not push/.test(reconcile),
      `and it pushed under its own step rather than wedging in the clone: ${reconcile}`);
    assert(subjects(world.homeRemote).includes(REFRESH), 'the refresh reached the home repo');
    cleanup(world.root);
  });

  await test('a clone that cannot be rebased skips the seed and says so', () => {
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
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/could not be brought up to date/.test(world.log()), `the morning names the skip: ${world.log()}`);
    assertEq(fs.readFileSync(dest, 'utf8'), STALE_RUNNER, 'and nothing was seeded into a clone that cannot push');
    assert(!subjects(world.tower).includes(REFRESH),
      `no commit it could never push: ${subjects(world.tower).join(' | ')}`);
    assertEq(world.dispatched().length, 1, 'the morning carries on regardless');
    cleanup(world.root);
  });

  await test('no home clone is a named skip, and the morning carries on', () => {
    // Nothing is ever created, cloned or enabled by the daily path (issue #71):
    // a machine that has not run `workkit setup` hears one line.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/runner: nothing is cloned at .*tower/.test(world.log()), `the log names the skip: ${world.log()}`);
    assert(!fs.existsSync(world.tower), 'and nothing was cloned to make it go away');
    assert(fs.existsSync(world.nightlyLog), 'the summaries step still ran');
    assertEq(world.dispatched().length, 1, 'and the day still went over');
    cleanup(world.root);
  });

  await test('a message argument reconciles nothing: the generic runner stays generic', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, homeClone: true });
    const dest = plantStaleRunner(world);
    runJob(world, ['hello']);
    assertEq(fs.readFileSync(dest, 'utf8'), STALE_RUNNER, 'the clone was left exactly as it was');
    assert(!/runner:/.test(world.log()), `and the step never ran: ${world.log()}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
