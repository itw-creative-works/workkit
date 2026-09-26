//
// Tests for tower/api/lib/board.js: the soft skip (gh missing, a lapsed
// token, a failed call, a roster with nothing to ask) and the one call
// with per-repo aliases.
// The shared prologue (the fake gh, the issue and label builders, the roster, the module under test) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  fetchBoard, buildBoardQuery, PAGE_SIZE, BODY_LIMIT, LAST_COMMENT_LIMIT, issue, fakeGh, ROSTER,
} = require('./helpers');

const run = async () => {
  group('tower/board: the soft skip');

  await test('gh missing returns the skip shape, never throws', () => {
    const res = fetchBoard(ROSTER, { exec: fakeGh({}, { versionFails: true }) });
    assertEq(res.ok, false, 'not ok');
    assertEq(res.reason, 'gh not found', 'the reason names it');
    assertEq(res.issues.length, 0, 'no issues');
  });

  await test('a lapsed token is judged from the sweep itself - no auth round trip per refresh', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        calls,
        // The real shape of a bad token: gh prints the API's JSON to STDOUT and
        // nothing useful to stderr - the reason must be judged from that stream.
        graphqlError: execError('Command failed: gh api graphql -f query=...', {
          stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}\n',
          stderr: '',
        }),
      }),
    });
    assertEq(res.ok, false, 'not ok');
    assertEq(res.reason, 'gh not authenticated', 'the auth-shaped failure is recognized');
    assertEq(calls.filter((c) => c[1] === 'auth').length, 0, 'gh auth status is never called');
  });

  await test('a graphql failure with no payload is reported, not thrown', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, { graphqlError: execError('HTTP 502', { stderr: 'gateway' }) }),
    });
    assertEq(res.ok, false, 'not ok');
    assert(/502/.test(res.reason), 'the underlying message survives');
    assertEq(res.issues.length, 0, 'no issues');
  });

  await test('a roster with no slugs never calls graphql', () => {
    const calls = [];
    const res = fetchBoard([{ name: 'local', path: '/x/local', slug: null }], { exec: fakeGh({}, { calls }) });
    assertEq(res.ok, true, 'ok - nothing to ask');
    assertEq(res.issues.length, 0, 'no issues');
    assertEq(calls.filter((c) => c[1] === 'api').length, 0, 'no graphql call');
  });

  group('tower/board: one call, per-repo aliases');

  await test('the query aliases every repo and asks for totalCount', () => {
    const q = buildBoardQuery(['ITW-Creative-Works/workkit', 'alice/.dotfiles']);
    assert(q.includes('r0: repository(owner: "ITW-Creative-Works", name: "workkit")'), 'r0 alias');
    assert(q.includes('r1: repository(owner: "alice", name: ".dotfiles")'), 'r1 alias');
    assert(q.includes('totalCount'), 'truncation is answerable');
    assert(q.includes(`first: ${PAGE_SIZE}`), 'the page cap is in the query');
    // The dashboard's issue dialog reads these off the sweep - there is no
    // second request behind a click.
    assert(q.includes('body'), 'the body the dialog renders');
    assert(q.includes('createdAt'), 'when it was filed');
    assert(q.includes('comments(last: 1) { totalCount nodes { body } }'),
      'how much conversation is waiting, and the newest word of it - a blocked issue’s open question (#196)');
  });

  await test('the query asks whether another page follows, and carries a cursor when one does', () => {
    const first = buildBoardQuery(['ITW-Creative-Works/workkit']);
    assert(first.includes('pageInfo { hasNextPage endCursor }'), 'the sweep can tell whether it reached the end (#194)');
    assert(!first.includes('after:'), 'the first page starts where the connection does');
    const next = buildBoardQuery(['ITW-Creative-Works/workkit'], ['CUR1']);
    assert(next.includes(`first: ${PAGE_SIZE}, after: "CUR1"`), 'and the page after it says where to resume');
  });

  await test('an issue carries what the dialog shows, with a long body cut and reported', () => {
    const long = 'x'.repeat(BODY_LIMIT + 500);
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 2,
              nodes: [
                issue(17, { body: '## Spec\n\nnone', createdAt: '2026-07-01T00:00:00Z', comments: { totalCount: 3 } }),
                issue(18, { body: long }),
              ],
            },
          },
        },
      }),
    });
    const [a, b] = res.issues;
    assertEq(a.body, '## Spec\n\nnone', 'the body arrives as it was written');
    assertEq(a.bodyTruncated, false, 'and whole');
    assertEq(a.createdAt, '2026-07-01T00:00:00Z', 'the filing date');
    assertEq(a.comments, 3, 'the comment count');
    assertEq(b.body.length, BODY_LIMIT, 'a body longer than the cap is cut to it');
    assertEq(b.bodyTruncated, true, 'and says so, so the dialog can point at GitHub');
    assertEq(b.comments, 0, 'an issue with no comment count reads as none');
  });

  // Issue #196: a blocked issue's open question is a COMMENT on it - the spec's
  // own convention - so the sweep carries the newest one and the Board draws it
  // on a blocked card. The cut is stated on both sides of the limit, since a
  // question that arrives half-drawn with nothing to say so is worse than none.
  await test('an issue carries its newest comment as one line, cut where a card ends', () => {
    const comments = (...bodies) => ({ totalCount: bodies.length, nodes: bodies.map((body) => ({ body })) });
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 4,
              nodes: [
                issue(17, { comments: comments('Which of the two?\n\nSay the word.') }),
                issue(18, { comments: comments('x'.repeat(LAST_COMMENT_LIMIT)) }),
                issue(19, { comments: comments('y'.repeat(LAST_COMMENT_LIMIT + 1)) }),
                issue(20, {}),
              ],
            },
          },
        },
      }),
    });
    const [a, b, c, d] = res.issues;
    assertEq(a.lastComment, 'Which of the two? Say the word.',
      'the comment as one line - the markdown’s own breaks are folded here, not in every surface that draws it');
    assertEq(b.lastComment.length, LAST_COMMENT_LIMIT, 'a comment exactly at the limit arrives whole');
    assert(!b.lastComment.endsWith('…'), 'and says nothing about a cut that did not happen');
    assertEq(c.lastComment.length, LAST_COMMENT_LIMIT + 1, 'one past it is cut to the limit');
    assert(c.lastComment.endsWith('…'), 'and says so, rather than stopping mid-word in silence');
    assertEq(d.lastComment, '', 'an issue nobody has commented on carries the empty string, never a missing field');
  });

  await test('two repos come back as one flat, normalized issue list', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 2, nodes: [issue(17), issue(18)] } },
          r1: { issues: { totalCount: 1, nodes: [issue(22)] } },
        },
      }, { calls }),
    });
    assertEq(res.ok, true, 'ok');
    assertEq(res.issues.length, 3, 'all three issues');
    assertEq(res.issues.map((i) => `${i.repo}#${i.number}`).join(' '),
      'ITW-Creative-Works/workkit#17 ITW-Creative-Works/workkit#18 alice/.dotfiles#22',
      'each issue carries its repo slug');
    assertEq(calls.filter((c) => c[1] === 'api').length, 1, 'ONE graphql call for the whole roster');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
