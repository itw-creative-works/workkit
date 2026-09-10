//
// Tests for tower/api/lib/summaries.js - the published summaries, read back.
//
// The `gh` call is the module's one seam, so every case here is a fake exec
// answering the GraphQL query with a board of Discussions. Nothing reaches
// GitHub, and the scratch ~/.workkit is what names the home repo - the real one
// is never read.
//
// The clock is injected the same way the brief's is: a Monday is a date this
// suite states, never one it waits for.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { resetIn, clockAt, mkLimited, mkRefused } = require('../lib/gh');

const { briefSummaries, newestSummary, isMonday } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'summaries.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-summaries-'));
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

const post = (title, day) => ({
  title,
  url: `https://github.com/owner/private-home/discussions/${title.replace(/\W+/g, '')}`,
  createdAt: `${day}T09:00:00Z`,
});

/** A `gh` that answers the Discussions query with `nodes`, newest first. */
const mkExec = (nodes, calls = []) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (cmd !== 'gh') throw new Error(`unexpected command: ${cmd}`);
  return JSON.stringify({ data: { repository: { discussions: { nodes } } } });
};

// Local noon, so the weekday is the same one in every timezone this suite could
// run in - an ISO stamp at midnight would be the day before somewhere.
const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
const MONDAY = localNoon(2026, 8, 3);
const TUESDAY = localNoon(2026, 8, 4);

const BOARD = [
  post('brief: 2026-08-03', '2026-08-03'),
  post('daily: 2026-08-02', '2026-08-02'),
  post('weekly: 2026-08-02', '2026-08-02'),
  post('daily: 2026-08-01', '2026-08-01'),
];

const run = async () => {
  group('tower/summaries: the newest of a cadence');

  await test('the newest daily and the newest weekly are read off one board', () => {
    const home = mkHome();
    const daily = newestSummary('daily', { workflowHome: home, exec: mkExec(BOARD) }).summary;
    assertEq(daily.title, 'daily: 2026-08-02', 'the newest daily, not the newest post');
    assert(daily.url.startsWith('https://github.com/'), `and its link: ${daily.url}`);
    assertEq(daily.createdAt, '2026-08-02T09:00:00Z', 'and when it was published');

    const weekly = newestSummary('weekly', { workflowHome: home, exec: mkExec(BOARD) }).summary;
    assertEq(weekly.title, 'weekly: 2026-08-02', 'the rollup is found by its own prefix');
    cleanup(home);
  });

  await test('the title is what says what a post is - a brief is never a summary', () => {
    // The board is shared: the morning brief publishes beside the summaries, and
    // the category a summary lands in falls back on a repo that has no `Daily`.
    const home = mkHome();
    const out = newestSummary('daily', {
      workflowHome: home,
      exec: mkExec([post('brief: 2026-08-03', '2026-08-03'), post('a thread somebody opened', '2026-08-02')]),
    });
    assertEq(out.summary, null, 'nothing on that board is a daily summary');
    assertEq(out.reason, null, 'and nothing went wrong reading it');
    cleanup(home);
  });

  await test('the read asks the home repo the settings name', () => {
    const home = mkHome('owner/other-home');
    const calls = [];
    newestSummary('daily', { workflowHome: home, exec: mkExec(BOARD, calls) });
    assertEq(calls.length, 1, 'one round trip');
    const argv = calls[0].join(' ');
    assert(argv.includes('owner=owner'), `the owner: ${argv}`);
    assert(argv.includes('name=other-home'), `and the repo: ${argv}`);
    cleanup(home);
  });

  group('tower/summaries: nothing to say is never a throw');

  await test('an empty board, a machine with no home repo, and a gh that refuses all answer no summary', () => {
    const home = mkHome();
    assertEq(newestSummary('daily', { workflowHome: home, exec: mkExec([]) }).summary, null, 'a board with nothing on it');
    assertEq(newestSummary('daily', {
      workflowHome: home,
      exec: () => { throw new Error('gh: not authenticated'); },
    }).summary, null, 'a read that failed');
    assertEq(newestSummary('daily', { workflowHome: home, exec: () => 'not json at all' }).summary, null, 'an answer of another shape');

    const noHome = mkHome(null);
    assertEq(newestSummary('daily', {
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summary, null, 'a machine with nowhere to read from never asks');
    cleanup(home); cleanup(noHome);
  });

  await test('a cadence nobody publishes is no summary without a round trip', () => {
    const home = mkHome();
    assertEq(newestSummary('yearly', {
      workflowHome: home,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summary, null, 'there is no such summary to look for');
    cleanup(home);
  });

  group('tower/summaries: the keys a brief carries');

  await test('every morning carries the findings; only Monday carries the week', () => {
    const home = mkHome();
    const monday = briefSummaries({ generatedAt: MONDAY, workflowHome: home, exec: mkExec(BOARD) });
    assertEq(monday.findings.title, 'daily: 2026-08-02', 'yesterday, every day');
    assertEq(monday.week.title, 'weekly: 2026-08-02', 'and the rollup on a Monday');

    const tuesday = briefSummaries({ generatedAt: TUESDAY, workflowHome: home, exec: mkExec(BOARD) });
    assertEq(tuesday.findings.title, 'daily: 2026-08-02', 'the findings still ride');
    assert(!('week' in tuesday), 'and the week key is absent entirely, not null');
    cleanup(home);
  });

  await test('an unreachable board still answers the keys, empty', () => {
    const home = mkHome();
    const out = briefSummaries({
      generatedAt: MONDAY,
      workflowHome: home,
      exec: () => { throw new Error('offline'); },
    });
    assertEq(out.findings, null, 'nothing to say about yesterday');
    assertEq(out.week, null, 'nor about the week');
    cleanup(home);
  });

  group('tower/summaries: why the board could not be read');

  await test('a spent rate limit is the sentence the sweep says, not a bare null (#215)', () => {
    const home = mkHome();
    const reset = resetIn(9);
    const out = newestSummary('daily', { workflowHome: home, exec: mkLimited(reset) });
    assertEq(out.summary, null, 'there is nothing to say about yesterday');
    assertEq(out.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`,
      'and the reason is the board\u2019s own sentence, said when it lifts');
    cleanup(home);
  });

  await test('a refused token wears the same 403 and is told apart from a limit', () => {
    const home = mkHome();
    const out = newestSummary('daily', { workflowHome: home, exec: mkRefused() });
    assertEq(out.summary, null, 'nothing was read');
    assertEq(out.reason, 'gh not authenticated', 'and a new token, not a wait, is what fixes it');
    cleanup(home);
  });

  await test('the reason rides the keys a brief carries, both cadences over one board', () => {
    const home = mkHome();
    const reset = resetIn(9);
    const out = briefSummaries({ generatedAt: MONDAY, workflowHome: home, exec: mkLimited(reset) });
    assertEq(out.findings, null, 'nothing to say about yesterday');
    assertEq(out.week, null, 'nor about the week');
    assert(/rate limit/.test(out.summariesReason), `and the payload carries why: ${out.summariesReason}`);
    cleanup(home);
  });

  await test('a board that answered carries no reason at all', () => {
    const home = mkHome();
    const out = briefSummaries({ generatedAt: TUESDAY, workflowHome: home, exec: mkExec(BOARD) });
    assertEq(out.findings.title, 'daily: 2026-08-02', 'the summary is what it always was');
    assertEq(out.summariesReason, null, 'and nothing went wrong to report');

    const noHome = mkHome(null);
    assertEq(briefSummaries({
      generatedAt: TUESDAY,
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summariesReason, null, 'a machine with no home repo has no board to have failed to read');
    cleanup(home); cleanup(noHome);
  });

  await test('the read asks for the headers a limit is only legible in', () => {
    const home = mkHome();
    const calls = [];
    newestSummary('daily', { workflowHome: home, exec: mkExec(BOARD, calls) });
    assert(calls[0].includes('--include'), `the round trip asks for them: ${calls[0].join(' ')}`);
    cleanup(home);
  });

  await test('Monday is read in the local morning the stamp belongs to', () => {
    assert(isMonday(MONDAY), '2026-08-03 is a Monday');
    assert(!isMonday(TUESDAY), 'the day after is not');
    assert(!isMonday('not a date'), 'and an unparseable stamp is no day at all');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
