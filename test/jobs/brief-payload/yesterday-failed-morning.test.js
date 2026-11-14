// Tests for jobs/morning/brief/brief-payload.js, the payload the 9am job hands
// to Claude: yesterday and the week, and a failed morning that is still a morning.
// The shared prologue (fixture worlds, composer seam) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const {
  composeBrief, SLUG, STAMP, cleanup, mkWorld, captureStderr, composeIn, nameHomeRepo, discussion, MONDAY, TUESDAY,
} = require('./helpers');

describe('jobs/brief-payload: yesterday and the week', () => {
  test('the newest daily summary is the findings, every morning', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [
      discussion('brief: 2026-08-03', '2026-08-03'),
      discussion('daily: 2026-08-02', '2026-08-02'),
      discussion('weekly: 2026-08-02', '2026-08-02'),
    ];
    const out = composeIn(world, TUESDAY);
    expect(out.findings.title, 'what yesterday produced, said by the artifact that recorded it').toBe('daily: 2026-08-02');
    expect(out.findings.url.includes('/discussions/'), `and its link: ${out.findings.url}`).toBeTruthy();
    expect(!('week' in out), 'and a Tuesday carries no rollup at all').toBeTruthy();
    cleanup(world.root);
  });

  test('Monday, and only Monday, also carries the week', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [discussion('daily: 2026-08-02', '2026-08-02'), discussion('weekly: 2026-08-02', '2026-08-02')];
    const monday = composeIn(world, MONDAY);
    expect(monday.week.title, 'one brief a day, richer on a Monday').toBe('weekly: 2026-08-02');
    expect(monday.findings.title, 'beside the day before').toBe('daily: 2026-08-02');
    expect(!('week' in composeIn(world, TUESDAY)), 'the day after asks for no rollup').toBeTruthy();
    cleanup(world.root);
  });

  test('unreachable Discussions still compose a brief, and the gap is named', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussionsError = new Error('gh: not authenticated');
    let out;
    const stderr = captureStderr(() => { out = composeIn(world, MONDAY); });
    expect(out.ok, 'the morning is not lost to a summary nobody could read').toBe(true);
    expect(out.counts.open, 'and the board is all there').toBe(2);
    expect(out.findings, 'the key says there was nothing to read').toBe(null);
    expect(out.week, 'and so does the rollup').toBe(null);
    // The line carries the read's own reason, so the gap never reads as a
    // night that produced nothing.
    expect(/^brief: no daily summary could be read from owner\/private-home: gh graphql failed: /m.test(stderr), `the skip is named, with why: ${JSON.stringify(stderr)}`).toBeTruthy();
    expect(/^brief: it is Monday and no weekly rollup could be read from owner\/private-home: gh graphql failed: /m.test(stderr), `both of them: ${JSON.stringify(stderr)}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a machine with no home repo says nothing about summaries', () => {
    // It has no board to have read: a fact about the machine, not a gap in
    // this morning, and a line every day would be noise.
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world, MONDAY));
    expect(stderr, `nothing is said: ${JSON.stringify(stderr)}`).toBe('');
    cleanup(world.root);
  });
});

describe('jobs/brief-payload: a failed morning is still a morning', () => {
  test('gh missing prints a failed sweep, not a quiet board', () => {
    const world = mkWorld();
    world.ghMissing = true;
    const out = composeIn(world);
    expect(out.ok, 'the brief is not ok').toBe(false);
    expect(out.reason, 'and says why').toBe('gh not found');
    expect(out.counts.open, 'with no invented work').toBe(0);
    cleanup(world.root);
  });

  test('a repo the sweep could not read is named on stderr', () => {
    // The shape a short token scope takes: the board answers, ok stays true, and
    // the repo it could not read is a per-repo error the payload never carries.
    const world = mkWorld();
    world.board = {
      data: { r0: null },
      errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository' }],
    };
    let out;
    const stderr = captureStderr(() => { out = composeIn(world); });
    expect(out.ok, 'the sweep itself answered: this is not a failed morning').toBe(true);
    expect(stderr, `the gap is said out loud: ${JSON.stringify(stderr)}`).toBe(`brief: 1 repos unreadable: ${SLUG}\n`);
    cleanup(world.root);
  });

  test('a clean sweep says nothing', () => {
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world));
    expect(stderr, `no line when every repo answered: ${JSON.stringify(stderr)}`).toBe('');
    cleanup(world.root);
  });

  test('a roster read that throws is reported as one', () => {
    const out = composeBrief({
      generatedAt: STAMP,
      exec: () => { throw new Error('never called'); },
      // The read swallows an unreadable file, so the throw has to come from
      // the argument itself: a getter is the one seam that reaches inside.
      get workflowHome() { throw new Error('the workflow home could not be read'); },
    });
    expect(out.ok, 'the brief is not ok').toBe(false);
    expect(/roster read failed/.test(out.reason), `and names the read: ${out.reason}`).toBeTruthy();
  });
});
