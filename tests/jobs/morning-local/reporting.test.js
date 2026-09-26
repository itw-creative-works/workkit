//
// Tests for jobs/morning.sh as this machine runs it: reporting: the response
// printed, logged and notified, and the failures that still have to be.
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { stubTool } = require('../../lib/platform');
const { skipUnlessDarwin, cleanup, mkWorld, runJob, notified, notifiedMatching } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): reporting');

  await test('the response is printed, logged, and its first line notified', async () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the response goes to stdout');

    const log = world.log();
    assert(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ---/.test(log), 'one timestamped block');
    assert(log.includes('> hello'), 'the message is logged, truncated to its first 200 characters');
    assert(log.includes('IN FLIGHT: nothing.'), 'and the whole response');

    const notif = await notified(world);
    const after = (flag) => notif[notif.indexOf(flag) + 1];
    assertEq(after('--title'), 'Claude Daily', 'titled');
    assertEq(after('--message'), 'HEADLINE: one thing today.', 'the headline IS the notification');
    cleanup(world.root);
  });

  await test('a home with no Library/Logs gets one: the exchange is still logged', () => {
    const world = mkWorld({ logsDir: false });
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `the append cannot fail the job: ${res.stderr}`);
    assert(world.log().includes('HEADLINE: one thing today.'), `the log was created and written: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a failed send exits with its status and says so on screen', async () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world, ['hello']);
    assertEq(res.status, 3, 'the exit status carries through');
    assert(world.log().includes('[exit 3]'), 'the log names the failure');
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    assert(/exit 3/.test(message), `the notification does too: ${message}`);
    cleanup(world.root);
  });

  await test('a payload-builder crash still logs and notifies', async () => {
    const world = mkWorld();
    // Shadow node itself: the guard has to hold even when the builder cannot
    // run at all, not just when it returns ok:false.
    stubTool(path.join(world.root, 'bin'), 'node',
      ['#!/usr/bin/env bash', 'echo "boom: cannot find module" >&2', 'exit 7']);
    const res = runJob(world, ['--now']);
    assertEq(res.status, 7, 'the builder status carries through');
    assertEq(world.calls().length, 0, 'claude never ran: there was nothing to send');
    const log = world.log();
    assert(log.includes('[brief-payload exit 7]'), 'the log names the failed stage');
    assert(log.includes('boom: cannot find module'), 'and carries the stderr');
    await notifiedMatching(world, /brief-payload exit 7/);
    cleanup(world.root);
  });

  await test('the job runs from an empty scratch cwd, not from /', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    const scratch = path.join(world.home, 'Library', 'Caches', 'claude-daily');
    assert(fs.existsSync(scratch), 'the empty cwd exists: launchd starts the job at / and TCC notices');
    assertEq(fs.readdirSync(scratch).length, 0, 'and stays empty, so there is nothing to scan');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
