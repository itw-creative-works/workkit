//
// Tests for tower/api/lib/history.js, the published briefs read back through a
// fake `gh`; the bodies read as a real brief does, so the parse finds its own line.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { resetIn, clockAt, mkLimited, mkRefused } = require('../lib/gh');

const {
  readDiscussions, briefHistory, briefFreshness, parseStatsMark, HISTORY_LIMIT, BRIEF_TITLE_PREFIX,
} = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A scratch ~/.workkit naming a home repo - or naming none. */
const mkHome = (repo = 'owner/private-home') => {
  const dir = mkTmp('tower-history-');
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
  );
  return dir;
};

/** The line a morning publishes, as jobs/morning/brief/stats.js renders it. */
const mark = (date, open, closedDay) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":${open},"waiting":1,"ready":2,"inFlight":0,"inbox":3,"backlog":0},"closedDay":${closedDay},"repos":{"owner/repo":{"open":${open}}}} -->`;

/** A published brief: a digest, the news cursor, then the stats line. */
const brief = (date, open, closedDay) => ({
  title: `brief: ${date}`,
  body: `HEADLINE: ${date} happened.\n\nIN FLIGHT: nothing.\n\n<!-- cc-news: 2.1.220 -->\n${mark(date, open, closedDay)}\n`,
});

/** A `gh` that answers the Discussions query with `nodes`, newest first. */
const mkExec = (nodes, calls = []) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (cmd !== 'gh') throw new Error(`unexpected command: ${cmd}`);
  return JSON.stringify({ data: { repository: { discussions: { nodes } } } });
};

describe('tower/history: the board over time', () => {
  test('every published brief’s stats line becomes one entry, oldest first', () => {
    const home = mkHome();
    // Newest first is how the board answers; a chart draws the other way.
    const out = briefHistory({
      workflowHome: home,
      exec: mkExec([brief('2026-08-03', 12, 4), brief('2026-08-02', 14, 1), brief('2026-08-01', 15, 0)]),
    });
    expect(out.map((entry) => entry.date).join(','), 'ascending by date').toBe('2026-08-01,2026-08-02,2026-08-03');
    expect(out[0].totals.open, 'the totals ride').toBe(15);
    expect(out[2].closedDay, 'and what each day closed').toBe(4);
    expect(out[2].repos['owner/repo'].open, 'and the per-repo counts').toBe(12);
    cleanup(home);
  });

  test('a summary is not a brief, and a brief without the block is skipped', () => {
    const home = mkHome();
    const out = briefHistory({
      workflowHome: home,
      exec: mkExec([
        { title: 'daily: 2026-08-03', body: `what yesterday produced\n${mark('2026-08-03', 99, 9)}\n` },
        { title: 'brief: 2026-08-02', body: 'HEADLINE: a morning before the block existed.\n' },
        { title: 'brief: 2026-08-01', body: 'HEADLINE: a morning whose line is junk.\n<!-- workkit-stats: {not json} -->\n' },
        brief('2026-07-31', 7, 2),
      ]),
    });
    expect(out.length, 'only the briefs that carry a readable block').toBe(1);
    expect(out[0].date, 'and it is the one that does').toBe('2026-07-31');
    cleanup(home);
  });

  test('the series is capped at five weeks of mornings, keeping the newest', () => {
    const home = mkHome();
    const nodes = [];
    // 50 mornings, newest first, dated backwards from the 50th of a long month.
    for (let i = 0; i < 50; i++) nodes.push(brief(`2026-06-${String(50 - i).padStart(2, '0')}`, i, 1));
    const out = briefHistory({ workflowHome: home, exec: mkExec(nodes) });
    expect(out.length, `${HISTORY_LIMIT} entries at most`).toBe(HISTORY_LIMIT);
    expect(out[out.length - 1].date, 'the newest morning is the last point').toBe('2026-06-50');
    expect(out[0].date, 'and the oldest kept is 35 back, not the oldest published').toBe('2026-06-16');
    cleanup(home);
  });
});

describe('tower/history: nothing to read is never a throw', () => {
  test('a failed read is null; a board with no briefs is an empty series', () => {
    const home = mkHome();
    expect(briefHistory({ workflowHome: home, exec: () => { throw new Error('gh: not authenticated'); } }), 'a read that failed').toBe(null);
    expect(briefHistory({ workflowHome: home, exec: () => 'not json at all' }), 'an answer of another shape').toBe(null);
    expect(briefHistory({ workflowHome: home, exec: mkExec([]) }).length, 'a board with nothing on it has no history yet').toBe(0);

    const noHome = mkHome(null);
    expect(briefHistory({
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }), 'a machine with nowhere to read from never asks').toBe(null);
    cleanup(home); cleanup(noHome);
  });
});

describe('tower/history: why the mornings could not be read', () => {
  test('a spent rate limit rides back as the reason, not as a bare null (#215)', () => {
    const home = mkHome();
    const reset = resetIn(9);
    const out = readDiscussions({ workflowHome: home, exec: mkLimited(reset) });
    expect(out.nodes, 'no mornings arrived').toBe(null);
    expect(out.reason, 'and the read says why, in the sentence the board and the sweep say').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`);
    cleanup(home);
  });

  test('a refused token wears the same 403 and is told apart from a limit', () => {
    const home = mkHome();
    const out = readDiscussions({ workflowHome: home, exec: mkRefused() });
    expect(out.nodes, 'nothing was read').toBe(null);
    expect(out.reason, 'and a new token, not a wait, is what fixes it').toBe('gh not authenticated');
    cleanup(home);
  });

  test('a board that answered carries the mornings and no reason at all', () => {
    const home = mkHome();
    const out = readDiscussions({ workflowHome: home, exec: mkExec([brief('2026-08-03', 12, 4)]) });
    expect(out.nodes.length, 'the morning came back').toBe(1);
    expect(out.reason, 'and nothing went wrong to report').toBe(null);

    const noHome = mkHome(null);
    expect(readDiscussions({
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).reason, 'a machine with no home repo has no board to have failed to read').toBe(null);
    cleanup(home); cleanup(noHome);
  });
});

describe('tower/history: the block itself', () => {
  test('a block missing the fields a chart needs is no block', () => {
    expect(parseStatsMark(''), 'no line at all').toBe(null);
    expect(parseStatsMark('<!-- workkit-stats: {"v":1,"totals":{"open":1}} -->'), 'a point with no day cannot be placed').toBe(null);
    expect(parseStatsMark('<!-- workkit-stats: {"v":1,"date":"2026-08-03"} -->'), 'nor one with no totals').toBe(null);
    const partial = parseStatsMark('<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":1}} -->');
    expect(partial.closedDay, 'a block from before closedDay reads as zero').toBe(0);
    expect(Object.keys(partial.repos).length, 'and its per-repo map is empty rather than absent').toBe(0);
  });

  test('the title prefix is the one the publish writes', () => {
    expect(BRIEF_TITLE_PREFIX, 'the literal jobs/morning/brief-publish.sh titles a brief with').toBe('brief: ');
    const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'jobs', 'morning', 'brief-publish.sh'), 'utf8');
    expect(shell.includes('title="brief: $date"'), 'and the shell still writes exactly that').toBeTruthy();
  });
});

describe('tower/history: whether the cloud brief is still posting', () => {
  // Freshness is arithmetic on the newest entry's date and nothing else.
  const day = (date) => ({ date, totals: { open: 1 }, closedDay: 0, repos: {} });
  const at = (stamp) => new Date(stamp);

  test('today’s morning and yesterday’s are both fresh', () => {
    const now = at('2026-08-19T14:00:00Z');
    expect(briefFreshness([day('2026-08-18'), day('2026-08-19')], now).state, 'this morning posted').toBe('fresh');
    expect(briefFreshness([day('2026-08-18')], now).state, 'and so is yesterday’s - today’s run has not landed yet at every hour of the day').toBe('fresh');
    expect(briefFreshness([day('2026-08-18')], now).date, 'the date rides either way').toBe('2026-08-18');
  });

  test('a morning older than yesterday is stale, and says which one it was', () => {
    const out = briefFreshness([day('2026-08-09'), day('2026-08-17')], at('2026-08-19T09:05:00Z'));
    expect(out.state, 'two whole days is a brief that stopped running').toBe('stale');
    expect(out.date, 'the newest entry, not the oldest').toBe('2026-08-17');
  });

  test('calendar days, not 24-hour windows', () => {
    // A brief posted at 09:00 and read at 09:05 the next morning is one day
    // old, not 24 hours and five minutes - the post happens once a day.
    expect(briefFreshness([day('2026-08-18')], at('2026-08-19T00:01:00Z')).state, 'a minute past midnight, yesterday still counts').toBe('fresh');
    expect(briefFreshness([day('2026-08-17')], at('2026-08-19T23:59:00Z')).state, 'and the day before yesterday never does').toBe('stale');
  });

  test('never published and unreadable are not each other, and neither is stale', () => {
    const now = at('2026-08-19T09:00:00Z');
    expect(briefFreshness([], now).state, 'a home repo that has published no brief yet').toBe('never');
    expect(briefFreshness([], now).date, 'with no date to name').toBe(null);
    expect(briefFreshness(null, now).state, 'a read that failed says so - it is not a quiet morning').toBe('unreadable');
    expect(briefFreshness(undefined, now).state, 'and neither is a payload that carries no history at all').toBe('unreadable');
    // A date the arithmetic cannot place is a date nothing can be judged
    // against; fresh and stale would both be guesses.
    expect(briefFreshness([{ date: 'the ninth of never', totals: {} }], now).state, 'nor is an unplaceable date').toBe('unreadable');
  });

  test('the freshness is arithmetic on the read, never a second one', () => {
    const home = mkHome();
    const calls = [];
    const out = briefHistory({ workflowHome: home, exec: mkExec([brief('2026-08-03', 12, 4)], calls) });
    briefFreshness(out, at('2026-08-19T09:00:00Z'));
    expect(calls.length, 'the history read is the only round trip there is').toBe(1);
    expect(calls[0].join(' ').includes('body'), 'and it asks for the body the stats line lives in').toBeTruthy();
    cleanup(home);
  });
});
