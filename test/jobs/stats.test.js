// Tests for jobs/morning/brief/stats.js: the stats line a published brief
// carries. The line is the only store the history charts have, so its exact
// text is pinned, written out by hand: JSON composed from the implementation
// would agree with any shape it happened to have.

const path = require('path');
const { describe, test, expect } = require('../lib/harness');

const { renderStatsMark, dayOf } = require(path.join(__dirname, '..', '..', 'jobs', 'morning', 'brief', 'stats.js'));
const { parseStatsMark } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

/** A brief payload in the shape buildBrief returns, with closedDay and repoCounts on it. */
const PAYLOAD = {
  ok: true,
  generatedAt: '2026-08-03T09:00:00.000Z',
  counts: { open: 12, waiting: 2, complete: 1, qa: 2, ready: 3, inFlight: 1, inbox: 5, backlog: 1 },
  closedDay: 4,
  repoCounts: [
    { slug: 'ITW-Creative-Works/workkit', open: 9, closedDay: 3 },
    { slug: 'alice/.dotfiles', open: 3, closedDay: 1 },
  ],
};

const EXPECTED = '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":12,"waiting":2,"complete":1,"qa":2,"ready":3,"inFlight":1,"inbox":5,"backlog":1},"closedDay":4,"repos":{"ITW-Creative-Works/workkit":{"open":9},"alice/.dotfiles":{"open":3}}} -->';

describe('jobs/stats: the line itself', () => {
  test('the mark is one line of JSON, key for key', () => {
    expect(renderStatsMark(PAYLOAD), 'the shape a morning publishes').toBe(EXPECTED);
    expect(!renderStatsMark(PAYLOAD).includes('\n'), 'and it is one line: a comment in a Discussion body').toBeTruthy();
  });

  test('the day comes from the payload’s own stamp, never from the clock', () => {
    const midnight = renderStatsMark({ ...PAYLOAD, generatedAt: '2026-01-01T00:30:00.000Z' });
    expect(midnight.includes('"date":"2026-01-01"'), `the stamp's day, got: ${midnight}`).toBeTruthy();
    expect(dayOf('2026-12-25T23:59:59.000Z'), 'the ISO day of the stamp').toBe('2026-12-25');
    expect(dayOf('not a date'), 'and a stamp that is not one has no day').toBe('');
  });

  test('a payload with no usable stamp publishes no line at all', () => {
    // An undated point cannot be placed on an axis, and one dated today would
    // be a wrong day drawn confidently.
    expect(renderStatsMark({ ...PAYLOAD, generatedAt: 'whenever' }), 'nothing rather than a guess').toBe('');
    expect(renderStatsMark(null), 'and no payload is no line').toBe('');
    expect(renderStatsMark({ ok: true, generatedAt: PAYLOAD.generatedAt }), 'nor is a payload with no counts').toBe('');
  });

  test('a morning whose sweep failed publishes no line at all', () => {
    // buildBrief reports a failed sweep as such ("gh could not answer"), but its
    // counts are still zeros, and the line is the only store, so a zero point
    // published for that day would be a permanent cliff in every chart. The
    // missing day is the honest answer, same as the undated case.
    expect(renderStatsMark({ ...PAYLOAD, ok: false }), 'a failed sweep is a missing day, not a board of zeros').toBe('');
  });

  test('the numbers absent from a payload are zeros, not gaps', () => {
    const out = renderStatsMark({ ok: true, generatedAt: '2026-08-03T09:00:00.000Z', counts: { open: 1 } });
    expect(out, 'every key a reader expects is present').toBe('<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":1,"waiting":0,"complete":0,"qa":0,"ready":0,"inFlight":0,"inbox":0,"backlog":0},"closedDay":0,"repos":{}} -->');
  });
});

describe('jobs/stats: the writer and the reader are one shape', () => {
  test('what the renderer wrote is what the reader parses back', () => {
    // The round trip through a body that looks like a published brief: prose
    // above it, the news cursor beside it.
    const body = `HEADLINE: a day happened.\n\nWAITING ON YOU: nothing.\n\n<!-- cc-news: 2.1.220 -->\n${EXPECTED}\n`;
    const back = parseStatsMark(body);
    expect(back.date, 'the day survives').toBe('2026-08-03');
    expect(back.totals.inFlight, 'and every total').toBe(1);
    expect(back.closedDay, 'and what the day closed').toBe(4);
    expect(back.repos['ITW-Creative-Works/workkit'].open, 'and the per-repo open count').toBe(9);
  });
});
