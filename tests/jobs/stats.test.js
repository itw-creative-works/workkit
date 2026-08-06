//
// Tests for jobs/stats.js — the stats line a published brief carries.
//
// The line is the ONLY store the history charts have (issue #55), so what is
// pinned here is its exact text: a renderer that quietly renamed a key or
// reordered the JSON would leave every published morning unreadable to the
// module that reads them back. The expected JSON is written out by hand for
// that reason — one composed from the implementation would agree with any
// shape it happened to have.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { renderStatsMark, dayOf, STATS_RE } = require(path.join(__dirname, '..', '..', 'jobs', 'stats.js'));
const { parseStatsMark, STATS_RE: READ_RE } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

/** A brief payload in the shape buildBrief returns, with the two new keys on it. */
const PAYLOAD = {
  ok: true,
  generatedAt: '2026-08-03T09:00:00.000Z',
  counts: { open: 12, waiting: 2, qa: 2, ready: 3, inFlight: 1, inbox: 5, parked: 1 },
  closedDay: 4,
  repoCounts: [
    { slug: 'ITW-Creative-Works/workkit', open: 9, closedDay: 3 },
    { slug: 'ianwieds/.dotfiles', open: 3, closedDay: 1 },
  ],
};

const EXPECTED = '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":12,"waiting":2,"qa":2,"ready":3,"inFlight":1,"inbox":5,"parked":1},"closedDay":4,"repos":{"ITW-Creative-Works/workkit":{"open":9},"ianwieds/.dotfiles":{"open":3}}} -->';

const run = async () => {
  group('jobs/stats: the line itself');

  await test('the mark is one line of JSON, key for key', () => {
    assertEq(renderStatsMark(PAYLOAD), EXPECTED, 'the shape a morning publishes');
    assert(!renderStatsMark(PAYLOAD).includes('\n'), 'and it is one line — a comment in a Discussion body');
  });

  await test('the day comes from the payload’s own stamp, never from the clock', () => {
    const midnight = renderStatsMark({ ...PAYLOAD, generatedAt: '2026-01-01T00:30:00.000Z' });
    assert(midnight.includes('"date":"2026-01-01"'), `the stamp's day, got: ${midnight}`);
    assertEq(dayOf('2026-12-25T23:59:59.000Z'), '2026-12-25', 'the ISO day of the stamp');
    assertEq(dayOf('not a date'), '', 'and a stamp that is not one has no day');
  });

  await test('a payload with no usable stamp publishes no line at all', () => {
    // An undated point cannot be placed on an axis, and one dated today would
    // be a wrong day drawn confidently.
    assertEq(renderStatsMark({ ...PAYLOAD, generatedAt: 'whenever' }), '', 'nothing rather than a guess');
    assertEq(renderStatsMark(null), '', 'and no payload is no line');
    assertEq(renderStatsMark({ ok: true, generatedAt: PAYLOAD.generatedAt }), '', 'nor is a payload with no counts');
  });

  await test('a morning whose sweep failed publishes no line at all', () => {
    // buildBrief reports a failed sweep as such ("gh could not answer"), but its
    // counts are still zeros — and the line is the only store, so a zero point
    // published for that day would be a permanent cliff in every chart. The
    // missing day is the honest answer, same as the undated case.
    assertEq(renderStatsMark({ ...PAYLOAD, ok: false }), '', 'a failed sweep is a missing day, not a board of zeros');
  });

  await test('the numbers absent from a payload are zeros, not gaps', () => {
    const out = renderStatsMark({ ok: true, generatedAt: '2026-08-03T09:00:00.000Z', counts: { open: 1 } });
    assertEq(out, '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":1,"waiting":0,"qa":0,"ready":0,"inFlight":0,"inbox":0,"parked":0},"closedDay":0,"repos":{}} -->',
      'every key a reader expects is present');
  });

  group('jobs/stats: the writer and the reader are one shape');

  await test('the pattern is the read-back’s own, not a second copy', () => {
    assertEq(STATS_RE, READ_RE, 'jobs/stats.js re-exports tower/api/lib/history.js’s pattern');
  });

  await test('what the renderer wrote is what the reader parses back', () => {
    // The round trip through a body that looks like a published brief: prose
    // above it, the news cursor beside it.
    const body = `HEADLINE: a day happened.\n\nWAITING ON YOU: nothing.\n\n<!-- cc-news: 2.1.220 -->\n${EXPECTED}\n`;
    const back = parseStatsMark(body);
    assertEq(back.date, '2026-08-03', 'the day survives');
    assertEq(back.totals.inFlight, 1, 'and every total');
    assertEq(back.closedDay, 4, 'and what the day closed');
    assertEq(back.repos['ITW-Creative-Works/workkit'].open, 9, 'and the per-repo open count');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
