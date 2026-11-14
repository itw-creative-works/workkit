//
// Tests for tower/api/lib/brief.js, the daily brief: pure assembly, so the fixtures
// are the other libs' shapes verbatim, and the clock is injected.
//

const path = require('path');
const { describe, test, expect } = require('../lib/harness');

const { buildBrief, headlineFor } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'brief.js'));

const STAMP = '2026-07-27T16:00:00.000Z';

const issue = (number, over = {}) => ({
  repo: 'owner/repo',
  number,
  title: `issue ${number}`,
  url: `https://github.com/owner/repo/issues/${number}`,
  updatedAt: '2026-07-20T00:00:00Z',
  status: null,
  type: 'enhancement',
  priority: null,
  agentOk: false,
  agentClaimed: false,
  assignees: [],
  ...over,
});

const boardOf = (issues) => ({ ok: true, issues, repos: [] });

const ROSTER = [
  { name: 'workkit', path: '/repos/workkit', slug: 'owner/workkit' },
  { name: 'local-only', path: '/repos/local-only', slug: null },
];

describe('tower/brief: the six sections', () => {
  test('blocked issues are what is waiting on you; every specced issue is ready', () => {
    const board = boardOf([
      issue(1, { status: 'blocked' }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'specced', assignees: ['alice'] }),
      issue(4, { status: 'inbox' }),
      issue(5, { status: 'backlog' }),
      issue(6, { status: 'qa' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);

    expect(out.waiting.length, 'one decision is waiting').toBe(1);
    expect(out.waiting[0].number, 'the blocked one').toBe(1);
    // The status label is the whole answer: a claimed spec is a transient the
    // standards sweep flips to building, not a second in-flight shape.
    expect(out.ready.map((i) => i.number).sort().join(','), 'both specced issues are ready').toBe('2,3');
    expect(out.inFlight.length, 'nothing carries the label that says work started').toBe(0);
    expect(out.inbox.length, 'the inbox is its own section').toBe(1);
    // qa is built work waiting on the owner: the same kind of fact as `waiting`
    // and the opposite of "somebody is on it".
    expect(out.qa.map((i) => i.number).join(','), 'a built item waiting on a check is its own section').toBe('6');
    expect(out.counts.qa, 'and its own count').toBe(1);
    expect(out.counts.backlog, 'backlog is counted but not listed - it is nobody’s morning').toBe(1);
    expect(out.complete.length, 'and nothing has passed its check yet').toBe(0);
    expect(out.generatedAt, 'the stamp is the one passed in').toBe(STAMP);
  });

  // The stage above qa: the check passed, so the item waits on the ship and
  // nothing else, and the ship itself reads from this section.
  test('a QA-passed issue is its own section - finished work waiting on the ship', () => {
    const board = boardOf([
      issue(1, { status: 'qa' }),
      issue(2, { status: 'complete' }),
      issue(3, { status: 'complete', priority: 'high' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.complete.map((i) => i.number).join(','), 'both, in the urgency order every section uses').toBe('3,2');
    expect(out.counts.complete, 'and its own count').toBe(2);
    expect(out.qa.map((i) => i.number).join(','), 'the item still waiting on its check stays where it is').toBe('1');
    expect(out.ready.length + out.inFlight.length + out.inbox.length, 'and it is in no other section').toBe(0);
    expect(/2 issues are QA-passed and ready to ship/.test(out.headline),
      `the morning leads with them over the check still to give, got: ${out.headline}`).toBeTruthy();
  });

  test('a building issue is in flight on its label alone, claimed or not', () => {
    const board = boardOf([
      issue(1, { status: 'building', assignees: ['alice'] }),
      issue(2, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.inFlight.map((i) => i.number).sort().join(','), 'the label is what says work has started - the assignee only says who holds it').toBe('1,2');
    expect(out.counts.inFlight, 'and the count the headline reads agrees').toBe(2);
    expect(out.ready.length, 'work already started is never offered as ready').toBe(0);
    expect(/2 issues are in flight/.test(out.headline), `the morning leads with them, got: ${out.headline}`).toBeTruthy();
  });

  test('a claim of any kind is not a status - the label alone sorts the issue', () => {
    // Neither an assignee nor an agent's claim marker moves an issue out of the
    // ready queue: started work carries `status:building`, which the claim sets
    // and the standards sweep heals to.
    const board = boardOf([
      issue(7, { status: 'specced', agentClaimed: true }),
      issue(8, { status: 'building', agentClaimed: true }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.ready.map((i) => i.number).join(','), 'the spec is still a spec').toBe('7');
    expect(out.inFlight.map((i) => i.number).join(','), 'and only the label says otherwise').toBe('8');
  });

  test('the claim label reaches every list the brief draws a row from', () => {
    // The page draws the claim glyph from agentClaimed, so each row keeps it
    // as the board projected it; an assignee alone is no claim.
    const board = boardOf([
      issue(7, { status: 'specced', agentClaimed: true }),
      issue(8, { status: 'building', agentClaimed: true }),
      issue(9, { status: 'specced', assignees: ['alice'] }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    const ready = Object.fromEntries(out.ready.map((i) => [i.number, i]));
    expect(ready[7].agentClaimed, 'a claimed spec in the ready list carries the claim').toBe(true);
    expect(ready[9].agentClaimed, 'an assigned one carries none').toBe(false);
    expect(out.inFlight[0].agentClaimed, 'and so does a building issue in flight').toBe(true);
    const next = Object.fromEntries(out.nextUp[0].items.map((i) => [i.number, i]));
    expect(next[7].agentClaimed, 'the next-up item keeps the claim too').toBe(true);
    expect(next[9].agentClaimed, 'and an assigned one keeps none').toBe(false);
  });

  test('high priority leads, then the issue that has waited longest', () => {
    const board = boardOf([
      issue(1, { status: 'specced', updatedAt: '2026-07-26T00:00:00Z' }),
      issue(2, { status: 'specced', updatedAt: '2026-07-01T00:00:00Z' }),
      issue(3, { status: 'specced', priority: 'high', updatedAt: '2026-07-27T00:00:00Z' }),
      issue(4, { status: 'specced', priority: 'low', updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.ready.map((i) => i.number).join(','), 'high, then oldest first, low last').toBe('3,2,1,4');
  });
});

describe('tower/brief: what to work on next', () => {
  test('blocked leads, then specced by priority - three per repo, no more', () => {
    const board = boardOf([
      issue(1, { status: 'specced', priority: 'high' }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'blocked' }),
      issue(4, { status: 'specced', priority: 'low' }),
      issue(5, { status: 'blocked', priority: 'high' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp.length, 'one repo has actionable work').toBe(1);
    expect(out.nextUp[0].repo, 'named by the slug the sweep carried').toBe('owner/repo');
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decisions first, highest priority leading, then the top spec').toBe('5,3,1');
    expect(out.nextUp[0].items[0].status, 'each item says which it is').toBe('blocked');
    expect(out.nextUp[0].items[0].priority, 'and how urgent').toBe('high');
    expect(out.nextUp[0].items[0].url.includes('/issues/5'), 'and links to itself').toBeTruthy();
  });

  test('every repo gets its own short list, in the order its leading item ranks', () => {
    const board = boardOf([
      issue(1, { repo: 'owner/second', status: 'specced' }),
      issue(2, { repo: 'owner/first', status: 'blocked' }),
      issue(3, { repo: 'owner/second', status: 'specced', priority: 'high' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp.map((r) => r.repo).join(','), 'the repo holding a decision comes first').toBe('owner/first,owner/second');
    expect(out.nextUp[1].items.map((i) => i.number).join(','), 'and each list is ranked on its own').toBe('3,1');
  });

  // A qa item is a check the owner gives, the work parked in the tree until then.
  // It ranks under the decisions, since one nobody makes stops everything
  // downstream, and above the specs, since nothing else finishes meanwhile.
  test('a check waiting on the owner ranks under the decisions and above the specs', () => {
    const board = boardOf([
      issue(1, { status: 'specced', priority: 'high' }),
      issue(2, { status: 'qa' }),
      issue(3, { status: 'blocked' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision, then the check, then the spec - even with the spec priority:high').toBe('3,2,1');
    expect(out.nextUp[0].items[1].status, 'and the check says which it is').toBe('qa');
  });

  // A complete item is one act from released (the ship), so it ranks under the
  // decisions, which nothing moves without, and above the check not yet given.
  test('a QA-passed item ranks under the decisions and above the check still to give', () => {
    const board = boardOf([
      issue(1, { status: 'specced', priority: 'high' }),
      issue(2, { status: 'qa' }),
      issue(3, { status: 'blocked' }),
      issue(4, { status: 'complete' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision, then the ship, then the check - and the spec is off the end of the three').toBe('3,4,2');
    expect(out.nextUp[0].items[1].status, 'and the ready-to-ship item says which it is').toBe('complete');
  });

  test('a repo with nothing actionable is left out, never listed empty', () => {
    const board = boardOf([
      issue(1, { status: 'building' }),
      issue(2, { status: 'inbox' }),
      issue(3, { status: 'backlog' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp.length, 'work in flight is already somebody’s, and an inbox item is not a decision').toBe(0);
  });
});

describe('tower/brief: what a morning waits on', () => {
  // A dependency is advisory: it changes no label, but it changes the order a
  // morning reads a repo in, and the item says what it waits for. Only a blocker
  // the open-board sweep can see counts; an edge outside it is left to the graph.

  const blockedByOf = (...keys) => ({
    blockedBy: keys.map((key) => ({ repo: key.split('#')[0], number: Number(key.split('#')[1]) })),
  });

  test('an issue waiting on an open one orders after everything unblocked in its repo', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', priority: 'high', ...blockedByOf('owner/repo#9') }),
      issue(2, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the decision would have led, but nothing can move it until #9 does').toBe('2,1');
    expect(out.nextUp[0].items[1].waitsOn.join(','), 'and it says what it waits for').toBe('owner/repo#9');
    expect(out.nextUp[0].items[0].waitsOn.length, 'an unblocked item waits on nothing, never undefined').toBe(0);
  });

  test('a blocker is matched on the repo and the number together, never the number alone', () => {
    const board = boardOf([
      issue(1, { status: 'specced', ...blockedByOf('owner/other#9') }),
      issue(2, { status: 'specced', ...blockedByOf('owner/elsewhere#9') }),
      issue(9, { repo: 'owner/other', status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    const items = out.nextUp.find((entry) => entry.repo === 'owner/repo').items;
    expect(items.map((i) => i.number).join(','), 'the one whose blocker is really open is demoted').toBe('2,1');
    expect(items[1].waitsOn.join(','), 'named across repos, the way the board keys an issue').toBe('owner/other#9');
    expect(items[0].waitsOn.length, 'and owner/elsewhere#9 is a different issue from owner/other#9').toBe(0);
  });

  test('a blocker spelled in another case still counts - repo names are case-insensitive', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', ...blockedByOf('OWNER/Repo#9') }),
      issue(2, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the hand-typed spelling is the same issue').toBe('2,1');
    expect(out.nextUp[0].items[1].waitsOn.join(','), 'and waitsOn answers in the sweep’s spelling, not the hand-typed one').toBe('owner/repo#9');
  });

  test('an edge pointing outside the sweep neither demotes nor is listed', () => {
    // A closed issue and a repo this token cannot read look identical from
    // here, so the edge says nothing rather than something invented.
    const board = boardOf([
      issue(1, { status: 'specced', ...blockedByOf('Omega-JS-Stack/omega#144') }),
      issue(2, { status: 'specced' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the order the board gave them').toBe('1,2');
    expect(out.nextUp[0].items[0].waitsOn.length, 'and nothing is claimed about an unknown edge').toBe(0);
  });

  test('the three a repo offers are the three that can move - a waiting item gives up its place', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', ...blockedByOf('owner/repo#9') }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'specced' }),
      issue(4, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.nextUp[0].items.map((i) => i.number).join(','), 'the cap is applied after the ordering, so the item held back is the blocked one').toBe('2,3,4');
  });
});

describe('tower/brief: warnings', () => {
  test('a repo with work on the table is named by slug and sorted by weight', () => {
    const health = {
      '/repos/workkit': { unpushed: 1, uncommitted: 2, unreleasedEntries: 3, lastTag: 'v1.0.0', error: null },
      '/repos/local-only': { unpushed: 0, uncommitted: 0, unreleasedEntries: 9, lastTag: null, error: null },
    };
    const out = buildBrief(boardOf([]), health, ROSTER, STAMP);
    expect(out.warnings.length, 'both repos have something sitting').toBe(2);
    expect(out.warnings[0].repo, 'the heaviest leads (9 beats 6)').toBe('local-only');
    expect(out.warnings[1].repo, 'and a repo with a slug is named by it').toBe('owner/workkit');
    expect(out.warnings[1].unreleased, 'the CHANGELOG entries carry through').toBe(3);
  });

  test('a clean repo and an unreadable one both stay out of the warnings', () => {
    const health = {
      '/repos/workkit': { unpushed: 0, uncommitted: 0, unreleasedEntries: 0, lastTag: 'v1.0.0', error: null },
      '/repos/local-only': { unpushed: null, uncommitted: null, unreleasedEntries: 0, lastTag: null, error: 'not a git repo' },
    };
    const out = buildBrief(boardOf([]), health, ROSTER, STAMP);
    expect(out.warnings.length, 'nothing to say is better than something to ignore').toBe(0);
  });
});

describe('tower/brief: what the sweep counted, per repo', () => {
  // The payload carries the sweep's per-repo counts and the day's roster-wide
  // closed total: the morning's stats line is composed from it, and a chart
  // drawn a month later reads that line.

  test('the closed count is summed across the roster, and each repo keeps its own', () => {
    const board = {
      ok: true,
      issues: [issue(1, { status: 'blocked' })],
      repos: [
        { slug: 'owner/workkit', count: 1, totalCount: 1, truncated: false, closedDay: 3, error: null },
        { slug: 'owner/other', count: 0, totalCount: 0, truncated: false, closedDay: 2, error: null },
      ],
    };
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.closedDay, 'three and two closed yesterday').toBe(5);
    expect(out.repoCounts.length, 'one entry per repo the sweep answered for').toBe(2);
    expect(out.repoCounts[0].slug, 'named by slug, the way the stats line keys them').toBe('owner/workkit');
    expect(out.repoCounts[0].closedDay, 'each repo keeps its own count').toBe(3);
  });

  test('a repo the sweep could not read contributes no counts at all', () => {
    // A one-morning token hiccup on one repo must not publish that repo as
    // "0 open" - the stats line is the only store, so the false zero would be
    // a permanent dip in its series. The unread repo is absent instead.
    const board = {
      ok: true,
      issues: [],
      repos: [
        { slug: 'owner/workkit', count: 2, totalCount: 2, truncated: false, closedDay: 3, error: null },
        { slug: 'owner/unread', count: 0, totalCount: 0, truncated: false, closedDay: 0, error: 'Could not resolve to a Repository' },
      ],
    };
    const out = buildBrief(board, {}, ROSTER, STAMP);
    expect(out.repoCounts.length, 'only the repo the sweep answered for').toBe(1);
    expect(out.repoCounts[0].slug, 'the readable one').toBe('owner/workkit');
    expect(out.closedDay, 'and the sum is over what was actually read').toBe(3);
  });

  test('a repo over the page cap is still that many issues open', () => {
    const board = {
      ok: true,
      issues: [],
      repos: [{ slug: 'owner/workkit', count: 100, totalCount: 137, truncated: true, closedDay: 0, error: null }],
    };
    expect(buildBrief(board, {}, ROSTER, STAMP).repoCounts[0].open, 'the open count is the totalCount - a series that dipped at the cap would be a lie about the day').toBe(137);
  });

  test('a sweep that carries no counts at all reads as zero, never undefined', () => {
    const out = buildBrief(boardOf([]), {}, ROSTER, STAMP);
    expect(out.closedDay, 'nothing closed').toBe(0);
    expect(out.repoCounts.length, 'and no repo entries to draw').toBe(0);
    const older = buildBrief({ ok: true, issues: [], repos: [{ slug: 'owner/workkit', count: 2 }] }, {}, ROSTER, STAMP);
    expect(older.repoCounts[0].open, 'a repo entry without a totalCount falls back to what it returned').toBe(2);
    expect(older.repoCounts[0].closedDay, 'and one without a closed count closed nothing').toBe(0);
  });
});

describe('tower/brief: the headline and the failed sweep', () => {
  test('the headline names the most consequential fact, in order', () => {
    expect(/waiting on a decision/.test(headlineFor({ waiting: 2, complete: 1, qa: 4, inFlight: 5, ready: 3, inbox: 1 })), 'a decision leads').toBeTruthy();
    expect(/QA-passed and ready to ship/.test(headlineFor({ waiting: 0, complete: 1, qa: 4, inFlight: 5, ready: 3, inbox: 1 })),
      'then work that is finished and simply not out (#196)').toBeTruthy();
    expect(/waiting on your check/.test(headlineFor({ waiting: 0, complete: 0, qa: 4, inFlight: 5, ready: 3, inbox: 1 })), 'then the checks the owner owes').toBeTruthy();
    expect(/in flight/.test(headlineFor({ waiting: 0, inFlight: 1, ready: 3, inbox: 1 })), 'then what is running').toBeTruthy();
    expect(/ready to start/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 3, inbox: 1 })), 'then what may be started').toBeTruthy();
    expect(/inbox/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 0, inbox: 4 })), 'then the inbox').toBeTruthy();
    expect(/empty/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 0, inbox: 0 })), 'and an empty board says so').toBeTruthy();
  });

  test('one issue reads as singular, two as plural', () => {
    expect(/1 issue is waiting/.test(headlineFor({ waiting: 1 })), 'singular').toBeTruthy();
    expect(/2 issues are waiting/.test(headlineFor({ waiting: 2 })), 'plural').toBeTruthy();
  });

  test('a failed sweep is reported as a failure, never as a quiet morning', () => {
    const out = buildBrief({ ok: false, reason: 'gh is not authenticated', issues: [] }, {}, ROSTER, STAMP);
    expect(out.ok, 'the brief is not ok').toBe(false);
    expect(out.reason, 'and says why').toBe('gh is not authenticated');
    expect(out.counts.open, 'with no invented work').toBe(0);
  });

  test('missing arguments degrade to an empty brief rather than throwing', () => {
    const out = buildBrief(null, null, null, STAMP);
    expect(out.ok, 'no board is not an ok brief').toBe(false);
    expect(out.waiting.length, 'nothing waiting').toBe(0);
    expect(out.warnings.length, 'nothing on the table').toBe(0);
    expect(typeof out.headline === 'string' && out.headline.length > 0, 'and still a sentence to print').toBeTruthy();
  });
});
