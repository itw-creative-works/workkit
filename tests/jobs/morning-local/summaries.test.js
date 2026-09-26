//
// Tests for jobs/morning.sh as this machine runs it: the summaries step, which
// runs first.
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { skipUnlessDarwin, INSTRUCTION, cleanup, mkWorld, runJob, notifiedMatching, settle } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the summaries step');

  await test('the summaries step runs, and with no home repo it only logs its skip', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);

    assertEq(world.calls().length, 0, `nothing was sent from this machine: ${fmtCalls(world.calls()).slice(0, 160)}`);
    assert(fs.existsSync(world.nightlyLog), 'the step ran: it kept its own log');
    assert(/summaries: no home repo configured; skipped/.test(fs.readFileSync(world.nightlyLog, 'utf8')),
      'and said why it had nothing to do');
    await settle();
    cleanup(world.root);
  });

  await test('a machine with no session transcripts names the skip and never starts the step', async () => {
    // The capability gate from its red side (issue #107): the summaries read
    // this machine's transcripts, and a machine without them has no day to write
    // up. The named skip is what tells that apart from a step that failed.
    const world = mkWorld({ transcripts: false });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(/summaries: this machine has no session transcripts to read; skipped/.test(world.log()),
      `the log names the gate: ${world.log()}`);
    assert(!fs.existsSync(world.nightlyLog), 'and the step was never started');
    await settle();
    cleanup(world.root);
  });

  await test('a summaries failure never stops the morning', async () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    // A directory where the step's log file belongs: its first append fails, and
    // the step exits non-zero: the shape of failure that costs the most to
    // swallow, since the morning would be lost to the night before.
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world);
    assertEq(res.status, 0, 'the morning is not lost to the night before');
    assert(/\[summaries exit \d+; the brief continues\]/.test(world.log()),
      `the log names the failed step: ${world.log().slice(0, 300)}`);
    assertEq(world.dispatched().length, 1, 'and the day was still handed over');
    await settle();
    cleanup(world.root);
  });

  await test('a summaries failure still produces the rehearsal brief', async () => {
    const world = mkWorld();
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, 'the morning is not lost to the night before');
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still printed');
    const calls = world.calls();
    assertEq(calls.length, 1, `and the brief was sent: ${calls.length}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'the brief, not the flag');
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    cleanup(world.root);
  });

  await test('a message argument runs the send alone, summaries and all skipped', () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `one send: ${fmtCalls(calls).slice(0, 160)}`);
    assertEq(calls[0][1], 'hello', 'the generic headless runner is still generic');
    assert(!fs.existsSync(world.nightlyLog), 'and the summaries step never ran at all');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
