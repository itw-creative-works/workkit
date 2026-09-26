//
// Tests for jobs/morning.sh as this machine runs it: the brief is the cloud
// one, so the morning here is the dispatch and nothing else (issue #107).
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { skipUnlessDarwin, SCRIPT, STEPS, cleanup, mkWorld, runJob, settle } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the brief is the cloud’s');

  // Since issue #107 the scheduled brief on this machine is the dispatch and
  // nothing else. Everything below is about the day going over, or not going
  // over, which is a briefless morning and never a local compose.

  await test('a dispatch that lands hands the day to the cloud and composes nothing here', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);

    const sent = world.dispatched();
    assertEq(sent.length, 1, `one workflow run: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assertEq(sent[0][2], 'brief.yml', 'and it names the brief workflow');
    assertEq(sent[0][3], '--repo', 'on a repo');
    // The HOME repo (issue #91), which is where setup seeded the workflow and
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

  await test('the site publish still runs after a dispatch: the site is this machine\'s', () => {
    const world = mkWorld({ badSettings: true, dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/does not parse as JSON/.test(world.log()), `the publish leg ran: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a dispatch that does not land is a logged, briefless morning', async () => {
    // Issue #107: the local compose is GONE, not no-opped. The brief needs the
    // sweep token and the roster, which live on the home repo, so a morning the
    // day cannot be handed over is a morning with no brief, and the log is the
    // only place that says why.
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 1, 'the trigger was tried');
    assertEq(world.calls().length, 0, `and nothing was composed here: ${fmtCalls(world.calls()).slice(0, 200)}`);
    assertEq(world.created().length, 0, 'nothing was published from this machine');
    assert(/no brief this morning/.test(world.log()), `the log says the morning is briefless: ${world.log()}`);
    assert(/did not land/.test(world.log()), `and names the reason: ${world.log()}`);
    assert(/no brief this morning/.test(res.stderr), `it reaches the plist log too: ${res.stderr}`);
    await settle();
    assertEq(world.notifs().length, 0, 'and nothing was announced: there is no digest to announce');
    cleanup(world.root);
  });

  await test('a checkout missing brief-dispatch.sh is a briefless morning, not an abort', async () => {
    // The lib is sourced under `set -e`: without its own guard a partial
    // checkout would end the morning at the source line, costing the publish.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const stray = path.join(world.root, 'stray-jobs');
    fs.mkdirSync(stray, { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(stray, 'morning.sh'));
    // The steps it sources are the script itself; only the lib is missing.
    fs.cpSync(STEPS, path.join(stray, 'morning'), { recursive: true });
    const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(stray, 'morning.sh'))], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assert(/partial checkout/.test(world.log()), `the reason names the missing lib: ${world.log()}`);
    assert(/no brief this morning/.test(world.log()), `and the morning is briefless, not broken: ${world.log()}`);
    await settle();
    cleanup(world.root);
  });

  await test('no secrets at all and an unlistable repo are told apart', async () => {
    // Both are briefless mornings, but the line's whole job is the honest why:
    // a successful listing that names nothing means setup never wired the
    // secrets; a listing that FAILED means this token cannot read the repo.
    const bare = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: [] });
    let res = runJob(bare);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(bare.dispatched().length, 0, 'nothing was triggered');
    assert(/carries no secrets/.test(bare.log()), `an empty listing blames the missing secrets: ${bare.log()}`);
    assert(!/could not be listed/.test(bare.log()), 'and never the listing');
    await settle();
    cleanup(bare.root);

    const unlistable = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: [], secretsUnlistable: true });
    res = runJob(unlistable);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/could not be listed/.test(unlistable.log()), `a failed listing says so: ${unlistable.log()}`);
    await settle();
    cleanup(unlistable.root);
  });

  await test('a repo without the OAuth secret is never handed the day', async () => {
    // `gh workflow run` succeeds the moment the file is on the default branch,
    // secrets or not, and a runner without the token composes nothing. Naming
    // the missing secret is the whole value of the check.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: ['WORKKIT_GITHUB_TOKEN'] });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    assert(/CLAUDE_CODE_OAUTH_TOKEN/.test(world.log()), `the log names the secret: ${world.log()}`);
    await settle();
    cleanup(world.root);
  });

  await test('a repo without the board token is never handed the day either', async () => {
    // The OAuth token alone buys a runner that composes, over an empty board.
    // `WORKKIT_GITHUB_TOKEN` is the credential every issue read uses, so a
    // morning without it is a digest about nothing. Both names, or nothing goes.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    assert(/WORKKIT_GITHUB_TOKEN/.test(world.log()), `the log names the secret: ${world.log()}`);
    await settle();
    cleanup(world.root);
  });

  await test('both secret names present is what lets the day go to the cloud', () => {
    // The positive half of the pair: the default world carries both, and it is
    // the only shape that dispatches.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    assertEq(world.dispatched().length, 1, 'the day was handed over');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    cleanup(world.root);
  });

  await test('a machine with no home repo never dispatches, and says so', async () => {
    // Issue #91: the workflow and its secrets live on the home repo, so a
    // machine that has none has nowhere to hand the day to.
    const world = mkWorld({ home: null, dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assert(!/dispatched/.test(world.log()), `and nothing was claimed: ${world.log()}`);
    assert(/no home repo is configured/.test(world.log()), `the log names the reason: ${world.log()}`);
    assertEq(world.calls().length, 0, 'nothing was composed here');
    await settle();
    cleanup(world.root);
  });

  await test('the secrets are checked on the repo the dispatch names', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    const checks = world.ghCalls().filter((c) => c[0] === 'secret' && c[1] === 'list');
    assertEq(checks.length, 1, `one listing, on the scheduled morning only: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assertEq(checks[0][2], '--repo', 'scoped to a repo');
    assertEq(checks[0][3], world.dispatched()[0][4], 'the same slug the dispatch went to');
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

  await test('nothing this machine sends is ever posted as a Discussion', async () => {
    // The publishing half of issue #107: the digest is published by whoever
    // composed it, and this machine composes no scheduled brief. A rehearsal and
    // a message run reach the board for nothing at all.
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a hook\n' });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still ran end to end');
    assertEq(world.created().length, 0, `and nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 300)}`);
    assertEq(world.postedBody(), '', 'no body reached the board');
    await settle();
    cleanup(world.root);
  });

  await test('the run leaves no cursor file behind on this machine', () => {
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a hook\n' });
    runJob(world, ['--now']);
    assert(!fs.existsSync(path.join(world.workflowHome, '.cache.json'))
      || !('ccNews' in JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.cache.json'), 'utf8'))),
    'the cursor is the Discussion: nothing writes ccNews any more');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
