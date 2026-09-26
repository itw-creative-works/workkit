//
// Tests for the tower dashboard's history.js: the board over time, and the
// line drawn when the cloud brief has stopped posting.
// The note this suite points at (why a page module is out of reach under
// Node) is the header atop ./helpers.js, which holds the shared prologue.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, load } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: history - the board over time');

  // The pages that DRAW these charts import the framework's chart module and
  // are out of reach here (the note at the top of this file), so the logic they
  // draw from lives in a lib and is asked its questions directly: what is the
  // series, what changed since last week, and which of the three absences is
  // this. The pages are pinned by reading their source, the way every other
  // page claim in this suite is.

  const history = await load('history.js');

  /** A brief payload carrying the history the read-back returns. */
  const withHistory = (entries) => ({ counts: { open: 0 }, history: entries });
  const day = (date, totals, closedDay = 0) => ({ date, totals, closedDay, repos: {} });

  await test('a series is one point per morning, labelled by day', () => {
    const payload = withHistory([
      day('2026-08-01', { open: 15, inbox: 5 }, 2),
      day('2026-08-02', { open: 14, inbox: 4 }, 1),
      day('2026-08-03', { open: 12, inbox: 3 }, 4),
    ]);
    const open = history.seriesOf(history.entriesOf(payload), 'open');
    assertEq(open.values.join(','), '15,14,12', 'the values, in the order they happened');
    assertEq(open.labels.join(','), '08-01,08-02,08-03', 'and the year is not on the axis three times');
    assertEq(history.seriesOf(history.entriesOf(payload), 'closedDay').values.join(','), '2,1,4', 'closedDay is read off the entry, not the totals');
    assertEq(history.seriesOf(history.entriesOf(payload), 'ready').values.join(','), '0,0,0', 'a total no morning recorded reads as zero, never NaN');
  });

  await test('the three absences are three different states, and none of them is a zero', () => {
    assertEq(history.entriesOf(withHistory(null)).length, 0, 'a null history maps to nothing');
    assert(history.unread(withHistory(null)), 'and it is UNREAD - the read failed or there is no home repo');
    assert(!history.unread(withHistory([])), 'an empty list is a board with no published briefs yet, which is not the same');
    assert(!history.hasSeries(withHistory([day('2026-08-03', { open: 1 })])), 'one point is a dot claiming to be a trend');
    assert(history.hasSeries(withHistory([day('2026-08-02', { open: 2 }), day('2026-08-03', { open: 1 })])), 'two is a line');
    assert(history.ACCRUES.includes('published briefs') && history.UNREAD.includes('could not be read'),
      'and each absence has its own sentence');
  });

  await test('an unreadable history says WHY, where the read had a reason to give (#215)', () => {
    const fs = require('fs');
    const said = 'GitHub rate limit hit for this token; resets at 11:04 PM (in 18 min).';
    const line = history.unreadLine(history.UNREAD, { counts: { open: 0 }, history: null, historyReason: said });
    assert(line.startsWith(history.UNREAD), 'the page keeps its own sentence');
    assert(line.endsWith(said), `and the read's reason is on the end of it: ${line}`);
    assertEq(history.unreadLine(history.UNREAD, withHistory(null)), history.UNREAD,
      'a read that had no reason to give draws the sentence alone, as it always did');
    assertEq(history.unreadLine(history.UNREAD, null), history.UNREAD,
      'and so does a copy that was never asked the question');

    // Both pages drawn off that one read say it, each keeping its own tail.
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['index.js', 'brief.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(/unreadLine\(UNREAD, payload\)/.test(source), `${name} draws the reason where it drew the bare sentence`);
    }
  });

  await test('last week is found by date, not by counting entries', () => {
    // A morning whose brief never published leaves no point, so the seventh
    // entry back can be a fortnight ago.
    const entries = [
      day('2026-07-20', { open: 20 }),
      day('2026-07-27', { open: 15 }),
      day('2026-08-01', { open: 14 }),
      day('2026-08-03', { open: 12 }),
    ];
    const delta = history.weekDelta(entries, 'open');
    assertEq(delta.from, 15, 'the nearest morning on or before seven days back');
    assertEq(delta.to, 12, 'against today');
    assertEq(delta.change, -3, 'three fewer open');
    assertEq(delta.days, 7, 'seven days apart');
    assertEq(history.deltaLine(delta), 'down 3 from last week', 'said in plain language');
  });

  await test('a comparison that does not exist is no line at all', () => {
    assertEq(history.weekDelta([day('2026-08-03', { open: 1 })], 'open'), null, 'one point compares with nothing');
    // Every point inside the week: a delta against the oldest would silently
    // become "since the beginning" on a young board.
    assertEq(history.weekDelta([day('2026-08-01', { open: 9 }), day('2026-08-03', { open: 4 })], 'open'), null,
      'and a history younger than a week has no last week to compare with');
    assertEq(history.deltaLine(null), '', 'so the tile carries no sub-line');
  });

  await test('a delta of nothing says so, and an older comparison says how old it is', () => {
    const flat = history.weekDelta([day('2026-07-25', { open: 7 }), day('2026-08-03', { open: 7 })], 'open');
    assertEq(history.deltaLine(flat), 'unchanged since 9 days ago', 'the gap is named when it is not a week');
    const up = history.weekDelta([day('2026-07-27', { open: 4 }), day('2026-08-03', { open: 9 })], 'open');
    assertEq(history.deltaLine(up), 'up 5 from last week', 'and a board that grew says up');
  });

  await test('the Overview draws the history through the framework’s chart module, and invents no colour', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    const source = fs.readFileSync(path.join(pages, 'index.js'), 'utf8');
    assert(/from '__main_assets__\/js\/libs\/charts\.js'/.test(source), 'index.js draws through the framework module');
    assert(/chartSlot\(/.test(source), 'index.js draws into the slot that says the figures are in the table when the chunk did not load');
    assert(/hasSeries\(/.test(source) && /ACCRUES/.test(source), 'index.js says why a chart is absent rather than drawing an empty axis');
    // A raw colour would be one the theme cannot restate; the module's own
    // ramp is what every other chart on the tower draws in.
    assert(!/['"]#[0-9a-fA-F]{3,8}['"]/.test(source), 'index.js names no colour of its own');
    assert(/feeds: \['repos', 'board', 'sessions', 'health', 'brief'\]/.test(source),
      'and the Overview asks for the brief feed the history rides on');
    // The Brief drew the same series a second time, small, beside the same
    // counts (#55). It draws no chart at all now (#181): the page is the
    // mornings themselves, and the series read off them is the Overview's.
    const brief = fs.readFileSync(path.join(pages, 'brief.js'), 'utf8');
    assert(!/chartSlot\(|lineChart\(|charts\.js/.test(brief), 'and the Brief draws no chart of its own any more');
  });

  group('tower/app: has the cloud brief stopped posting');

  // Issue #172: the cloud brief failed every morning for ten days and both
  // pages went on looking normal. The API decides the state off its own history
  // read (tower/api/lib/history.js); what is asked here is the LINE each state
  // draws, since a state drawn as nothing is exactly the blindness this fixes.
  const freshness = (state, date = null) => ({ counts: { open: 0 }, history: [], briefFreshness: { state, date } });

  await test('a stale brief is a red line naming the morning it last posted', () => {
    const alert = history.briefAlert(freshness('stale', '2026-08-09'));
    assertEq(alert.level, 'danger', 'a brief that stopped running is an alarm, not a note');
    assert(alert.text.includes('2026-08-09'), `the day it last posted is in the line: ${alert.text}`);
    assert(/has not run since/.test(alert.text), 'and the line says what that means');
  });

  await test('a fresh brief draws nothing at all', () => {
    assertEq(history.briefAlert(freshness('fresh', '2026-08-19')), null, 'a morning that posted is not news');
    // A payload carrying no block at all was never asked the question, and an
    // absent key draws nothing here as it does everywhere else on this payload.
    assertEq(history.briefAlert({ counts: { open: 0 } }), null, 'and neither is a payload that was never asked the question');
    assertEq(history.briefAlert(null), null, 'nor no payload at all');
  });

  await test('unreadable is never drawn as stale and never as fine', () => {
    const alert = history.briefAlert(freshness('unreadable'));
    assert(alert, 'a read that failed says so - silence would report it as a healthy morning');
    assertEq(alert.level, 'warning', 'though it is not the alarm a stopped brief is - nothing is known either way');
    assert(!/has not run since/.test(alert.text), 'and it makes no claim about when the last one posted');
    assert(/could not be read/.test(alert.text), `it says the history could not be read: ${alert.text}`);
  });

  await test('never published says that, rather than borrowing either sentence', () => {
    const alert = history.briefAlert(freshness('never'));
    assertEq(alert.level, 'warning', 'a board waiting on its first brief is not an alarm');
    assert(/never/.test(alert.text) || /no brief/.test(alert.text), `it says no brief has been published: ${alert.text}`);
    assert(!/could not be read/.test(alert.text), 'and it does not claim the read failed');
  });

  // Issue #176: the line above was drawn on this machine only. A published copy
  // builds its brief in the browser, so it was never asked the question at all -
  // and away from the machine is exactly when a stopped brief goes unnoticed
  // longest. The decision is mirrored into that build, and pinned here against
  // the tower's own: a drift either way is one surface calling a dead brief
  // healthy.
  await test('the browser judges the mornings exactly as the tower judges them', () => {
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
      assertEq(mine.state, state, what);
      assertEq(JSON.stringify(mine), JSON.stringify(apiHistory.briefFreshness(entries, new Date(now))),
        `one verdict, whichever side judged it: ${what}`);
    }
  });

  await test('the published payload carries that verdict, so the same banner is drawn off-machine', () => {
    const stamp = '2026-08-19T09:05:00Z';
    const board = { ok: true, issues: [], repos: [] };
    const morning = (date) => [{ date, totals: { open: 1 }, closedDay: 0, repos: {} }];

    const stopped = github.buildBrief(board, { generatedAt: stamp, history: morning('2026-08-09') });
    assertEq(stopped.briefFreshness.state, 'stale', 'the browser judges the history it just read, not a second one');
    const alert = history.briefAlert(stopped);
    assertEq(alert.level, 'danger', 'and the one line-drawer answers the published payload as it answers the tower’s');
    assert(alert.text.includes('2026-08-09'), `naming the morning it last posted: ${alert.text}`);

    const posting = github.buildBrief(board, { generatedAt: stamp, history: morning('2026-08-18') });
    assertEq(history.briefAlert(posting), null, 'a morning that posted draws nothing off-machine either');
    // A read that failed carries no history at all - and a browser that could
    // not reach the home repo knows nothing, which is not a healthy morning.
    assertEq(github.buildBrief(board, { generatedAt: stamp }).briefFreshness.state, 'unreadable',
      'and a history nobody could read says so rather than staying silent');
  });

  await test('both pages draw that line, and the Health page asks for the feed it rides on', () => {
    const pages = path.join(__dirname, '..', '..', '..', 'tower', 'app', 'targets', 'web', 'src', 'assets', 'js', 'pages');
    for (const name of ['health.js', 'brief.js']) {
      const source = fs.readFileSync(path.join(pages, name), 'utf8');
      assert(/briefAlert\(/.test(source), `${name} draws the line from the one decision, never its own`);
      assert(/alert-\$\{/.test(source), `${name} takes the colour from the level rather than fixing one`);
      assert(/esc\(/.test(source), `${name} escapes it - the date came off a Discussion body`);
    }
    // A builder nothing PLACES is a line nobody sees, which is the whole of the
    // blindness this fixes - so the markup each page writes is pinned too.
    const health = fs.readFileSync(path.join(pages, 'health.js'), 'utf8');
    assert(/\$\{briefRow\(state\)\}/.test(health), 'the Health page writes the row into the body it swaps in');
    assert(/\$\{staleBanner\(payload\)\}/.test(fs.readFileSync(path.join(pages, 'brief.js'), 'utf8')),
      'and the Brief page writes the banner into its own');
    assert(/feeds: \[[^\]]*'brief'[^\]]*\]/.test(health),
      'and the Health page arms the brief feed the freshness rides on');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
