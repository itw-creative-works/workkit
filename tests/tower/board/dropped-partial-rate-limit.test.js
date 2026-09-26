//
// Tests for tower/api/lib/board.js: the answers GitHub gives short (a
// dropped issue node, a partial answer kept) and a spent rate limit that
// says when it lifts.
// The shared prologue (the fake gh, the issue and label builders, the roster, the module under test) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { httpAnswer, execError, resetIn, clockAt } = require('../../lib/gh');
const {
  fetchBoard, splitResponse, rateLimitReason, labels, issue, fakeGh, ROSTER,
} = require('./helpers');

const run = async () => {
  group('tower/board: a dropped issue node');

  // Issue #202's crash itself: GitHub answers the shape of the board with every
  // issue node NULL. Reading `node.labels` off one of those ended the API
  // process and took the dashboard down with it.
  await test('a null issue node is skipped and counted, never thrown on', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 3, nodes: [issue(17), null, null] } },
          r1: { issues: { totalCount: 1, nodes: [issue(22)] } },
        },
        errors: [
          { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 1], message: 'the query exceeded a limit' },
          { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 2], message: 'and again' },
        ],
      }),
    });
    assertEq(res.ok, true, 'the board still renders');
    assertEq(res.issues.map((i) => i.number).join(','), '17,22', 'the issues that arrived are normalized as usual');
    assertEq(res.repos[0].count, 1, 'a dropped node is not an issue on the board');
  });

  await test('the repo it happened to says how much was dropped, so the Overview warns', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 3, nodes: [issue(17), null, null] } },
          r1: { issues: { totalCount: 1, nodes: [issue(22)] } },
        },
        errors: [
          { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 1], message: 'the query exceeded a limit' },
          { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 2], message: 'and again' },
        ],
      }),
    });
    assertEq(res.repos[0].error, 'GitHub dropped 2 of 3 issues: the query exceeded a limit',
      'the count and GitHub’s first word on it - the 464th says nothing the first did not');
    assertEq(res.repos[1].error, null, 'and the repo that answered whole carries none');
  });

  await test('a null node INSIDE an issue is skipped too - the drop is not only the issue list', () => {
    // The same failure one level down, and the second throw it caused: GitHub
    // nulls a node it could not deliver wherever the connection is, and every
    // other connection on an issue already skipped one. `assignees` did not.
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(17, { assignees: { nodes: [null, { login: 'alice' }] } })] } },
        },
      }),
    });
    assertEq(res.ok, true, 'the board still renders');
    assertEq(res.issues[0].assignees.join(','), 'alice', 'the assignee that arrived is carried, the hole is not');
  });

  group('tower/board: a partial answer is kept');

  await test('one unresolvable repo does not blank the board - gh exits 1 with the data on stdout', () => {
    // Exactly what `gh api graphql` does when an alias fails: non-zero exit,
    // the complete payload for every other alias on stdout, the failure in an
    // errors array naming the alias.
    const partial = JSON.stringify({
      data: {
        r0: null,
        r1: { issues: { totalCount: 1, nodes: [issue(9, { labels: labels('status:inbox') })] } },
      },
      errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository with the name.' }],
    });
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        graphqlError: execError('Command failed: gh api graphql', { stdout: partial, stderr: 'gh: Could not resolve to a Repository' }),
      }),
    });
    assertEq(res.ok, true, 'the board still renders');
    assertEq(res.issues.length, 1, 'the repo that resolved keeps its issues');
    assertEq(res.issues[0].repo, 'alice/.dotfiles', 'and they are attributed correctly');
    assertEq(res.issues[0].status, 'inbox', 'normalized as usual');
    assert(/Could not resolve/.test(res.repos[0].error), 'the unresolved repo carries its reason');
    assertEq(res.repos[1].error, null, 'the healthy repo carries none');
  });

  await test('an errors array on a clean exit still lands on the repo it names', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(1)] } },
          r1: null,
        },
        errors: [{ path: ['r1'], message: 'Resource not accessible by integration' }],
      }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.issues.length, 1, 'r0 survives');
    assertEq(res.repos[0].error, null, 'r0 is fine');
    assertEq(res.repos[1].error, 'Resource not accessible by integration', 'r1 says why');
  });

  await test('an alias that is simply absent reports "not resolved"', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({ data: { r0: { issues: { totalCount: 0, nodes: [] } } } }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.repos[0].error, null, 'present and empty is not an error');
    assertEq(res.repos[1].error, 'not resolved', 'absent is');
  });

  await test('a non-zero exit whose stdout has no data is a real failure', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        graphqlError: execError('Command failed', { stdout: '{"errors":[{"message":"Bad credentials"}]}', stderr: '' }),
      }),
    });
    assertEq(res.ok, false, 'nothing usable came back');
    assertEq(res.issues.length, 0, 'no issues');
  });

  group('tower/board: a spent rate limit says when it lifts');

  /** A fake `gh` answering one raw response, either printed or thrown on stdout. */
  const fakeRaw = (text, { fails = false, calls = [] } = {}) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === '--version') return 'gh version 2.0.0\n';
    if (fails) throw execError('Command failed: gh api graphql', { stdout: text, stderr: '' });
    return text;
  };

  await test('the headers are asked for, so the reset time can be read at all', () => {
    const calls = [];
    fetchBoard(ROSTER, { exec: fakeRaw(httpAnswer(200, { 'x-ratelimit-remaining': '4999' }, { data: { r0: { issues: { totalCount: 0, nodes: [] } }, r1: { issues: { totalCount: 0, nodes: [] } } } }), { calls }) });
    const graphql = calls.find((c) => c[1] === 'api');
    assert(graphql.includes('--include'), `the call carries --include, got: ${graphql.join(' ')}`);
  });

  await test('a 403 with the budget spent reports the reset time in the local clock', () => {
    const reset = resetIn(18);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(403, {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(reset),
      }, { message: 'API rate limit exceeded for user ID 7562803.' }), { fails: true }),
    });
    assertEq(res.ok, false, 'nothing came back');
    assertEq(res.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`, 'the sentence names the limit and when it lifts');
  });

  await test('a limit lifting inside the minute says so rather than counting to zero', () => {
    const reset = resetIn(0.5);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, { message: 'Too many requests' }), { fails: true }),
    });
    assert(/\(in under a minute\)\.$/.test(res.reason), `the wait reads as a wait, got: ${res.reason}`);
  });

  await test('a normal answer with the header block in front of it still yields the payload', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-RateLimit-Remaining': '4987',
      }, {
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(4, { labels: labels('status:inbox') })] } },
          r1: { issues: { totalCount: 0, nodes: [] } },
        },
      })),
    });
    assertEq(res.ok, true, 'the header block is not mistaken for the body');
    assertEq(res.issues.length, 1, 'and the issues arrive as they always did');
    assertEq(res.issues[0].status, 'inbox', 'normalized as usual');
  });

  await test('a bad token is still a bad token, headers or not', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(401, {
        'X-RateLimit-Remaining': '4999',
        'X-RateLimit-Reset': String(resetIn(30)),
      }, { message: 'Bad credentials', status: '401' }), { fails: true }),
    });
    assertEq(res.reason, 'gh not authenticated', 'the auth failure keeps its own reason');
  });

  await test('the reading of a limit is pure, and everything else reads as no limit', () => {
    const now = Date.UTC(2026, 7, 28, 3, 0, 0);
    const at = (seconds) => String(Math.floor(now / 1000) + seconds);
    const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': at(300) };
    assert(/\(in 5 min\)\.$/.test(rateLimitReason(403, headers, now)), 'five minutes out reads as five');
    assertEq(rateLimitReason(500, headers, now), null, 'a server failure is not a limit');
    assertEq(rateLimitReason(403, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': at(300) }, now), null, 'budget left is not a limit');
    assertEq(rateLimitReason(403, { 'x-ratelimit-remaining': '0' }, now), null, 'and a limit with no reset time has nothing to say');
    assert(rateLimitReason(403, { 'x-ratelimit-reset': at(300) }, now, { message: 'API rate limit exceeded' }) !== null,
      'the body says it when the counter did not survive');
    assert(rateLimitReason(200, {}, now, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }) === null,
      'the GraphQL tell with no reset time still has nothing to say');
    // The wire as observed on 2026-08-29: a 200 whose error type is RATE_LIMIT
    // (not the documented RATE_LIMITED) with the budget headers beside it.
    const live = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor((now + 34 * 60000) / 1000)) };
    const seen = rateLimitReason(200, live, now, { errors: [{ type: "RATE_LIMIT", code: "graphql_rate_limit", message: "API rate limit already exceeded for user ID 1." }] });
    assert(seen && seen.includes("(in 34 min)"), "the live RATE_LIMIT shape is read as the limit it is, got " + seen);
  });

  await test('a secondary limit is measured by what it was told to wait, not the shared reset', () => {
    // Both headers on one answer: `retry-after` is THIS caller's wait, the
    // reset second is when the shared budget refills, and they disagree.
    const now = Date.UTC(2026, 7, 28, 3, 0, 0);
    const said = rateLimitReason(403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(now / 1000) + (60 * 60)),
      'retry-after': '120',
    }, now, { message: 'You have exceeded a secondary rate limit' });
    assert(/\(in 2 min\)\.$/.test(said), `the seconds it was handed win, got: ${said}`);
    const spentAlready = rateLimitReason(429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(now / 1000)) }, now);
    assert(/\(now\)\.$/.test(spentAlready), `a window that has already turned reads as now, got: ${spentAlready}`);
  });

  await test('the GraphQL limit arrives as an ordinary 200 and is read as the limit it is', () => {
    // GitHub answers a spent GraphQL budget 200, with the whole of the tell in
    // the error type - the status line says nothing is wrong.
    const reset = resetIn(9);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) }, {
        data: null,
        errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      })),
    });
    assertEq(res.ok, false, 'a 200 with nothing in it is still a failed sweep');
    assertEq(res.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`,
      'and it says when it lifts rather than "returned no data"');
  });

  await test('a bare body with no header block parses exactly as it did before', () => {
    const { status, headers, body } = splitResponse('{"data":{"r0":null}}');
    assertEq(status, null, 'no status line, no status');
    assertEq(Object.keys(headers).length, 0, 'no headers');
    assertEq(body, '{"data":{"r0":null}}', 'and the body is the whole of it');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
