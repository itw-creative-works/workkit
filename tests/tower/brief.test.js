//
// Tests for tower/api/lib/brief.js - the daily brief.
//
// Pure assembly over the shapes the other libs already produce, so the fixtures
// here are those shapes verbatim: a board sweep as fetchBoard returns it, and a
// health map keyed by repo path as the server builds it. No git, no network.
//
// The clock is injected. A brief that stamped itself would make every assertion
// about `generatedAt` a test of Date.now rather than of this module.
//

const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

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
  agentWorking: false,
  assignees: [],
  ...over,
});

const boardOf = (issues) => ({ ok: true, issues, repos: [] });

const ROSTER = [
  { name: 'workkit', path: '/repos/workkit', slug: 'owner/workkit' },
  { name: 'local-only', path: '/repos/local-only', slug: null },
];

const run = async () => {
  group('tower/brief: the five sections');

  await test('blocked issues are what is waiting on you; every specced issue is ready', () => {
    const board = boardOf([
      issue(1, { status: 'blocked' }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'specced', assignees: ['ianwieds'] }),
      issue(4, { status: 'inbox' }),
      issue(5, { status: 'backlog' }),
      issue(6, { status: 'qa' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);

    assertEq(out.waiting.length, 1, 'one decision is waiting');
    assertEq(out.waiting[0].number, 1, 'the blocked one');
    // Issue #62: an assignee no longer splits the specced queue. The status
    // label is the whole answer, and a claimed spec is a transient the standards
    // sweep flips to building - it is not a second in-flight shape.
    assertEq(out.ready.map((i) => i.number).sort().join(','), '2,3', 'both specced issues are ready');
    assertEq(out.inFlight.length, 0, 'nothing carries the label that says work started');
    assertEq(out.inbox.length, 1, 'the inbox is its own section');
    // Issue #135: qa is built work waiting on the OWNER, which is the same kind
    // of fact as `waiting` and the opposite of "somebody is on it".
    assertEq(out.qa.map((i) => i.number).join(','), '6', 'a built item waiting on a check is its own section');
    assertEq(out.counts.qa, 1, 'and its own count');
    assertEq(out.counts.backlog, 1, 'backlog is counted but not listed - it is nobody’s morning');
    assertEq(out.generatedAt, STAMP, 'the stamp is the one passed in');
  });

  await test('a building issue is in flight on its label alone, claimed or not', () => {
    const board = boardOf([
      issue(1, { status: 'building', assignees: ['ianwieds'] }),
      issue(2, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.inFlight.map((i) => i.number).sort().join(','), '1,2',
      'the label is what says work has started - the assignee only says who holds it');
    assertEq(out.counts.inFlight, 2, 'and the count the headline reads agrees');
    assertEq(out.ready.length, 0, 'work already started is never offered as ready');
    assert(/2 issues are in flight/.test(out.headline), `the morning leads with them, got: ${out.headline}`);
  });

  await test('a claim of any kind is not a status - the label alone sorts the issue', () => {
    // Issue #62: neither an assignee nor an agent's claim marker moves an issue
    // out of the ready queue. Work that has started carries `status:building`,
    // which is what the claim itself sets and what the standards sweep heals to.
    const board = boardOf([
      issue(7, { status: 'specced', agentWorking: true }),
      issue(8, { status: 'building', agentWorking: true }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.ready.map((i) => i.number).join(','), '7', 'the spec is still a spec');
    assertEq(out.inFlight.map((i) => i.number).join(','), '8', 'and only the label says otherwise');
  });

  await test('high priority leads, then the issue that has waited longest', () => {
    const board = boardOf([
      issue(1, { status: 'specced', updatedAt: '2026-07-26T00:00:00Z' }),
      issue(2, { status: 'specced', updatedAt: '2026-07-01T00:00:00Z' }),
      issue(3, { status: 'specced', priority: 'high', updatedAt: '2026-07-27T00:00:00Z' }),
      issue(4, { status: 'specced', priority: 'low', updatedAt: '2026-06-01T00:00:00Z' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.ready.map((i) => i.number).join(','), '3,2,1,4', 'high, then oldest first, low last');
  });

  group('tower/brief: what to work on next');

  await test('blocked leads, then specced by priority - three per repo, no more', () => {
    const board = boardOf([
      issue(1, { status: 'specced', priority: 'high' }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'blocked' }),
      issue(4, { status: 'specced', priority: 'low' }),
      issue(5, { status: 'blocked', priority: 'high' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp.length, 1, 'one repo has actionable work');
    assertEq(out.nextUp[0].repo, 'owner/repo', 'named by the slug the sweep carried');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '5,3,1',
      'the decisions first, highest priority leading, then the top spec');
    assertEq(out.nextUp[0].items[0].status, 'blocked', 'each item says which it is');
    assertEq(out.nextUp[0].items[0].priority, 'high', 'and how urgent');
    assert(out.nextUp[0].items[0].url.includes('/issues/5'), 'and links to itself');
  });

  await test('every repo gets its own short list, in the order its leading item ranks', () => {
    const board = boardOf([
      issue(1, { repo: 'owner/second', status: 'specced' }),
      issue(2, { repo: 'owner/first', status: 'blocked' }),
      issue(3, { repo: 'owner/second', status: 'specced', priority: 'high' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp.map((r) => r.repo).join(','), 'owner/first,owner/second',
      'the repo holding a decision comes first');
    assertEq(out.nextUp[1].items.map((i) => i.number).join(','), '3,1', 'and each list is ranked on its own');
  });

  // Issue #135: a qa item is actionable - it is a check the owner gives, and the
  // work is parked in the tree until they do. It ranks under the decisions,
  // because a decision nobody makes stops everything downstream of it, and above
  // the specs, because nothing else finishes while the tree holds unshipped work.
  await test('a check waiting on the owner ranks under the decisions and above the specs', () => {
    const board = boardOf([
      issue(1, { status: 'specced', priority: 'high' }),
      issue(2, { status: 'qa' }),
      issue(3, { status: 'blocked' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '3,2,1',
      'the decision, then the check, then the spec - even with the spec priority:high');
    assertEq(out.nextUp[0].items[1].status, 'qa', 'and the check says which it is');
  });

  await test('a repo with nothing actionable is left out, never listed empty', () => {
    const board = boardOf([
      issue(1, { status: 'building' }),
      issue(2, { status: 'inbox' }),
      issue(3, { status: 'backlog' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp.length, 0, 'work in flight is already somebody’s, and an inbox item is not a decision');
  });

  group('tower/brief: what a morning waits on');

  // Issue #103: a dependency is advisory - it changes no label - but it does
  // change the ORDER a morning reads a repo in, and the item says what it is
  // waiting for. Only a blocker the sweep can see is still open counts: the
  // sweep is the open board, so an edge pointing outside it says nothing either
  // way and is left to the graph.

  const blockedByOf = (...keys) => ({
    blockedBy: keys.map((key) => ({ repo: key.split('#')[0], number: Number(key.split('#')[1]) })),
  });

  await test('an issue waiting on an open one orders after everything unblocked in its repo', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', priority: 'high', ...blockedByOf('owner/repo#9') }),
      issue(2, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '2,1',
      'the decision would have led, but nothing can move it until #9 does');
    assertEq(out.nextUp[0].items[1].waitsOn.join(','), 'owner/repo#9', 'and it says what it waits for');
    assertEq(out.nextUp[0].items[0].waitsOn.length, 0, 'an unblocked item waits on nothing, never undefined');
  });

  await test('a blocker is matched on the repo and the number together, never the number alone', () => {
    const board = boardOf([
      issue(1, { status: 'specced', ...blockedByOf('owner/other#9') }),
      issue(2, { status: 'specced', ...blockedByOf('owner/elsewhere#9') }),
      issue(9, { repo: 'owner/other', status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    const items = out.nextUp.find((entry) => entry.repo === 'owner/repo').items;
    assertEq(items.map((i) => i.number).join(','), '2,1', 'the one whose blocker is really open is demoted');
    assertEq(items[1].waitsOn.join(','), 'owner/other#9', 'named across repos, the way the board keys an issue');
    assertEq(items[0].waitsOn.length, 0, 'and owner/elsewhere#9 is a different issue from owner/other#9');
  });

  await test('a blocker spelled in another case still counts - repo names are case-insensitive', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', ...blockedByOf('OWNER/Repo#9') }),
      issue(2, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '2,1',
      'the hand-typed spelling is the same issue');
    assertEq(out.nextUp[0].items[1].waitsOn.join(','), 'owner/repo#9',
      'and waitsOn answers in the sweep’s spelling, not the hand-typed one');
  });

  await test('an edge pointing outside the sweep neither demotes nor is listed', () => {
    // A closed issue and a repo this token cannot read look identical from
    // here, so the edge says nothing rather than something invented.
    const board = boardOf([
      issue(1, { status: 'specced', ...blockedByOf('Omega-JS-Stack/omega#144') }),
      issue(2, { status: 'specced' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '1,2', 'the order the board gave them');
    assertEq(out.nextUp[0].items[0].waitsOn.length, 0, 'and nothing is claimed about an unknown edge');
  });

  await test('the three a repo offers are the three that can move - a waiting item gives up its place', () => {
    const board = boardOf([
      issue(1, { status: 'blocked', ...blockedByOf('owner/repo#9') }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'specced' }),
      issue(4, { status: 'specced' }),
      issue(9, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '2,3,4',
      'the cap is applied after the ordering, so the item held back is the blocked one');
  });

  group('tower/brief: warnings');

  await test('a repo with work on the table is named by slug and sorted by weight', () => {
    const health = {
      '/repos/workkit': { unpushed: 1, uncommitted: 2, unreleasedEntries: 3, lastTag: 'v1.0.0', error: null },
      '/repos/local-only': { unpushed: 0, uncommitted: 0, unreleasedEntries: 9, lastTag: null, error: null },
    };
    const out = buildBrief(boardOf([]), health, ROSTER, STAMP);
    assertEq(out.warnings.length, 2, 'both repos have something sitting');
    assertEq(out.warnings[0].repo, 'local-only', 'the heaviest leads (9 beats 6)');
    assertEq(out.warnings[1].repo, 'owner/workkit', 'and a repo with a slug is named by it');
    assertEq(out.warnings[1].unreleased, 3, 'the CHANGELOG entries carry through');
  });

  await test('a clean repo and an unreadable one both stay out of the warnings', () => {
    const health = {
      '/repos/workkit': { unpushed: 0, uncommitted: 0, unreleasedEntries: 0, lastTag: 'v1.0.0', error: null },
      '/repos/local-only': { unpushed: null, uncommitted: null, unreleasedEntries: 0, lastTag: null, error: 'not a git repo' },
    };
    const out = buildBrief(boardOf([]), health, ROSTER, STAMP);
    assertEq(out.warnings.length, 0, 'nothing to say is better than something to ignore');
  });

  group('tower/brief: what the sweep counted, per repo');

  // Issue #55: the payload carries the sweep's per-repo counts and the day's
  // roster-wide closed total, because the morning's stats line is composed from
  // this payload and a chart drawn a month later reads that line.

  await test('the closed count is summed across the roster, and each repo keeps its own', () => {
    const board = {
      ok: true,
      issues: [issue(1, { status: 'blocked' })],
      repos: [
        { slug: 'owner/workkit', count: 1, totalCount: 1, truncated: false, closedDay: 3, error: null },
        { slug: 'owner/other', count: 0, totalCount: 0, truncated: false, closedDay: 2, error: null },
      ],
    };
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.closedDay, 5, 'three and two closed yesterday');
    assertEq(out.repoCounts.length, 2, 'one entry per repo the sweep answered for');
    assertEq(out.repoCounts[0].slug, 'owner/workkit', 'named by slug, the way the stats line keys them');
    assertEq(out.repoCounts[0].closedDay, 3, 'each repo keeps its own count');
  });

  await test('a repo the sweep could not read contributes no counts at all', () => {
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
    assertEq(out.repoCounts.length, 1, 'only the repo the sweep answered for');
    assertEq(out.repoCounts[0].slug, 'owner/workkit', 'the readable one');
    assertEq(out.closedDay, 3, 'and the sum is over what was actually read');
  });

  await test('a repo over the page cap is still that many issues open', () => {
    const board = {
      ok: true,
      issues: [],
      repos: [{ slug: 'owner/workkit', count: 100, totalCount: 137, truncated: true, closedDay: 0, error: null }],
    };
    assertEq(buildBrief(board, {}, ROSTER, STAMP).repoCounts[0].open, 137,
      'the open count is the totalCount - a series that dipped at the cap would be a lie about the day');
  });

  await test('a sweep that carries no counts at all reads as zero, never undefined', () => {
    const out = buildBrief(boardOf([]), {}, ROSTER, STAMP);
    assertEq(out.closedDay, 0, 'nothing closed');
    assertEq(out.repoCounts.length, 0, 'and no repo entries to draw');
    const older = buildBrief({ ok: true, issues: [], repos: [{ slug: 'owner/workkit', count: 2 }] }, {}, ROSTER, STAMP);
    assertEq(older.repoCounts[0].open, 2, 'a repo entry without a totalCount falls back to what it returned');
    assertEq(older.repoCounts[0].closedDay, 0, 'and one without a closed count closed nothing');
  });

  group('tower/brief: the headline and the failed sweep');

  await test('the headline names the most consequential fact, in order', () => {
    assert(/waiting on a decision/.test(headlineFor({ waiting: 2, qa: 4, inFlight: 5, ready: 3, inbox: 1 })), 'a decision leads');
    assert(/waiting on your check/.test(headlineFor({ waiting: 0, qa: 4, inFlight: 5, ready: 3, inbox: 1 })), 'then the checks the owner owes');
    assert(/in flight/.test(headlineFor({ waiting: 0, inFlight: 1, ready: 3, inbox: 1 })), 'then what is running');
    assert(/ready to start/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 3, inbox: 1 })), 'then what may be started');
    assert(/inbox/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 0, inbox: 4 })), 'then the inbox');
    assert(/empty/.test(headlineFor({ waiting: 0, inFlight: 0, ready: 0, inbox: 0 })), 'and an empty board says so');
  });

  await test('one issue reads as singular, two as plural', () => {
    assert(/1 issue is waiting/.test(headlineFor({ waiting: 1 })), 'singular');
    assert(/2 issues are waiting/.test(headlineFor({ waiting: 2 })), 'plural');
  });

  await test('a failed sweep is reported as a failure, never as a quiet morning', () => {
    const out = buildBrief({ ok: false, reason: 'gh is not authenticated', issues: [] }, {}, ROSTER, STAMP);
    assertEq(out.ok, false, 'the brief is not ok');
    assertEq(out.reason, 'gh is not authenticated', 'and says why');
    assertEq(out.counts.open, 0, 'with no invented work');
  });

  await test('missing arguments degrade to an empty brief rather than throwing', () => {
    const out = buildBrief(null, null, null, STAMP);
    assertEq(out.ok, false, 'no board is not an ok brief');
    assertEq(out.waiting.length, 0, 'nothing waiting');
    assertEq(out.warnings.length, 0, 'nothing on the table');
    assert(typeof out.headline === 'string' && out.headline.length > 0, 'and still a sentence to print');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
