//
// Tests for tower/api/lib/summaries.js, the published summaries read back through
// a fake `gh` and a scratch ~/.workkit; the clock is injected, so a Monday is stated.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { resetIn, clockAt, mkLimited, mkRefused } = require('../lib/gh');

const { briefSummaries, newestSummary, isMonday } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'summaries.js'));

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A scratch ~/.workkit naming a home repo - or naming none. */
const mkHome = (repo = 'owner/private-home') => {
  const dir = mkTmp('tower-summaries-');
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

describe('tower/summaries: the newest of a cadence', () => {
  test('the newest daily and the newest weekly are read off one board', () => {
    const home = mkHome();
    const daily = newestSummary('daily', { workflowHome: home, exec: mkExec(BOARD) }).summary;
    expect(daily.title, 'the newest daily, not the newest post').toBe('daily: 2026-08-02');
    expect(daily.url.startsWith('https://github.com/'), `and its link: ${daily.url}`).toBeTruthy();
    expect(daily.createdAt, 'and when it was published').toBe('2026-08-02T09:00:00Z');

    const weekly = newestSummary('weekly', { workflowHome: home, exec: mkExec(BOARD) }).summary;
    expect(weekly.title, 'the rollup is found by its own prefix').toBe('weekly: 2026-08-02');
    cleanup(home);
  });

  test('the title is what says what a post is - a brief is never a summary', () => {
    // The board is shared: the morning brief publishes beside the summaries, and
    // the category a summary lands in falls back on a repo that has no `Daily`.
    const home = mkHome();
    const out = newestSummary('daily', {
      workflowHome: home,
      exec: mkExec([post('brief: 2026-08-03', '2026-08-03'), post('a thread somebody opened', '2026-08-02')]),
    });
    expect(out.summary, 'nothing on that board is a daily summary').toBe(null);
    expect(out.reason, 'and nothing went wrong reading it').toBe(null);
    cleanup(home);
  });

  test('the read asks the home repo the settings name', () => {
    const home = mkHome('owner/other-home');
    const calls = [];
    newestSummary('daily', { workflowHome: home, exec: mkExec(BOARD, calls) });
    expect(calls.length, 'one round trip').toBe(1);
    const argv = calls[0].join(' ');
    expect(argv.includes('owner=owner'), `the owner: ${argv}`).toBeTruthy();
    expect(argv.includes('name=other-home'), `and the repo: ${argv}`).toBeTruthy();
    cleanup(home);
  });
});

describe('tower/summaries: nothing to say is never a throw', () => {
  test('an empty board, a machine with no home repo, and a gh that refuses all answer no summary', () => {
    const home = mkHome();
    expect(newestSummary('daily', { workflowHome: home, exec: mkExec([]) }).summary, 'a board with nothing on it').toBe(null);
    expect(newestSummary('daily', {
      workflowHome: home,
      exec: () => { throw new Error('gh: not authenticated'); },
    }).summary, 'a read that failed').toBe(null);
    expect(newestSummary('daily', { workflowHome: home, exec: () => 'not json at all' }).summary, 'an answer of another shape').toBe(null);

    const noHome = mkHome(null);
    expect(newestSummary('daily', {
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summary, 'a machine with nowhere to read from never asks').toBe(null);
    cleanup(home); cleanup(noHome);
  });

  test('a cadence nobody publishes is no summary without a round trip', () => {
    const home = mkHome();
    expect(newestSummary('yearly', {
      workflowHome: home,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summary, 'there is no such summary to look for').toBe(null);
    cleanup(home);
  });
});

describe('tower/summaries: the keys a brief carries', () => {
  test('every morning carries the findings; only Monday carries the week', () => {
    const home = mkHome();
    const monday = briefSummaries({ generatedAt: MONDAY, workflowHome: home, exec: mkExec(BOARD) });
    expect(monday.findings.title, 'yesterday, every day').toBe('daily: 2026-08-02');
    expect(monday.week.title, 'and the rollup on a Monday').toBe('weekly: 2026-08-02');

    const tuesday = briefSummaries({ generatedAt: TUESDAY, workflowHome: home, exec: mkExec(BOARD) });
    expect(tuesday.findings.title, 'the findings still ride').toBe('daily: 2026-08-02');
    expect(!('week' in tuesday), 'and the week key is absent entirely, not null').toBeTruthy();
    cleanup(home);
  });

  test('a Monday reads the board ONCE and picks both cadences off it (#250)', () => {
    // Two reads of one board are two answers to the same question, and the
    // second one costs a round trip on the one morning of the week that is
    // already the busiest. Both summaries are on the array the first read
    // brought back, so Monday asks no more of GitHub than any other day.
    const home = mkHome();
    const calls = [];
    const out = briefSummaries({ generatedAt: MONDAY, workflowHome: home, exec: mkExec(BOARD, calls) });
    expect(calls.length, 'one round trip, on the day that used to take two').toBe(1);
    expect(out.findings.title, 'yesterday, off that read').toBe('daily: 2026-08-02');
    expect(out.week.title, 'and the rollup, off the same one').toBe('weekly: 2026-08-02');
    expect(out.summariesReason, 'and a board that answered has nothing to explain').toBe(null);
    cleanup(home);
  });

  test('an unreachable board still answers the keys, empty', () => {
    const home = mkHome();
    const out = briefSummaries({
      generatedAt: MONDAY,
      workflowHome: home,
      exec: () => { throw new Error('offline'); },
    });
    expect(out.findings, 'nothing to say about yesterday').toBe(null);
    expect(out.week, 'nor about the week').toBe(null);
    cleanup(home);
  });
});

describe('tower/summaries: why the board could not be read', () => {
  test('a spent rate limit is the sentence the sweep says, not a bare null (#215)', () => {
    const home = mkHome();
    const reset = resetIn(9);
    const out = newestSummary('daily', { workflowHome: home, exec: mkLimited(reset) });
    expect(out.summary, 'there is nothing to say about yesterday').toBe(null);
    expect(out.reason, 'and the reason is the board\u2019s own sentence, said when it lifts').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`);
    cleanup(home);
  });

  test('a refused token wears the same 403 and is told apart from a limit', () => {
    const home = mkHome();
    const out = newestSummary('daily', { workflowHome: home, exec: mkRefused() });
    expect(out.summary, 'nothing was read').toBe(null);
    expect(out.reason, 'and a new token, not a wait, is what fixes it').toBe('gh not authenticated');
    cleanup(home);
  });

  test('the reason rides the keys a brief carries, both cadences over one board', () => {
    const home = mkHome();
    const reset = resetIn(9);
    const out = briefSummaries({ generatedAt: MONDAY, workflowHome: home, exec: mkLimited(reset) });
    expect(out.findings, 'nothing to say about yesterday').toBe(null);
    expect(out.week, 'nor about the week').toBe(null);
    expect(/rate limit/.test(out.summariesReason), `and the payload carries why: ${out.summariesReason}`).toBeTruthy();
    cleanup(home);
  });

  test('a board that answered carries no reason at all', () => {
    const home = mkHome();
    const out = briefSummaries({ generatedAt: TUESDAY, workflowHome: home, exec: mkExec(BOARD) });
    expect(out.findings.title, 'the summary is what it always was').toBe('daily: 2026-08-02');
    expect(out.summariesReason, 'and nothing went wrong to report').toBe(null);

    const noHome = mkHome(null);
    expect(briefSummaries({
      generatedAt: TUESDAY,
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).summariesReason, 'a machine with no home repo has no board to have failed to read').toBe(null);
    cleanup(home); cleanup(noHome);
  });

  test('Monday is read in the local morning the stamp belongs to', () => {
    expect(isMonday(MONDAY), '2026-08-03 is a Monday').toBeTruthy();
    expect(!isMonday(TUESDAY), 'the day after is not').toBeTruthy();
    expect(!isMonday('not a date'), 'and an unparseable stamp is no day at all').toBeTruthy();
  });
});
