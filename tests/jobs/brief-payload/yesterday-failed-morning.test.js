//
// Tests for jobs/brief-payload.js, the payload the 9am job hands to Claude:
// yesterday and the week, and a failed morning that is still a morning.
// The shared prologue (the two fixture worlds, the composer seam, the summaries fixtures, the news gate) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  composeBrief, SLUG, STAMP, cleanup, mkWorld, captureStderr, composeIn, nameHomeRepo, discussion, MONDAY, TUESDAY,
} = require('./helpers');

const run = async () => {
  group('jobs/brief-payload: yesterday and the week');

  await test('the newest daily summary is the findings, every morning', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [
      discussion('brief: 2026-08-03', '2026-08-03'),
      discussion('daily: 2026-08-02', '2026-08-02'),
      discussion('weekly: 2026-08-02', '2026-08-02'),
    ];
    const out = composeIn(world, TUESDAY);
    assertEq(out.findings.title, 'daily: 2026-08-02', 'what yesterday produced, said by the artifact that recorded it');
    assert(out.findings.url.includes('/discussions/'), `and its link: ${out.findings.url}`);
    assert(!('week' in out), 'and a Tuesday carries no rollup at all');
    cleanup(world.root);
  });

  await test('Monday, and only Monday, also carries the week', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [discussion('daily: 2026-08-02', '2026-08-02'), discussion('weekly: 2026-08-02', '2026-08-02')];
    const monday = composeIn(world, MONDAY);
    assertEq(monday.week.title, 'weekly: 2026-08-02', 'one brief a day, richer on a Monday');
    assertEq(monday.findings.title, 'daily: 2026-08-02', 'beside the day before');
    assert(!('week' in composeIn(world, TUESDAY)), 'the day after asks for no rollup');
    cleanup(world.root);
  });

  await test('unreachable Discussions still compose a brief, and the gap is named', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussionsError = new Error('gh: not authenticated');
    let out;
    const stderr = captureStderr(() => { out = composeIn(world, MONDAY); });
    assertEq(out.ok, true, 'the morning is not lost to a summary nobody could read');
    assertEq(out.counts.open, 2, 'and the board is all there');
    assertEq(out.findings, null, 'the key says there was nothing to read');
    assertEq(out.week, null, 'and so does the rollup');
    // The line carries the read's own reason (#215): a gap with nothing to
    // explain it read as a night that produced nothing.
    assert(/^brief: no daily summary could be read from owner\/private-home: gh graphql failed: /m.test(stderr), `the skip is named, with why: ${JSON.stringify(stderr)}`);
    assert(/^brief: it is Monday and no weekly rollup could be read from owner\/private-home: gh graphql failed: /m.test(stderr), `both of them: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a machine with no home repo says nothing about summaries', () => {
    // It has no board to have read: a fact about the machine, not a gap in
    // this morning, and a line every day would be noise.
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world, MONDAY));
    assertEq(stderr, '', `nothing is said: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  group('jobs/brief-payload: a failed morning is still a morning');

  await test('gh missing prints a failed sweep, not a quiet board', () => {
    const world = mkWorld();
    world.ghMissing = true;
    const out = composeIn(world);
    assertEq(out.ok, false, 'the brief is not ok');
    assertEq(out.reason, 'gh not found', 'and says why');
    assertEq(out.counts.open, 0, 'with no invented work');
    cleanup(world.root);
  });

  await test('a repo the sweep could not read is named on stderr', () => {
    // The shape a short token scope takes: the board answers, ok stays true, and
    // the repo it could not read is a per-repo error the payload never carries.
    const world = mkWorld();
    world.board = {
      data: { r0: null },
      errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository' }],
    };
    let out;
    const stderr = captureStderr(() => { out = composeIn(world); });
    assertEq(out.ok, true, 'the sweep itself answered: this is not a failed morning');
    assertEq(stderr, `brief: 1 repos unreadable: ${SLUG}\n`, `the gap is said out loud: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a clean sweep says nothing', () => {
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world));
    assertEq(stderr, '', `no line when every repo answered: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a roster read that throws is reported as one', () => {
    const out = composeBrief({
      generatedAt: STAMP,
      exec: () => { throw new Error('never called'); },
      // The read swallows an unreadable file, so the throw has to come from
      // the argument itself: a getter is the one seam that reaches inside.
      get workflowHome() { throw new Error('the workflow home could not be read'); },
    });
    assertEq(out.ok, false, 'the brief is not ok');
    assert(/roster read failed/.test(out.reason), `and names the read: ${out.reason}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
