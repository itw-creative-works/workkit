//
// Tests for tower/api/lib/board.js: the answers GitHub gives short (a dropped
// node, a kept partial) and a rate limit that says when it lifts. See ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const { httpAnswer, execError, resetIn, clockAt } = require('../../lib/gh');
const {
  fetchBoard, splitResponse, rateLimitReason, labels, issue, fakeGh, ROSTER,
} = require('./helpers');

describe('tower/board: a dropped issue node', () => {
  // GitHub can answer the board's shape with every issue node null, and reading
  // `node.labels` off one must not end the API process.
  test('a null issue node is skipped and counted, never thrown on', () => {
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
    expect(res.ok, 'the board still renders').toBe(true);
    expect(res.issues.map((i) => i.number).join(','), 'the issues that arrived are normalized as usual').toBe('17,22');
    expect(res.repos[0].count, 'a dropped node is not an issue on the board').toBe(1);
  });

  test('the repo it happened to says how much was dropped, so the Overview warns', () => {
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
    expect(res.repos[0].error, 'the count and GitHub’s first word on it - the 464th says nothing the first did not').toBe('GitHub dropped 2 of 3 issues: the query exceeded a limit');
    expect(res.repos[1].error, 'and the repo that answered whole carries none').toBe(null);
  });

  test('a null node INSIDE an issue is skipped too - the drop is not only the issue list', () => {
    // The same failure one level down: GitHub nulls a node it could not deliver
    // in any connection, so every connection on an issue has to skip one.
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(17, { assignees: { nodes: [null, { login: 'alice' }] } })] } },
        },
      }),
    });
    expect(res.ok, 'the board still renders').toBe(true);
    expect(res.issues[0].assignees.join(','), 'the assignee that arrived is carried, the hole is not').toBe('alice');
  });
});

describe('tower/board: a partial answer is kept', () => {
  test('one unresolvable repo does not blank the board - gh exits 1 with the data on stdout', () => {
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
    expect(res.ok, 'the board still renders').toBe(true);
    expect(res.issues.length, 'the repo that resolved keeps its issues').toBe(1);
    expect(res.issues[0].repo, 'and they are attributed correctly').toBe('alice/.dotfiles');
    expect(res.issues[0].status, 'normalized as usual').toBe('inbox');
    expect(/Could not resolve/.test(res.repos[0].error), 'the unresolved repo carries its reason').toBeTruthy();
    expect(res.repos[1].error, 'the healthy repo carries none').toBe(null);
  });

  test('an errors array on a clean exit still lands on the repo it names', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 1, nodes: [issue(1)] } },
          r1: null,
        },
        errors: [{ path: ['r1'], message: 'Resource not accessible by integration' }],
      }),
    });
    expect(res.ok, 'ok').toBe(true);
    expect(res.issues.length, 'r0 survives').toBe(1);
    expect(res.repos[0].error, 'r0 is fine').toBe(null);
    expect(res.repos[1].error, 'r1 says why').toBe('Resource not accessible by integration');
  });

  test('an alias that is simply absent reports "not resolved"', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({ data: { r0: { issues: { totalCount: 0, nodes: [] } } } }),
    });
    expect(res.ok, 'ok').toBe(true);
    expect(res.repos[0].error, 'present and empty is not an error').toBe(null);
    expect(res.repos[1].error, 'absent is').toBe('not resolved');
  });

  test('a non-zero exit whose stdout has no data is a real failure', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        graphqlError: execError('Command failed', { stdout: '{"errors":[{"message":"Bad credentials"}]}', stderr: '' }),
      }),
    });
    expect(res.ok, 'nothing usable came back').toBe(false);
    expect(res.issues.length, 'no issues').toBe(0);
  });
});

describe('tower/board: a spent rate limit says when it lifts', () => {
  /** A fake `gh` answering one raw response, either printed or thrown on stdout. */
  const fakeRaw = (text, { fails = false, calls = [] } = {}) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === '--version') return 'gh version 2.0.0\n';
    if (fails) throw execError('Command failed: gh api graphql', { stdout: text, stderr: '' });
    return text;
  };

  test('the headers are asked for, so the reset time can be read at all', () => {
    const calls = [];
    fetchBoard(ROSTER, { exec: fakeRaw(httpAnswer(200, { 'x-ratelimit-remaining': '4999' }, { data: { r0: { issues: { totalCount: 0, nodes: [] } }, r1: { issues: { totalCount: 0, nodes: [] } } } }), { calls }) });
    const graphql = calls.find((c) => c[1] === 'api');
    expect(graphql.includes('--include'), `the call carries --include, got: ${graphql.join(' ')}`).toBeTruthy();
  });

  test('a 403 with the budget spent reports the reset time in the local clock', () => {
    const reset = resetIn(18);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(403, {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(reset),
      }, { message: 'API rate limit exceeded for user ID 7562803.' }), { fails: true }),
    });
    expect(res.ok, 'nothing came back').toBe(false);
    expect(res.reason, 'the sentence names the limit and when it lifts').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`);
  });

  test('a limit lifting inside the minute says so rather than counting to zero', () => {
    const reset = resetIn(0.5);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }, { message: 'Too many requests' }), { fails: true }),
    });
    expect(/\(in under a minute\)\.$/.test(res.reason), `the wait reads as a wait, got: ${res.reason}`).toBeTruthy();
  });

  test('a normal answer with the header block in front of it still yields the payload', () => {
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
    expect(res.ok, 'the header block is not mistaken for the body').toBe(true);
    expect(res.issues.length, 'and the issues arrive as they always did').toBe(1);
    expect(res.issues[0].status, 'normalized as usual').toBe('inbox');
  });

  test('a bad token is still a bad token, headers or not', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(401, {
        'X-RateLimit-Remaining': '4999',
        'X-RateLimit-Reset': String(resetIn(30)),
      }, { message: 'Bad credentials', status: '401' }), { fails: true }),
    });
    expect(res.reason, 'the auth failure keeps its own reason').toBe('gh not authenticated');
  });

  test('the reading of a limit is pure, and everything else reads as no limit', () => {
    const now = Date.UTC(2026, 7, 28, 3, 0, 0);
    const at = (seconds) => String(Math.floor(now / 1000) + seconds);
    const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': at(300) };
    expect(/\(in 5 min\)\.$/.test(rateLimitReason(403, headers, now)), 'five minutes out reads as five').toBeTruthy();
    expect(rateLimitReason(500, headers, now), 'a server failure is not a limit').toBe(null);
    expect(rateLimitReason(403, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': at(300) }, now), 'budget left is not a limit').toBe(null);
    expect(rateLimitReason(403, { 'x-ratelimit-remaining': '0' }, now), 'and a limit with no reset time has nothing to say').toBe(null);
    expect(rateLimitReason(403, { 'x-ratelimit-reset': at(300) }, now, { message: 'API rate limit exceeded' }) !== null,
      'the body says it when the counter did not survive').toBeTruthy();
    expect(rateLimitReason(200, {}, now, { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }) === null,
      'the GraphQL tell with no reset time still has nothing to say').toBeTruthy();
    // The wire as observed live: a 200 whose error type is RATE_LIMIT (not the
    // documented RATE_LIMITED), with the budget headers beside it.
    const live = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor((now + 34 * 60000) / 1000)) };
    const seen = rateLimitReason(200, live, now, { errors: [{ type: "RATE_LIMIT", code: "graphql_rate_limit", message: "API rate limit already exceeded for user ID 1." }] });
    expect(seen && seen.includes("(in 34 min)"), "the live RATE_LIMIT shape is read as the limit it is, got " + seen).toBeTruthy();
  });

  test('a secondary limit is measured by what it was told to wait, not the shared reset', () => {
    // Both headers on one answer: `retry-after` is this caller's wait, the
    // reset second is when the shared budget refills, and they disagree.
    const now = Date.UTC(2026, 7, 28, 3, 0, 0);
    const said = rateLimitReason(403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(now / 1000) + (60 * 60)),
      'retry-after': '120',
    }, now, { message: 'You have exceeded a secondary rate limit' });
    expect(/\(in 2 min\)\.$/.test(said), `the seconds it was handed win, got: ${said}`).toBeTruthy();
    const spentAlready = rateLimitReason(429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(now / 1000)) }, now);
    expect(/\(now\)\.$/.test(spentAlready), `a window that has already turned reads as now, got: ${spentAlready}`).toBeTruthy();
  });

  test('the GraphQL limit arrives as an ordinary 200 and is read as the limit it is', () => {
    // GitHub answers a spent GraphQL budget 200, with the whole of the tell in
    // the error type - the status line says nothing is wrong.
    const reset = resetIn(9);
    const res = fetchBoard(ROSTER, {
      exec: fakeRaw(httpAnswer(200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) }, {
        data: null,
        errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      })),
    });
    expect(res.ok, 'a 200 with nothing in it is still a failed sweep').toBe(false);
    expect(res.reason, 'and it says when it lifts rather than "returned no data"').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`);
  });

  test('a bare body with no header block parses exactly as it did before', () => {
    const { status, headers, body } = splitResponse('{"data":{"r0":null}}');
    expect(status, 'no status line, no status').toBe(null);
    expect(Object.keys(headers).length, 'no headers').toBe(0);
    expect(body, 'and the body is the whole of it').toBe('{"data":{"r0":null}}');
  });
});
