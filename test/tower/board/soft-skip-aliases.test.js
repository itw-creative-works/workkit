//
// Tests for tower/api/lib/board.js: the soft skip (gh missing, a lapsed token, a
// failed call, an empty roster) and the one aliased call. Prologue: ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  fetchBoard, buildBoardQuery, PAGE_SIZE, BODY_LIMIT, LAST_COMMENT_LIMIT, issue, fakeGh, ROSTER,
} = require('./helpers');

describe('tower/board: the soft skip', () => {
  test('gh missing returns the skip shape, never throws', () => {
    const res = fetchBoard(ROSTER, { exec: fakeGh({}, { versionFails: true }) });
    expect(res.ok, 'not ok').toBe(false);
    expect(res.reason, 'the reason names it').toBe('gh not found');
    expect(res.issues.length, 'no issues').toBe(0);
  });

  test('a lapsed token is judged from the sweep itself - no auth round trip per refresh', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, {
        calls,
        // The real shape of a bad token: gh prints the API's JSON to stdout and
        // nothing useful to stderr, so the reason is judged from that stream.
        graphqlError: execError('Command failed: gh api graphql -f query=...', {
          stdout: '{"message":"Bad credentials","documentation_url":"https://docs.github.com/graphql","status":"401"}\n',
          stderr: '',
        }),
      }),
    });
    expect(res.ok, 'not ok').toBe(false);
    expect(res.reason, 'the auth-shaped failure is recognized').toBe('gh not authenticated');
    expect(calls.filter((c) => c[1] === 'auth').length, 'gh auth status is never called').toBe(0);
  });

  test('a graphql failure with no payload is reported, not thrown', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({}, { graphqlError: execError('HTTP 502', { stderr: 'gateway' }) }),
    });
    expect(res.ok, 'not ok').toBe(false);
    expect(/502/.test(res.reason), 'the underlying message survives').toBeTruthy();
    expect(res.issues.length, 'no issues').toBe(0);
  });

  test('a roster with no slugs never calls graphql', () => {
    const calls = [];
    const res = fetchBoard([{ name: 'local', path: '/x/local', slug: null }], { exec: fakeGh({}, { calls }) });
    expect(res.ok, 'ok - nothing to ask').toBe(true);
    expect(res.issues.length, 'no issues').toBe(0);
    expect(calls.filter((c) => c[1] === 'api').length, 'no graphql call').toBe(0);
  });
});

describe('tower/board: one call, per-repo aliases', () => {
  test('the query aliases every repo and asks for totalCount', () => {
    const q = buildBoardQuery(['ITW-Creative-Works/workkit', 'alice/.dotfiles']);
    expect(q.includes('r0: repository(owner: "ITW-Creative-Works", name: "workkit")'), 'r0 alias').toBeTruthy();
    expect(q.includes('r1: repository(owner: "alice", name: ".dotfiles")'), 'r1 alias').toBeTruthy();
    expect(q.includes('totalCount'), 'truncation is answerable').toBeTruthy();
    expect(q.includes(`first: ${PAGE_SIZE}`), 'the page cap is in the query').toBeTruthy();
    // The dashboard's issue dialog reads these off the sweep - there is no
    // second request behind a click.
    expect(q.includes('body'), 'the body the dialog renders').toBeTruthy();
    expect(q.includes('createdAt'), 'when it was filed').toBeTruthy();
    expect(q.includes('comments(last: 1) { totalCount nodes { body } }'),
      'how much conversation is waiting, and the newest word of it - a blocked issue’s open question (#196)').toBeTruthy();
  });

  test('the query asks whether another page follows, and carries a cursor when one does', () => {
    const first = buildBoardQuery(['ITW-Creative-Works/workkit']);
    expect(first.includes('pageInfo { hasNextPage endCursor }'), 'the sweep can tell whether it reached the end (#194)').toBeTruthy();
    expect(!first.includes('after:'), 'the first page starts where the connection does').toBeTruthy();
    const next = buildBoardQuery(['ITW-Creative-Works/workkit'], ['CUR1']);
    expect(next.includes(`first: ${PAGE_SIZE}, after: "CUR1"`), 'and the page after it says where to resume').toBeTruthy();
  });

  test('an issue carries what the dialog shows, with a long body cut and reported', () => {
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
    expect(a.body, 'the body arrives as it was written').toBe('## Spec\n\nnone');
    expect(a.bodyTruncated, 'and whole').toBe(false);
    expect(a.createdAt, 'the filing date').toBe('2026-07-01T00:00:00Z');
    expect(a.comments, 'the comment count').toBe(3);
    expect(b.body.length, 'a body longer than the cap is cut to it').toBe(BODY_LIMIT);
    expect(b.bodyTruncated, 'and says so, so the dialog can point at GitHub').toBe(true);
    expect(b.comments, 'an issue with no comment count reads as none').toBe(0);
  });

  // A blocked issue's open question is a comment on it (the spec's convention),
  // so the sweep carries the newest one. The cut is stated on both sides of the
  // limit: a question half-drawn with nothing to say so is worse than none.
  test('an issue carries its newest comment as one line, cut where a card ends', () => {
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
    expect(a.lastComment, 'the comment as one line - the markdown’s own breaks are folded here, not in every surface that draws it').toBe('Which of the two? Say the word.');
    expect(b.lastComment.length, 'a comment exactly at the limit arrives whole').toBe(LAST_COMMENT_LIMIT);
    expect(!b.lastComment.endsWith('…'), 'and says nothing about a cut that did not happen').toBeTruthy();
    expect(c.lastComment.length, 'one past it is cut to the limit').toBe(LAST_COMMENT_LIMIT + 1);
    expect(c.lastComment.endsWith('…'), 'and says so, rather than stopping mid-word in silence').toBeTruthy();
    expect(d.lastComment, 'an issue nobody has commented on carries the empty string, never a missing field').toBe('');
  });

  test('two repos come back as one flat, normalized issue list', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 2, nodes: [issue(17), issue(18)] } },
          r1: { issues: { totalCount: 1, nodes: [issue(22)] } },
        },
      }, { calls }),
    });
    expect(res.ok, 'ok').toBe(true);
    expect(res.issues.length, 'all three issues').toBe(3);
    expect(res.issues.map((i) => `${i.repo}#${i.number}`).join(' '), 'each issue carries its repo slug').toBe('ITW-Creative-Works/workkit#17 ITW-Creative-Works/workkit#18 alice/.dotfiles#22');
    expect(calls.filter((c) => c[1] === 'api').length, 'ONE graphql call for the whole roster').toBe(1);
  });
});
