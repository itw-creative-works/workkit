// Tests for jobs/morning.sh as this machine runs it: the summaries step, which
// runs first.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { skipUnlessDarwin, INSTRUCTION, cleanup, mkWorld, runJob, notifiedMatching, settle } = require('./helpers');

describe('jobs/morning (local): the summaries step', { skip: skipUnlessDarwin() }, () => {
  test('the summaries step runs, and with no home repo it only logs its skip', async () => {
    const world = mkWorld();
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);

    expect(world.calls().length, `nothing was sent from this machine: ${fmtCalls(world.calls()).slice(0, 160)}`).toBe(0);
    expect(fs.existsSync(world.nightlyLog), 'the step ran: it kept its own log').toBeTruthy();
    expect(/summaries: no home repo configured; skipped/.test(fs.readFileSync(world.nightlyLog, 'utf8')),
      'and said why it had nothing to do').toBeTruthy();
    await settle(world);
    cleanup(world.root);
  });

  test('a machine with no session transcripts names the skip and never starts the step', async () => {
    // The capability gate from its red side: the summaries read
    // this machine's transcripts, and a machine without them has no day to write
    // up. The named skip is what tells that apart from a step that failed.
    const world = mkWorld({ transcripts: false });
    const res = runJob(world);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(/summaries: this machine has no session transcripts to read; skipped/.test(world.log()),
      `the log names the gate: ${world.log()}`).toBeTruthy();
    expect(!fs.existsSync(world.nightlyLog), 'and the step was never started').toBeTruthy();
    await settle(world);
    cleanup(world.root);
  });

  test('a summaries failure never stops the morning', async () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    // A directory where the step's log file belongs: its first append fails, and
    // the step exits non-zero: the shape of failure that costs the most to
    // swallow, since the morning would be lost to the night before.
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world);
    expect(res.status, 'the morning is not lost to the night before').toBe(0);
    expect(/\[summaries exit \d+; the brief continues\]/.test(world.log()),
      `the log names the failed step: ${world.log().slice(0, 300)}`).toBeTruthy();
    expect(world.dispatched().length, 'and the day was still handed over').toBe(1);
    await settle(world);
    cleanup(world.root);
  });

  test('a summaries failure still produces the rehearsal brief', async () => {
    const world = mkWorld();
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world, ['--now']);
    expect(res.status, 'the morning is not lost to the night before').toBe(0);
    expect(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still printed').toBeTruthy();
    const calls = world.calls();
    expect(calls.length, `and the brief was sent: ${calls.length}`).toBe(1);
    expect(calls[0][1].startsWith(INSTRUCTION), 'the brief, not the flag').toBeTruthy();
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    cleanup(world.root);
  });

  test('a message argument runs the send alone, summaries and all skipped', () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const calls = world.calls();
    expect(calls.length, `one send: ${fmtCalls(calls).slice(0, 160)}`).toBe(1);
    expect(calls[0][1], 'the generic headless runner is still generic').toBe('hello');
    expect(!fs.existsSync(world.nightlyLog), 'and the summaries step never ran at all').toBeTruthy();
    cleanup(world.root);
  });
});
