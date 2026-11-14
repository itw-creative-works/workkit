// Tests for jobs/morning.sh as a GitHub Actions runner runs it: publishing the
// digest as a Discussion, and the log that carries no digest body.
// The shared prologue (world factory, no-jq PATH, job runner) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  cleanup, today, mkWorld, runJob,
} = require('./helpers');

describe('jobs/morning (cloud): publishing', () => {
  test('the digest is posted as a Discussion titled with the date', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld({ ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a `DirectoryAdded` hook\n' });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const created = world.created();
    expect(created.length, `one createDiscussion mutation: ${fmtCalls(world.ghCalls()).slice(0, 400)}`).toBe(1);
    expect(created[0].join(' ').includes(`title=brief: ${today()}`), 'the title carries the date').toBeTruthy();
    const body = world.postedBody();
    expect(/HEADLINE: one thing today\./.test(body), `the digest response is the body: ${body}`).toBeTruthy();
    expect(!body.includes('You are producing the owner'), 'and never the payload it answered').toBeTruthy();
    expect(/<!-- cc-news: 2\.1\.220 -->/.test(body), `and the cursor the next morning reads: ${body}`).toBeTruthy();
    expect(body.indexOf('HEADLINE') < body.indexOf('<!-- cc-news'), 'after the digest, never in front of it').toBeTruthy();
    expect(res.stdout.includes(`posted brief: ${today()}`), `the log says it published: ${res.stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a run whose news could not be read publishes no version line', () => {
    // Nothing on the board and nothing upstream: there has never been a version,
    // so the brief carries none rather than inventing one.
    const world = mkWorld();
    runJob(world);
    expect(!/cc-news:/.test(world.postedBody()), `no line at all: ${world.postedBody()}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a failed upstream read carries the board’s version forward', { skip: skipWithoutNodeStub() }, () => {
    const world = mkWorld({ posted: [{ title: 'brief: 2026-07-01', body: '<!-- cc-news: 2.1.219 -->' }] });
    runJob(world);
    expect(/<!-- cc-news: 2\.1\.219 -->/.test(world.postedBody()),
      `the cursor holds rather than rewinding: ${world.postedBody()}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the digest body never reaches the Actions log', () => {
    // The log belongs to a repo that could be public; the digest summarizes
    // private-repo issues. Proof of life is all the log gets.
    const world = mkWorld({ response: 'HEADLINE: one thing today.\nIN FLIGHT: acme/secret #4: the private thing.\n' });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(!/acme\/secret/.test(res.stdout + res.stderr), `no digest body in the log: ${res.stdout}`).toBeTruthy();
    expect(/digest: HEADLINE: one thing today\./.test(res.stdout), `the headline is the proof of life: ${res.stdout}`).toBeTruthy();
    expect(/\(\d+ bytes\)/.test(res.stdout), `with how much there was of it: ${res.stdout}`).toBeTruthy();
    expect(/acme\/secret/.test(world.postedBody()), 'and the whole digest is on the Discussion, which is the delivery').toBeTruthy();
    cleanup(world.root);
  });

  test('a send that failed logs its status and stderr, never the payload', () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    expect(res.status, 'the exit status carries through').toBe(3);
    expect(/the digest send exit 3/.test(res.stderr), `the status is named: ${res.stderr}`).toBeTruthy();
    expect(/budget exceeded/.test(res.stderr), `and what the CLI said: ${res.stderr}`).toBeTruthy();
    expect(!/MORNING KICKOFF/.test(res.stdout + res.stderr), 'the payload it was handed is not echoed').toBeTruthy();
    expect(world.created().length, 'and no Discussion carries the failure').toBe(0);
    cleanup(world.root);
  });

  test('today’s brief already on the board is not posted twice', () => {
    const world = mkWorld({ posted: [{ title: `brief: ${today()}` }] });
    const res = runJob(world);
    expect(res.status, 'an overlap with the cron backup is an ordinary morning').toBe(0);
    expect(world.created().length, `nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 400)}`).toBe(0);
    expect(res.stdout.includes('already carries brief: '), `and it says so: ${res.stdout}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a post that does not land is a red run', () => {
    const world = mkWorld({ ghFails: true });
    const res = runJob(world);
    expect(res.status, 'in the cloud the log IS the delivery: a silent failure is invisible').toBe(1);
    // A post that did not land is the warning level, on stderr with the rest of
    // them; the Actions log carries both streams.
    expect(res.stderr.includes('nothing posted'), `and the run says what happened: ${res.stdout}${res.stderr}`).toBeTruthy();
    cleanup(world.root);
  });
});
