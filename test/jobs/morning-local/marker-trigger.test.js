// Tests for jobs/morning.sh as this machine runs it: the cloud brief marker
// and the manual trigger.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { skipUnlessDarwin, INSTRUCTION, BRIEF_TITLE_PREFIX, cleanup, mkWorld, runJob } = require('./helpers');

describe('jobs/morning (local)', { skip: skipUnlessDarwin() }, () => {
  describe('jobs/morning (local): the cloud brief marker', () => {
    // A cloud runner whose token expired fails quietly, so the morning records
    // what is actually on the board and the session hook reads that one file.
    // This is the writer.

    test('the newest brief on the board is recorded, summaries ignored', () => {
      const world = mkWorld({
        home: 'owner/private-home',
        dispatch: true,
        // Newest first, the order the query asks for, and the newest post of all
        // is a summary, which is what the title filter is for.
        posted: [
          { title: 'daily: 2026-08-18' },
          { title: `${BRIEF_TITLE_PREFIX}2026-08-17` },
          { title: `${BRIEF_TITLE_PREFIX}2026-08-16` },
        ],
      });
      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);

      const marker = JSON.parse(world.marker());
      expect(marker.version, 'the marker carries its version').toBe(1);
      expect(marker.lastBrief, 'the newest brief-titled post, not the newest post').toBe('2026-08-17');
      expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(marker.checkedAt),
        `and when it was checked: ${marker.checkedAt}`).toBeTruthy();
      expect(/marker: /.test(world.log()), `the log says what was recorded: ${world.log()}`).toBeTruthy();
      // The file it was written as first is beside it, so what lands is a
      // rename, which takes the temp name with it.
      expect(!fs.existsSync(`${world.markerFile}.tmp`), 'and nothing is left beside it').toBeTruthy();
      cleanup(world.root);
    });

    test('a read that fails leaves the marker exactly as it was', () => {
      // Never write a lie: an offline machine, a token that refuses, a `gh` that
      // is not there: none of them are evidence about the board, so the marker a
      // real read left behind stands.
      const world = mkWorld({ home: 'owner/private-home', dispatch: true, ghFails: true });
      const was = JSON.stringify({ version: 1, lastBrief: '2026-08-01', checkedAt: '2026-08-01T09:00:00Z' });
      fs.writeFileSync(world.markerFile, was);

      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(world.marker(), 'the marker is untouched').toBe(was);
      expect(/marker: .*could not be read/.test(world.log()), `and the skip is named: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a board carrying no brief at all writes nothing', () => {
      const world = mkWorld({
        home: 'owner/private-home', dispatch: true, posted: [{ title: 'daily: 2026-08-18' }],
      });
      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(world.marker(), 'a board with no brief on it is not a date').toBe(null);
      cleanup(world.root);
    });

    test('a machine with no home repo records nothing, and says why', () => {
      const world = mkWorld({ home: null });
      const res = runJob(world);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(world.marker(), 'there is no board to read').toBe(null);
      expect(/marker: no home repo/.test(world.log()), `the log names the skip: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a message argument records nothing: the generic runner stays generic', () => {
      const world = mkWorld({
        home: 'owner/private-home', posted: [{ title: `${BRIEF_TITLE_PREFIX}2026-08-17` }],
      });
      runJob(world, ['hello']);
      expect(world.marker(), 'a prompt is not a morning').toBe(null);
      expect(!/marker:/.test(world.log()), `and the step never ran: ${world.log()}`).toBeTruthy();
      cleanup(world.root);
    });
  });

  describe('jobs/morning (local): the manual trigger', () => {
    test('--now sends the same brief, not the flag as a message', () => {
      const world = mkWorld();
      const res = runJob(world, ['--now']);
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      const message = world.calls()[0][1];
      expect(message.startsWith(INSTRUCTION), 'the flag reaches the compose step: the payload the cloud sends').toBeTruthy();
      expect(!message.includes('--now'), 'and is never mistaken for the message').toBeTruthy();
      cleanup(world.root);
    });

    test('--now marks its log block manual, in the same log file', () => {
      const world = mkWorld();
      runJob(world, ['--now']);
      const logText = world.log();
      expect(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ---/.test(logText), `stamped manual, got: ${logText.slice(0, 120)}`).toBeTruthy();
      cleanup(world.root);
    });

    test('a scheduled run is not marked manual', () => {
      const world = mkWorld();
      runJob(world);
      expect(!/\(manual\)/.test(world.log()), 'the 9am block reads as it always did').toBeTruthy();
      cleanup(world.root);
    });
  });
});
