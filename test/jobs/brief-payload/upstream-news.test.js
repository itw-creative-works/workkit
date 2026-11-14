// Tests for jobs/morning/brief/brief-payload.js, the payload the 9am job hands
// to Claude: the upstream news, its cursor, and the stats line the runner appends.
// The shared prologue (fixture worlds, composer seam) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  SCRIPT, writeBriefMarks, INSTRUCTION, parseStatsMark, CC_CHANGELOG, cleanup, mkNewsWorld,
} = require('./helpers');

describe('jobs/brief-payload: the upstream news', () => {
  test('a first run prints no block and hands the runner the latest version', { skip: skipWithoutNodeStub() }, () => {
    // The cursor is a line in the latest published brief, so the
    // world here is an empty board and a scratch mark file, never the network.
    const world = mkNewsWorld();
    const first = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    expect(first.status, `exit 0, stderr: ${first.stderr}`).toBe(0);
    // Past the instruction, which names the block it is explaining.
    expect(!/--- CC NEWS ---/.test(first.stdout.slice(INSTRUCTION.length)), 'the first morning does not dump the history').toBeTruthy();
    expect(world.mark().split('\n')[0], 'the version line the published brief will carry').toBe('<!-- cc-news: 2.1.219 -->');

    // The brief that publish would have made, now on the board, and a release
    // above it upstream.
    world.publish('2.1.219');
    fs.writeFileSync(world.ccFile, `# Changelog\n\n## 2.1.220\n\n- Added a \`DirectoryAdded\` hook\n- Bug fixes\n${CC_CHANGELOG}`);
    const second = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    expect(second.status, `exit 0, stderr: ${second.stderr}`).toBe(0);
    expect(/--- CC NEWS ---/.test(second.stdout.slice(INSTRUCTION.length)), 'the new release is flagged').toBeTruthy();
    expect(/\[hooks\]\n2\.1\.220: Added a `DirectoryAdded` hook/.test(second.stdout), 'with the entry under its topic').toBeTruthy();
    expect(/\[other\]\n2\.1\.220: Bug fixes/.test(second.stdout), 'and the housekeeping rides under other: the digest judges, not the job').toBeTruthy();
    expect(world.mark().split('\n')[0], 'and the cursor the next brief publishes has advanced').toBe('<!-- cc-news: 2.1.220 -->');
    cleanup(world.home);
  });

  test('the mark file carries both lines: the cursor and the day’s stats', { skip: skipWithoutNodeStub() }, () => {
    // The runner appends this file verbatim under the digest, so
    // both lines the published brief is meant to carry leave together.
    const world = mkNewsWorld();
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env: world.env });
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const lines = world.mark().trim().split('\n');
    expect(lines.length, `two lines, got: ${world.mark()}`).toBe(2);
    expect(/^<!-- cc-news: /.test(lines[0]), `the cursor leads: ${lines[0]}`).toBeTruthy();
    expect(/^<!-- workkit-stats: \{"v":1,"date":"\d{4}-\d{2}-\d{2}",/.test(lines[1]), `and the stats line follows: ${lines[1]}`).toBeTruthy();
    expect(parseStatsMark(lines[1]), 'in the shape the read-back parses').toBeTruthy();
    cleanup(world.home);
  });

  test('the stats line rides even when there was no news to carry', { skip: skipWithoutNodeStub() }, () => {
    // The two lines are independent: an upstream read that failed publishes no
    // cursor, and the day's numbers are not the news's to take with it.
    const world = mkNewsWorld();
    const env = { ...world.env, WORKKIT_CC_CHANGELOG: 'file:///nowhere/at/all.md' };
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const lines = world.mark().trim().split('\n');
    expect(lines.length, `one line, got: ${world.mark()}`).toBe(1);
    expect(/^<!-- workkit-stats: /.test(lines[0]), `and it is the day's numbers: ${lines[0]}`).toBeTruthy();
    cleanup(world.home);
  });

  test('the stats line says what the payload said, not what the day happened to be', () => {
    // Composed directly, so the numbers are stated rather than swept: the line
    // is the payload's own counts, and its date is the payload's own stamp.
    const dir = mkTmp('brief-payload-');
    const file = path.join(dir, 'mark');
    const before = process.env.WORKKIT_BRIEF_MARK_FILE;
    process.env.WORKKIT_BRIEF_MARK_FILE = file;
    writeBriefMarks(null, {
      ok: true,
      generatedAt: '2026-08-03T09:00:00.000Z',
      counts: { open: 4, waiting: 1, qa: 1, ready: 1, inFlight: 1, inbox: 1, backlog: 0 },
      closedDay: 2,
      repoCounts: [{ slug: 'owner/repo', open: 4, closedDay: 2 }],
    });
    if (before === undefined) delete process.env.WORKKIT_BRIEF_MARK_FILE;
    else process.env.WORKKIT_BRIEF_MARK_FILE = before;
    expect(
      fs.readFileSync(file, 'utf8'),
      'the line, exactly as the runner will append it',
    ).toBe('<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":4,"waiting":1,"complete":0,"qa":1,"ready":1,"inFlight":1,"inbox":1,"backlog":0},"closedDay":2,"repos":{"owner/repo":{"open":4}}} -->\n');
    cleanup(dir);
  });

  test('with no mark file named, the script still prints its brief', { skip: skipWithoutNodeStub() }, () => {
    // The runner names the file; a human running `node jobs/morning/brief/brief-payload.js`
    // does not, and the payload is the whole point of the script.
    const world = mkNewsWorld();
    const env = { ...world.env };
    delete env.WORKKIT_BRIEF_MARK_FILE;
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: SPAWN_DEADLINE, env });
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith(INSTRUCTION), 'the payload printed').toBeTruthy();
    cleanup(world.home);
  });
});
