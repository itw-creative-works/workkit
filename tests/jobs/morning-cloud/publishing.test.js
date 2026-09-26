//
// Tests for jobs/morning.sh as a GITHUB ACTIONS RUNNER runs it: publishing the
// digest as a Discussion, and the log that carries no digest body.
// The shared prologue (the world factory, the no-jq PATH, the job runner, the two case gates) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, today, mkWorld, runJob, composerTest,
} = require('./helpers');

const run = async () => {
  group('jobs/morning (cloud): publishing');

  await composerTest('the digest is posted as a Discussion titled with the date', () => {
    const world = mkWorld({ ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a `DirectoryAdded` hook\n' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const created = world.created();
    assertEq(created.length, 1, `one createDiscussion mutation: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assert(created[0].join(' ').includes(`title=brief: ${today()}`), 'the title carries the date');
    const body = world.postedBody();
    assert(/HEADLINE: one thing today\./.test(body), `the digest response is the body: ${body}`);
    assert(!body.includes('You are producing the owner'), 'and never the payload it answered');
    assert(/<!-- cc-news: 2\.1\.220 -->/.test(body), `and the cursor the next morning reads: ${body}`);
    assert(body.indexOf('HEADLINE') < body.indexOf('<!-- cc-news'), 'after the digest, never in front of it');
    assert(res.stdout.includes(`posted brief: ${today()}`), `the log says it published: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('a run whose news could not be read publishes no version line', () => {
    // Nothing on the board and nothing upstream: there has never been a version,
    // so the brief carries none rather than inventing one.
    const world = mkWorld();
    runJob(world);
    assert(!/cc-news:/.test(world.postedBody()), `no line at all: ${world.postedBody()}`);
    cleanup(world.root);
  });

  await composerTest('a failed upstream read carries the board’s version forward', () => {
    const world = mkWorld({ posted: [{ title: 'brief: 2026-07-01', body: '<!-- cc-news: 2.1.219 -->' }] });
    runJob(world);
    assert(/<!-- cc-news: 2\.1\.219 -->/.test(world.postedBody()),
      `the cursor holds rather than rewinding: ${world.postedBody()}`);
    cleanup(world.root);
  });

  await test('the digest body never reaches the Actions log', () => {
    // The log belongs to a repo that could be public; the digest summarizes
    // private-repo issues. Proof of life is all the log gets.
    const world = mkWorld({ response: 'HEADLINE: one thing today.\nIN FLIGHT: acme/secret #4: the private thing.\n' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(!/acme\/secret/.test(res.stdout + res.stderr), `no digest body in the log: ${res.stdout}`);
    assert(/digest: HEADLINE: one thing today\./.test(res.stdout), `the headline is the proof of life: ${res.stdout}`);
    assert(/\(\d+ bytes\)/.test(res.stdout), `with how much there was of it: ${res.stdout}`);
    assert(/acme\/secret/.test(world.postedBody()), 'and the whole digest is on the Discussion, which is the delivery');
    cleanup(world.root);
  });

  await test('a send that failed logs its status and stderr, never the payload', () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assert(/the digest send exit 3/.test(res.stderr), `the status is named: ${res.stderr}`);
    assert(/budget exceeded/.test(res.stderr), `and what the CLI said: ${res.stderr}`);
    assert(!/MORNING KICKOFF/.test(res.stdout + res.stderr), 'the payload it was handed is not echoed');
    cleanup(world.root);
  });

  await test('today’s brief already on the board is not posted twice', () => {
    const world = mkWorld({ posted: [{ title: `brief: ${today()}` }] });
    const res = runJob(world);
    assertEq(res.status, 0, 'an overlap with the cron backup is an ordinary morning');
    assertEq(world.created().length, 0, `nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assert(res.stdout.includes('already carries brief: '), `and it says so: ${res.stdout}`);
    cleanup(world.root);
  });

  await test('a post that does not land is a red run', () => {
    const world = mkWorld({ ghFails: true });
    const res = runJob(world);
    assertEq(res.status, 1, 'in the cloud the log IS the delivery: a silent failure is invisible');
    // A post that did not land is the warning level, on stderr with the rest of
    // them; the Actions log carries both streams (issue #237).
    assert(res.stderr.includes('nothing posted'), `and the run says what happened: ${res.stdout}${res.stderr}`);
    cleanup(world.root);
  });

  await test('a failed send publishes nothing and carries its status out', () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assertEq(world.created().length, 0, 'and no Discussion carries the failure');
    assert(/budget exceeded/.test(res.stderr), `the reason is on stderr: ${res.stderr}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
