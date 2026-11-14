// Tests for jobs/morning.sh as this machine runs it: reporting: the response
// printed, logged and notified, and the failures that still have to be.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect,
} = require('../../lib/harness');
const { stubTool } = require('../../lib/platform');
const {
  skipUnlessDarwin, cleanup, mkWorld, runJob, notified, notifiedMatching, skipOnJobPathNode, withoutNode,
} = require('./helpers');
const { NO_NODE_LINE } = require('../../lib/job-path');

// A Notifly installed for everyone, which a case must not fire for real.
const SYSTEM_NOTIFLY = '/Applications/Notifly.app';
const skipOnSystemNotifly = () => fs.existsSync(SYSTEM_NOTIFLY)
  && `${SYSTEM_NOTIFLY} is installed here, and the job would fire it for real`;

describe('jobs/morning (local): reporting', { skip: skipUnlessDarwin() }, () => {
  test('the response is printed, logged, and its first line notified', async () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    expect(res.stdout.includes('HEADLINE: one thing today.'), 'the response goes to stdout').toBeTruthy();

    const logText = world.log();
    expect(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ---/.test(logText), 'one timestamped block').toBeTruthy();
    expect(logText.includes('> hello'), 'the message is logged, truncated to its first 200 characters').toBeTruthy();
    expect(logText.includes('IN FLIGHT: nothing.'), 'and the whole response').toBeTruthy();

    const notif = await notified(world);
    const after = (flag) => notif[notif.indexOf(flag) + 1];
    expect(after('--title'), 'titled').toBe('Claude Daily');
    expect(after('--message'), 'the headline IS the notification').toBe('HEADLINE: one thing today.');
    cleanup(world.root);
  });

  test('a home with no Library/Logs gets one: the exchange is still logged', () => {
    const world = mkWorld({ logsDir: false });
    const res = runJob(world, ['hello']);
    expect(res.status, `the append cannot fail the job: ${res.stderr}`).toBe(0);
    expect(world.log().includes('HEADLINE: one thing today.'), `the log was created and written: ${world.log()}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a failed send exits with its status and says so on screen', async () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world, ['hello']);
    expect(res.status, 'the exit status carries through').toBe(3);
    expect(world.log().includes('[exit 3]'), 'the log names the failure').toBeTruthy();
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    expect(/exit 3/.test(message), `the notification does too: ${message}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a payload-builder crash still logs and notifies', async () => {
    const world = mkWorld();
    // Shadow node itself: the guard has to hold even when the builder cannot
    // run at all, not just when it returns ok:false.
    stubTool(path.join(world.root, 'bin'), 'node',
      ['#!/usr/bin/env bash', 'echo "boom: cannot find module" >&2', 'exit 7']);
    const res = runJob(world, ['--now']);
    expect(res.status, 'the builder status carries through').toBe(7);
    expect(world.calls().length, 'claude never ran: there was nothing to send').toBe(0);
    const logText = world.log();
    expect(logText.includes('[brief-payload exit 7]'), 'the log names the failed stage').toBeTruthy();
    expect(logText.includes('boom: cannot find module'), 'and carries the stderr').toBeTruthy();
    await notifiedMatching(world, /brief-payload exit 7/);
    cleanup(world.root);
  });

  test('a PATH without node: the named line, the brief skipped, exit 0', { skip: skipOnJobPathNode() }, () => {
    const world = mkWorld();
    withoutNode(world);
    const res = runJob(world, ['--now']);
    expect(res.status, `a missing node ends the step, never the job: ${res.stderr}`).toBe(0);
    const lines = [...world.log().matchAll(NO_NODE_LINE)];
    expect(lines.length, `one named line in the log: ${world.log()}`).toBe(1);
    expect(lines[0][1].split(':').includes('/usr/bin'), `naming the PATH it searched: ${lines[0][1]}`).toBeTruthy();
    // matchAll copies the /g pattern, so no lastIndex carries over from the log read.
    const onScreen = [...res.stderr.matchAll(NO_NODE_LINE)].map((m) => m[0]);
    expect(onScreen.includes(lines[0][0]), `the same line reaches stderr: ${res.stderr}`).toBeTruthy();
    expect(world.calls().length, 'claude never ran: there was no brief to send').toBe(0);
    cleanup(world.root);
  });

  test('with no seam, Notifly is found under ~/Applications first', async () => {
    // Where /Applications has one too, the per-user copy still wins: the
    // recorder only hears the call if the job picked the home one.
    const world = mkWorld({ notifier: 'home-app' });
    const res = runJob(world, ['hello']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const notif = await notified(world);
    expect(notif[notif.indexOf('--message') + 1], 'the per-user app was fired').toBe('HEADLINE: one thing today.');
    cleanup(world.root);
  });

  test('no Notifly in either Applications folder: a named skip line, exit 0', { skip: skipOnSystemNotifly() }, async () => {
    const world = mkWorld({ notifier: 'none' });
    const res = runJob(world, ['hello']);
    expect(res.status, `a missing notifier never fails the job: ${res.stderr}`).toBe(0);
    expect(res.stdout.includes('HEADLINE: one thing today.'), 'the response still goes to stdout').toBeTruthy();
    const skipped = world.log().split('\n').filter((l) => /notifly/i.test(l) && /skip/i.test(l));
    expect(skipped.length, `one line naming the skipped notification: ${world.log()}`).toBe(1);
    cleanup(world.root);
  });

  test('the job runs from an empty scratch cwd, not from /', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    const scratch = path.join(world.home, 'Library', 'Caches', 'claude-daily');
    expect(fs.existsSync(scratch), 'the empty cwd exists: launchd starts the job at / and TCC notices').toBeTruthy();
    expect(fs.readdirSync(scratch).length, 'and stays empty, so there is nothing to scan').toBe(0);
    cleanup(world.root);
  });
});
