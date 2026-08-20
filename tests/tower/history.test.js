//
// Tests for tower/api/lib/history.js - the published briefs, read back.
//
// The `gh` call is the module's one seam, so every case here is a fake exec
// answering the Discussions query with a board of published briefs. Nothing
// reaches GitHub, and the scratch ~/.workkit is what names the home repo.
//
// The bodies are written the way a published brief actually reads: a digest,
// then the two appended lines. The parse has to find its own among them.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const {
  briefHistory, briefFreshness, parseStatsMark, HISTORY_LIMIT, BRIEF_TITLE_PREFIX,
} = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-history-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A scratch ~/.workkit naming a home repo - or naming none. */
const mkHome = (repo = 'owner/private-home') => {
  const dir = mkTmp();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
  );
  return dir;
};

/** The line a morning publishes, as jobs/stats.js renders it. */
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

const run = async () => {
  group('tower/history: the board over time');

  await test('every published brief’s stats line becomes one entry, oldest first', () => {
    const home = mkHome();
    // Newest first is how the board answers; a chart draws the other way.
    const out = briefHistory({
      workflowHome: home,
      exec: mkExec([brief('2026-08-03', 12, 4), brief('2026-08-02', 14, 1), brief('2026-08-01', 15, 0)]),
    });
    assertEq(out.map((entry) => entry.date).join(','), '2026-08-01,2026-08-02,2026-08-03', 'ascending by date');
    assertEq(out[0].totals.open, 15, 'the totals ride');
    assertEq(out[2].closedDay, 4, 'and what each day closed');
    assertEq(out[2].repos['owner/repo'].open, 12, 'and the per-repo counts');
    cleanup(home);
  });

  await test('a summary is not a brief, and a brief without the block is skipped', () => {
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
    assertEq(out.length, 1, 'only the briefs that carry a readable block');
    assertEq(out[0].date, '2026-07-31', 'and it is the one that does');
    cleanup(home);
  });

  await test('the series is capped at five weeks of mornings, keeping the newest', () => {
    const home = mkHome();
    const nodes = [];
    // 50 mornings, newest first, dated backwards from the 50th of a long month.
    for (let i = 0; i < 50; i++) nodes.push(brief(`2026-06-${String(50 - i).padStart(2, '0')}`, i, 1));
    const out = briefHistory({ workflowHome: home, exec: mkExec(nodes) });
    assertEq(out.length, HISTORY_LIMIT, `${HISTORY_LIMIT} entries at most`);
    assertEq(out[out.length - 1].date, '2026-06-50', 'the newest morning is the last point');
    assertEq(out[0].date, '2026-06-16', 'and the oldest kept is 35 back, not the oldest published');
    cleanup(home);
  });

  await test('the read asks the home repo the settings name', () => {
    const home = mkHome('owner/other-home');
    const calls = [];
    briefHistory({ workflowHome: home, exec: mkExec([], calls) });
    assertEq(calls.length, 1, 'one round trip');
    const argv = calls[0].join(' ');
    assert(argv.includes('owner=owner') && argv.includes('name=other-home'), `the home repo: ${argv}`);
    assert(argv.includes('body'), 'and it asks for the body the line lives in');
    cleanup(home);
  });

  group('tower/history: nothing to read is never a throw');

  await test('a failed read is null; a board with no briefs is an empty series', () => {
    const home = mkHome();
    assertEq(briefHistory({ workflowHome: home, exec: () => { throw new Error('gh: not authenticated'); } }), null, 'a read that failed');
    assertEq(briefHistory({ workflowHome: home, exec: () => 'not json at all' }), null, 'an answer of another shape');
    assertEq(briefHistory({ workflowHome: home, exec: mkExec([]) }).length, 0, 'a board with nothing on it has no history yet');

    const noHome = mkHome(null);
    assertEq(briefHistory({
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }), null, 'a machine with nowhere to read from never asks');
    cleanup(home); cleanup(noHome);
  });

  group('tower/history: the block itself');

  await test('a block missing the fields a chart needs is no block', () => {
    assertEq(parseStatsMark(''), null, 'no line at all');
    assertEq(parseStatsMark('<!-- workkit-stats: {"v":1,"totals":{"open":1}} -->'), null, 'a point with no day cannot be placed');
    assertEq(parseStatsMark('<!-- workkit-stats: {"v":1,"date":"2026-08-03"} -->'), null, 'nor one with no totals');
    const partial = parseStatsMark('<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":1}} -->');
    assertEq(partial.closedDay, 0, 'a block from before closedDay reads as zero');
    assertEq(Object.keys(partial.repos).length, 0, 'and its per-repo map is empty rather than absent');
  });

  await test('the title prefix is the one the publish writes', () => {
    assertEq(BRIEF_TITLE_PREFIX, 'brief: ', 'the literal jobs/brief-publish.sh titles a brief with');
    const shell = fs.readFileSync(path.join(__dirname, '..', '..', 'jobs', 'brief-publish.sh'), 'utf8');
    assert(shell.includes('title="brief: $date"'), 'and the shell still writes exactly that');
  });

  group('tower/history: whether the cloud brief is still posting');

  // Issue #172: the brief failed every morning for ten days and the dashboard
  // looked normal the whole time. The answer was already in the read above -
  // the newest entry's date - so this is arithmetic on it and nothing else.
  const day = (date) => ({ date, totals: { open: 1 }, closedDay: 0, repos: {} });
  const at = (stamp) => new Date(stamp);

  await test('today’s morning and yesterday’s are both fresh', () => {
    const now = at('2026-08-19T14:00:00Z');
    assertEq(briefFreshness([day('2026-08-18'), day('2026-08-19')], now).state, 'fresh', 'this morning posted');
    assertEq(briefFreshness([day('2026-08-18')], now).state, 'fresh',
      'and so is yesterday’s - today’s run has not landed yet at every hour of the day');
    assertEq(briefFreshness([day('2026-08-18')], now).date, '2026-08-18', 'the date rides either way');
  });

  await test('a morning older than yesterday is stale, and says which one it was', () => {
    const out = briefFreshness([day('2026-08-09'), day('2026-08-17')], at('2026-08-19T09:05:00Z'));
    assertEq(out.state, 'stale', 'two whole days is a brief that stopped running');
    assertEq(out.date, '2026-08-17', 'the newest entry, not the oldest');
  });

  await test('calendar days, not 24-hour windows', () => {
    // A brief posted at 09:00 and read at 09:05 the next morning is one day
    // old, not 24 hours and five minutes - the post happens once a day.
    assertEq(briefFreshness([day('2026-08-18')], at('2026-08-19T00:01:00Z')).state, 'fresh', 'a minute past midnight, yesterday still counts');
    assertEq(briefFreshness([day('2026-08-17')], at('2026-08-19T23:59:00Z')).state, 'stale', 'and the day before yesterday never does');
  });

  await test('never published and unreadable are not each other, and neither is stale', () => {
    const now = at('2026-08-19T09:00:00Z');
    assertEq(briefFreshness([], now).state, 'never', 'a home repo that has published no brief yet');
    assertEq(briefFreshness([], now).date, null, 'with no date to name');
    assertEq(briefFreshness(null, now).state, 'unreadable', 'a read that failed says so - it is not a quiet morning');
    assertEq(briefFreshness(undefined, now).state, 'unreadable', 'and neither is a payload that carries no history at all');
    // A date the arithmetic cannot place is a date nothing can be judged
    // against; fresh and stale would both be guesses.
    assertEq(briefFreshness([{ date: 'the ninth of never', totals: {} }], now).state, 'unreadable', 'nor is an unplaceable date');
  });

  await test('the freshness is arithmetic on the read, never a second one', () => {
    const home = mkHome();
    const calls = [];
    const out = briefHistory({ workflowHome: home, exec: mkExec([brief('2026-08-03', 12, 4)], calls) });
    briefFreshness(out, at('2026-08-19T09:00:00Z'));
    assertEq(calls.length, 1, 'the history read is the only round trip there is');
    cleanup(home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
