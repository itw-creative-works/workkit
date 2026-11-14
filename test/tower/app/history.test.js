//
// Tests for the tower dashboard's history.js: the board over time, and the line
// drawn when the cloud brief has stopped posting. Shared prologue: ./helpers.js.
//

const path = require('path');
const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, load } = require('./helpers');

/** A brief payload carrying the history the read-back returns. */
const withHistory = (entries) => ({ counts: { open: 0 }, history: entries });
const day = (date, totals, closedDay = 0) => ({ date, totals, closedDay, repos: {} });

// The pages that draw these charts import the framework (see ./helpers.js), so
// the logic lives in a lib asked directly: the series, the change since last
// week, and which of the three absences this is. The pages are pinned by their
// source.
let github, history;
before(async () => {
  ({ github } = await loadLibs());
  history = await load('history.js');
});

describe('tower/app: history - the board over time', () => {
  test('a series is one point per morning, labelled by day', () => {
    const payload = withHistory([
      day('2026-08-01', { open: 15, inbox: 5 }, 2),
      day('2026-08-02', { open: 14, inbox: 4 }, 1),
      day('2026-08-03', { open: 12, inbox: 3 }, 4),
    ]);
    const open = history.seriesOf(history.entriesOf(payload), 'open');
    expect(open.values.join(','), 'the values, in the order they happened').toBe('15,14,12');
    expect(open.labels.join(','), 'and the year is not on the axis three times').toBe('08-01,08-02,08-03');
    expect(history.seriesOf(history.entriesOf(payload), 'closedDay').values.join(','), 'closedDay is read off the entry, not the totals').toBe('2,1,4');
    expect(history.seriesOf(history.entriesOf(payload), 'ready').values.join(','), 'a total no morning recorded reads as zero, never NaN').toBe('0,0,0');
  });

  test('the three absences are three different states, and none of them is a zero', () => {
    expect(history.entriesOf(withHistory(null)).length, 'a null history maps to nothing').toBe(0);
    expect(history.unread(withHistory(null)), 'and it is UNREAD - the read failed or there is no home repo').toBeTruthy();
    expect(!history.unread(withHistory([])), 'an empty list is a board with no published briefs yet, which is not the same').toBeTruthy();
    expect(!history.hasSeries(withHistory([day('2026-08-03', { open: 1 })])), 'one point is a dot claiming to be a trend').toBeTruthy();
    expect(history.hasSeries(withHistory([day('2026-08-02', { open: 2 }), day('2026-08-03', { open: 1 })])), 'two is a line').toBeTruthy();
    expect(history.ACCRUES.includes('published briefs') && history.UNREAD.includes('could not be read'),
      'and each absence has its own sentence').toBeTruthy();
  });

  test('an unreadable history says WHY, where the read had a reason to give (#215)', () => {
    const said = 'GitHub rate limit hit for this token; resets at 11:04 PM (in 18 min).';
    const line = history.unreadLine(history.UNREAD, { counts: { open: 0 }, history: null, historyReason: said });
    expect(line.startsWith(history.UNREAD), 'the page keeps its own sentence').toBeTruthy();
    expect(line.endsWith(said), `and the read's reason is on the end of it: ${line}`).toBeTruthy();
    expect(history.unreadLine(history.UNREAD, withHistory(null)), 'a read that had no reason to give draws the sentence alone, as it always did').toBe(history.UNREAD);
    expect(history.unreadLine(history.UNREAD, null), 'and so does a copy that was never asked the question').toBe(history.UNREAD);
  });

  test('last week is found by date, not by counting entries', () => {
    // A morning whose brief never published leaves no point, so the seventh
    // entry back can be a fortnight ago.
    const entries = [
      day('2026-07-20', { open: 20 }),
      day('2026-07-27', { open: 15 }),
      day('2026-08-01', { open: 14 }),
      day('2026-08-03', { open: 12 }),
    ];
    const delta = history.weekDelta(entries, 'open');
    expect(delta.from, 'the nearest morning on or before seven days back').toBe(15);
    expect(delta.to, 'against today').toBe(12);
    expect(delta.change, 'three fewer open').toBe(-3);
    expect(delta.days, 'seven days apart').toBe(7);
    expect(history.deltaLine(delta), 'said in plain language').toBe('down 3 from last week');
  });

  test('a comparison that does not exist is no line at all', () => {
    expect(history.weekDelta([day('2026-08-03', { open: 1 })], 'open'), 'one point compares with nothing').toBe(null);
    // Every point inside the week: a delta against the oldest would silently
    // become "since the beginning" on a young board.
    expect(history.weekDelta([day('2026-08-01', { open: 9 }), day('2026-08-03', { open: 4 })], 'open'), 'and a history younger than a week has no last week to compare with').toBe(null);
    expect(history.deltaLine(null), 'so the tile carries no sub-line').toBe('');
  });

  test('a delta of nothing says so, and an older comparison says how old it is', () => {
    const flat = history.weekDelta([day('2026-07-25', { open: 7 }), day('2026-08-03', { open: 7 })], 'open');
    expect(history.deltaLine(flat), 'the gap is named when it is not a week').toBe('unchanged since 9 days ago');
    const up = history.weekDelta([day('2026-07-27', { open: 4 }), day('2026-08-03', { open: 9 })], 'open');
    expect(history.deltaLine(up), 'and a board that grew says up').toBe('up 5 from last week');
  });
});

describe('tower/app: has the cloud brief stopped posting', () => {
  // The API decides the state off its own history read (tower/api/lib/history.js);
  // what is asked here is the line each state draws, since a state drawn as
  // nothing hides a brief that has stopped posting.
  const freshness = (state, date = null) => ({ counts: { open: 0 }, history: [], briefFreshness: { state, date } });

  test('a stale brief is a red line naming the morning it last posted', () => {
    const alert = history.briefAlert(freshness('stale', '2026-08-09'));
    expect(alert.level, 'a brief that stopped running is an alarm, not a note').toBe('danger');
    expect(alert.text.includes('2026-08-09'), `the day it last posted is in the line: ${alert.text}`).toBeTruthy();
    expect(/has not run since/.test(alert.text), 'and the line says what that means').toBeTruthy();
  });

  test('a fresh brief draws nothing at all', () => {
    expect(history.briefAlert(freshness('fresh', '2026-08-19')), 'a morning that posted is not news').toBe(null);
    // A payload carrying no block at all was never asked the question, and an
    // absent key draws nothing here as it does everywhere else on this payload.
    expect(history.briefAlert({ counts: { open: 0 } }), 'and neither is a payload that was never asked the question').toBe(null);
    expect(history.briefAlert(null), 'nor no payload at all').toBe(null);
  });

  test('unreadable is never drawn as stale and never as fine', () => {
    const alert = history.briefAlert(freshness('unreadable'));
    expect(alert, 'a read that failed says so - silence would report it as a healthy morning').toBeTruthy();
    expect(alert.level, 'though it is not the alarm a stopped brief is - nothing is known either way').toBe('warning');
    expect(!/has not run since/.test(alert.text), 'and it makes no claim about when the last one posted').toBeTruthy();
    expect(/could not be read/.test(alert.text), `it says the history could not be read: ${alert.text}`).toBeTruthy();
  });

  test('never published says that, rather than borrowing either sentence', () => {
    const alert = history.briefAlert(freshness('never'));
    expect(alert.level, 'a board waiting on its first brief is not an alarm').toBe('warning');
    expect(/never/.test(alert.text) || /no brief/.test(alert.text), `it says no brief has been published: ${alert.text}`).toBeTruthy();
    expect(!/could not be read/.test(alert.text), 'and it does not claim the read failed').toBeTruthy();
  });

  // A published copy builds its brief in the browser, and away from the machine
  // is when a stopped brief goes unnoticed longest. The decision is mirrored into
  // that build and pinned against the tower's own.
  test('the browser judges the mornings exactly as the tower judges them', () => {
    const apiHistory = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'history.js'));
    const day = (date) => ({ date, totals: { open: 1 }, closedDay: 0, repos: {} });
    const cases = [
      ['this morning posted', [day('2026-08-18'), day('2026-08-19')], '2026-08-19T14:00:00Z', 'fresh'],
      ['and yesterday’s is fresh too - today’s run has not landed at every hour of the day', [day('2026-08-18')], '2026-08-19T14:00:00Z', 'fresh'],
      ['a minute past midnight, yesterday still counts', [day('2026-08-18')], '2026-08-19T00:01:00Z', 'fresh'],
      ['two whole days is a brief that stopped running', [day('2026-08-09'), day('2026-08-17')], '2026-08-19T09:05:00Z', 'stale'],
      ['and the day before yesterday never counts, whatever the hour', [day('2026-08-17')], '2026-08-19T23:59:00Z', 'stale'],
      ['a home repo that has published no brief yet', [], '2026-08-19T09:00:00Z', 'never'],
      ['a read that failed is not a quiet morning', null, '2026-08-19T09:00:00Z', 'unreadable'],
      ['nor is a date the arithmetic cannot place', [day('the ninth of never')], '2026-08-19T09:00:00Z', 'unreadable'],
    ];
    for (const [what, entries, now, state] of cases) {
      const mine = github.briefFreshness(entries, now);
      expect(mine.state, what).toBe(state);
      expect(JSON.stringify(mine), `one verdict, whichever side judged it: ${what}`).toBe(JSON.stringify(apiHistory.briefFreshness(entries, new Date(now))));
    }
  });

  test('the published payload carries that verdict, so the same banner is drawn off-machine', () => {
    const stamp = '2026-08-19T09:05:00Z';
    const board = { ok: true, issues: [], repos: [] };
    const morning = (date) => [{ date, totals: { open: 1 }, closedDay: 0, repos: {} }];

    const stopped = github.buildBrief(board, { generatedAt: stamp, history: morning('2026-08-09') });
    expect(stopped.briefFreshness.state, 'the browser judges the history it just read, not a second one').toBe('stale');
    const alert = history.briefAlert(stopped);
    expect(alert.level, 'and the one line-drawer answers the published payload as it answers the tower’s').toBe('danger');
    expect(alert.text.includes('2026-08-09'), `naming the morning it last posted: ${alert.text}`).toBeTruthy();

    const posting = github.buildBrief(board, { generatedAt: stamp, history: morning('2026-08-18') });
    expect(history.briefAlert(posting), 'a morning that posted draws nothing off-machine either').toBe(null);
    // A read that failed carries no history at all - and a browser that could
    // not reach the home repo knows nothing, which is not a healthy morning.
    expect(github.buildBrief(board, { generatedAt: stamp }).briefFreshness.state, 'and a history nobody could read says so rather than staying silent').toBe('unreadable');
  });
});
