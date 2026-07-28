//
// Tests for tower/api/lib/brief.js — the daily brief.
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
  group('tower/brief: the four sections');

  await test('blocked issues are what is waiting on you; specced splits by claim', () => {
    const board = boardOf([
      issue(1, { status: 'blocked' }),
      issue(2, { status: 'specced' }),
      issue(3, { status: 'specced', assignees: ['ianwieds'] }),
      issue(4, { status: 'inbox' }),
      issue(5, { status: 'parked' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);

    assertEq(out.waiting.length, 1, 'one decision is waiting');
    assertEq(out.waiting[0].number, 1, 'the blocked one');
    assertEq(out.ready.length, 1, 'one specced issue is unclaimed');
    assertEq(out.ready[0].number, 2, 'the one with no assignee');
    assertEq(out.inFlight.length, 1, 'one is claimed');
    assertEq(out.inFlight[0].number, 3, 'the assigned one');
    assertEq(out.inbox.length, 1, 'the inbox is its own section');
    assertEq(out.counts.parked, 1, 'parked is counted but not listed — it is nobody’s morning');
    assertEq(out.generatedAt, STAMP, 'the stamp is the one passed in');
  });

  await test('a building issue is in flight on its label alone, claimed or not', () => {
    const board = boardOf([
      issue(1, { status: 'building', assignees: ['ianwieds'] }),
      issue(2, { status: 'building' }),
    ]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.inFlight.map((i) => i.number).sort().join(','), '1,2',
      'the label is what says work has started — the assignee only says who holds it');
    assertEq(out.counts.inFlight, 2, 'and the count the headline reads agrees');
    assertEq(out.ready.length, 0, 'work already started is never offered as ready');
    assert(/2 issues are in flight/.test(out.headline), `the morning leads with them, got: ${out.headline}`);
  });

  await test('an agent claim counts as in flight even with no assignee', () => {
    const board = boardOf([issue(7, { status: 'specced', agentWorking: true })]);
    const out = buildBrief(board, {}, ROSTER, STAMP);
    assertEq(out.ready.length, 0, 'not offered to a second worker');
    assertEq(out.inFlight.length, 1, 'an agent holds it');
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

  group('tower/brief: the headline and the failed sweep');

  await test('the headline names the most consequential fact, in order', () => {
    assert(/waiting on a decision/.test(headlineFor({ waiting: 2, inFlight: 5, ready: 3, inbox: 1 })), 'a decision leads');
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
