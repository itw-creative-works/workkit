//
// Tests for tower/api/lib/board.js - the cross-repo issue sweep.
//
// `gh` is the one thing that cannot be exercised for real here: a live call
// needs auth and the network, and the point of the seam is that the tower
// renders without either. So the exec seam takes a fake that answers the two
// commands the module issues, and every OTHER fact - the label vocabulary
// especially - comes from the real in-repo workflow/labels.json.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const { fetchBoard, buildQuery, labelGroups, LABELS_FILE, PAGE_SIZE, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, REPOS_PER_REQUEST } = require(path.join(REPO, 'tower', 'api', 'lib', 'board.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-board-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const labels = (...names) => ({ nodes: names.map((name) => ({ name })) });
const assignees = (...logins) => ({ nodes: logins.map((login) => ({ login })) });

const issue = (number, extra = {}) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: labels(),
  assignees: assignees(),
  ...extra,
});

/**
 * The error execFileSync throws on a non-zero exit: the message, the streams it
 * captured, and the status. `gh api graphql` exits 1 whenever the response
 * carries an errors array - WITH the complete payload on stdout - so this shape
 * is the difference between a partial board and a blank one.
 */
const execError = (message, { stdout = '', stderr = '', status = 1, code = null } = {}) => {
  const err = new Error(message);
  err.stdout = stdout;
  err.stderr = stderr;
  err.status = status;
  if (code) err.code = code;
  return err;
};

/** A fake `gh`: the version probe passes, graphql answers with the given payload. */
const fakeGh = (payload, { versionFails = false, graphqlError = null, calls = [] } = {}) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (args[0] === '--version') {
    if (versionFails) throw execError('spawnSync gh ENOENT', { code: 'ENOENT', status: null });
    return 'gh version 2.0.0\n';
  }
  if (graphqlError) throw graphqlError;
  return JSON.stringify(payload);
};

const ROSTER = [
  { name: 'workkit', path: '/x/workkit', slug: 'ITW-Creative-Works/workkit' },
  { name: '.dotfiles', path: '/x/.dotfiles', slug: 'ianwieds/.dotfiles' },
];

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
    const q = buildQuery([['ITW-Creative-Works', 'workkit'], ['ianwieds', '.dotfiles']]);
    assert(q.includes('r0: repository(owner: "ITW-Creative-Works", name: "workkit")'), 'r0 alias');
    assert(q.includes('r1: repository(owner: "ianwieds", name: ".dotfiles")'), 'r1 alias');
    assert(q.includes('totalCount'), 'truncation is answerable');
    assert(q.includes(`first: ${PAGE_SIZE}`), 'the page cap is in the query');
    // The dashboard's issue dialog reads these off the sweep - there is no
    // second request behind a click.
    assert(q.includes('body'), 'the body the dialog renders');
    assert(q.includes('createdAt'), 'when it was filed');
    assert(q.includes('comments(last: 1) { totalCount nodes { body } }'),
      'how much conversation is waiting, and the newest word of it - a blocked issue’s open question (#196)');
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
      'ITW-Creative-Works/workkit#17 ITW-Creative-Works/workkit#18 ianwieds/.dotfiles#22',
      'each issue carries its repo slug');
    assertEq(calls.filter((c) => c[1] === 'api').length, 1, 'ONE graphql call for the whole roster');
  });

  group('tower/board: what the day closed');

  // Issue #55: the sweep gains a COUNT of the issues closed in the last 24
  // hours, per repo - never the closed issues themselves. The clock is stated,
  // because a 24-hour window judged at whatever moment the suite runs is a
  // window no fixture can sit either side of.
  const NOW = Date.parse('2026-07-29T11:00:00Z');
  const closedAt = (...stamps) => ({ nodes: stamps.map((stamp) => ({ closedAt: stamp })) });

  await test('the query asks each repo for its recently closed issues, and only their stamps', () => {
    const q = buildQuery([['ITW-Creative-Works', 'workkit']]);
    assert(q.includes('closed: issues(states: CLOSED'), 'an aliased second field');
    assert(q.includes(`first: ${CLOSED_PAGE}`), 'with its own page size');
    assert(/closed: issues\([^)]*\) \{\n\s*nodes \{ closedAt \}/.test(q), `and it selects nothing but closedAt: ${q}`);
  });

  await test('a repo reports how many issues it closed in the last day', () => {
    const res = fetchBoard([ROSTER[0]], {
      now: NOW,
      exec: fakeGh({
        data: {
          r0: {
            issues: { totalCount: 1, nodes: [issue(17)] },
            // Three hours ago, 23h59 ago, 24h01 ago, tomorrow, and a stamp
            // that is not one.
            closed: closedAt('2026-07-29T08:00:00Z', '2026-07-28T11:01:00Z', '2026-07-28T10:59:00Z', '2026-07-30T09:00:00Z', null),
          },
        },
      }),
    });
    assertEq(res.repos[0].closedDay, 2, 'the two inside the window, and neither edge case');
  });

  await test('a closed issue never enters the board', () => {
    const res = fetchBoard([ROSTER[0]], {
      now: NOW,
      exec: fakeGh({
        data: { r0: { issues: { totalCount: 1, nodes: [issue(17)] }, closed: closedAt('2026-07-29T08:00:00Z') } },
      }),
    });
    assertEq(res.issues.length, 1, 'the issue list is the OPEN board, exactly as before');
    assertEq(res.issues[0].number, 17, 'and it is the open issue');
  });

  await test('a repo that answered nothing closed nothing', () => {
    const res = fetchBoard(ROSTER, {
      now: NOW,
      exec: fakeGh({ data: { r0: { issues: { totalCount: 0, nodes: [] } }, r1: null } }),
    });
    assertEq(res.repos[0].closedDay, 0, 'a repo with no closed field reads as zero, never undefined');
    assertEq(res.repos[1].closedDay, 0, 'and so does one that did not resolve at all');
  });

  group('tower/board: what an issue waits on');

  // Issue #103: the sweep carries GitHub's own dependency edges, merged with the
  // inline `Depends on:` line the cross-org case is written as. Advisory only -
  // nothing here touches a label; the edges order a morning and badge a card.
  const blockedBy = (...edges) => ({
    nodes: edges.map(([number, state, repo]) => ({
      number,
      state,
      repository: repo === null ? null : { nameWithOwner: repo || 'ITW-Creative-Works/workkit' },
    })),
  });

  const waits = (res, i = 0) => res.issues[i].blockedBy.map((b) => `${b.repo}#${b.number}`).join(' ');

  const swept = (node) => fetchBoard([ROSTER[0]], {
    exec: fakeGh({ data: { r0: { issues: { totalCount: 1, nodes: [node] } } } }),
  });

  await test('the query asks what each issue is blocked by, and for the blocker’s state', () => {
    const q = buildQuery([['ITW-Creative-Works', 'workkit']]);
    assert(q.includes('blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }'),
      `the dependency edges ride the one sweep, state and all: ${q}`);
  });

  await test('an open edge is a blocker; a closed one is satisfied and never surfaces', () => {
    const res = swept(issue(17, {
      blockedBy: blockedBy([4, 'OPEN'], [5, 'CLOSED'], [9, 'OPEN', 'ianwieds/.dotfiles']),
    }));
    assertEq(waits(res), 'ITW-Creative-Works/workkit#4 ianwieds/.dotfiles#9',
      'both open edges, each carrying the repo it lives in - a cross-repo blocker is not #9 here');
    assert(!waits(res).includes('#5'), 'a dependency on a closed issue is satisfied');
  });

  await test('an inline Depends on: line is merged with the native edges, and a repeat is one edge', () => {
    const res = swept(issue(17, {
      blockedBy: blockedBy([4, 'OPEN']),
      body: 'The graph half waits on the framework.\n\nDepends on: Omega-JS-Stack/omega#144, ITW-Creative-Works/workkit#4\n',
    }));
    assertEq(waits(res), 'ITW-Creative-Works/workkit#4 Omega-JS-Stack/omega#144',
      'the native edge leads and the cross-org line adds the one GitHub would not hold');
    assertEq(res.issues[0].blockedBy.length, 2, 'the edge written both ways is counted once');
  });

  await test('a bare #n on that line means this repo, and anything malformed on it is ignored', () => {
    const res = swept(issue(17, {
      body: 'Depends on: #7 and owner#3 and o/r#x\n\nAlso mentions #99 in a paragraph that is not the line.\n',
    }));
    assertEq(waits(res), 'ITW-Creative-Works/workkit#7',
      'the bare reference is this repo’s, the shapeless ones are nothing, and #99 is prose');
  });

  await test('a Depends on: line under markdown list or bold markers still reads (#103)', () => {
    const res = swept(issue(17, {
      body: '- Depends on: Omega-JS-Stack/omega#144\n\n**Depends on:** #6\n',
    }));
    assertEq(waits(res), 'Omega-JS-Stack/omega#144 ITW-Creative-Works/workkit#6',
      'issue bodies are markdown - a bullet or bold around the label is the same line');
  });

  await test('an issue depending on nothing carries an empty list, never a missing field', () => {
    const res = swept(issue(17, { body: 'no dependencies here' }));
    assertEq(Array.isArray(res.issues[0].blockedBy), true, 'the shape is always there');
    assertEq(res.issues[0].blockedBy.length, 0, 'and it is empty');
  });

  group('tower/board: the label vocabulary');

  await test('the group names come from the real workflow/labels.json', () => {
    const groups = labelGroups();
    assertEq(LABELS_FILE, path.join(REPO, 'workflow', 'labels.json'), 'points at the SSOT');
    for (const g of ['status', 'type', 'priority', 'agent']) {
      assert(groups.has(g), `${g} is a known group`);
    }
  });

  await test('status, type, priority and the agent flags parse; unknown groups are ignored', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 2,
              nodes: [
                issue(17, {
                  labels: labels('status:specced', 'type:enhancement', 'priority:high', 'agent:ok', 'agent:working', 'area:tower'),
                  assignees: assignees('ianwieds'),
                }),
                issue(18, { labels: labels('bug', 'wontfix') }),
              ],
            },
          },
        },
      }),
    });
    const [a, b] = res.issues;
    assertEq(a.status, 'specced', 'status');
    assertEq(a.type, 'enhancement', 'type');
    assertEq(a.priority, 'high', 'priority');
    assertEq(a.agentOk, true, 'agent:ok');
    assertEq(a.agentWorking, true, 'agent:working');
    assertEq(a.assignees.join(','), 'ianwieds', 'assignees are logins');
    assertEq(b.status, null, 'a bare label is not a group');
    assertEq(b.type, null, 'no type');
    assertEq(b.priority, null, 'absence of priority means normal');
    assertEq(b.agentOk, false, 'humans only');
  });

  // Documentation, not a vocabulary proof: parseLabels matches on the group
  // name and passes any status value through, so this case also passes without
  // the fifth label. The vocabulary itself is proven by the server and app
  // suites (MOVE_STATUSES, STATUSES).
  await test('status:building parses like any other status - in-flight work reaches the board', () => {
    const res = fetchBoard([ROSTER[0]], {
      exec: fakeGh({
        data: {
          r0: {
            issues: {
              totalCount: 1,
              nodes: [issue(17, { labels: labels('status:building', 'type:bug'), assignees: assignees('ianwieds') })],
            },
          },
        },
      }),
    });
    assertEq(res.issues[0].status, 'building', 'the status group passes the value through');
    assertEq(res.issues[0].assignees.join(','), 'ianwieds', 'and the assignee still says who holds it');
  });

  await test('an unparseable vocabulary file leaves every group unparsed rather than crashing', () => {
    const tmp = mkTmp();
    const file = path.join(tmp, 'labels.json');
    fs.writeFileSync(file, '{ not json');
    const res = fetchBoard([ROSTER[0]], {
      labelsFile: file,
      exec: fakeGh({ data: { r0: { issues: { totalCount: 1, nodes: [issue(17, { labels: labels('status:specced') })] } } } }),
    });
    assertEq(res.ok, true, 'still renders');
    assertEq(res.issues[0].status, null, 'no vocabulary, no groups');
    cleanup(tmp);
  });

  group('tower/board: truncation');

  await test('a repo with more open issues than the page cap is flagged truncated', () => {
    const nodes = Array.from({ length: 3 }, (_, i) => issue(i + 1));
    const res = fetchBoard(ROSTER, {
      exec: fakeGh({
        data: {
          r0: { issues: { totalCount: 140, nodes } },
          r1: { issues: { totalCount: 3, nodes } },
        },
      }),
    });
    assertEq(res.repos[0].truncated, true, 'r0 hit the cap');
    assertEq(res.repos[0].totalCount, 140, 'the real total is reported');
    assertEq(res.repos[0].count, 3, 'what actually came back');
    assertEq(res.repos[1].truncated, false, 'r1 is complete');
  });

  group('tower/board: the sweep is batched');

  // Issue #202: the whole roster in ONE request is what stopped working. At 23
  // repos GitHub answers RESOURCE_LIMITS_EXCEEDED - every issue node null, an
  // error per node - so the sweep asks for a handful of repos at a time and
  // merges. The aliases restart at r0 in every request, which is the thing that
  // can silently mis-attribute an issue, so the fake answers each request only
  // for the repos THAT request named.
  const bigRoster = (n) => Array.from({ length: n }, (_, i) => ({
    name: `repo${i}`, path: `/x/repo${i}`, slug: `owner/repo${i}`,
  }));

  /** A fake `gh` that reads each request's own aliases back out of the query. */
  const fakeBatched = (calls) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === '--version') return 'gh version 2.0.0\n';
    const query = args[args.length - 1];
    const data = {};
    const re = /(r\d+): repository\(owner: "[^"]+", name: "repo(\d+)"\)/g;
    let match = re.exec(query);
    while (match) {
      // The issue number IS the repo's index, so a merge that mapped an alias
      // back onto the wrong repo shows up as a mismatched pair.
      data[match[1]] = { issues: { totalCount: 1, nodes: [issue(Number(match[2]))] } };
      match = re.exec(query);
    }
    return JSON.stringify({ data });
  };

  await test('a roster longer than one batch is swept in one request per batch', () => {
    const calls = [];
    const res = fetchBoard(bigRoster(13), { exec: fakeBatched(calls) });
    assertEq(REPOS_PER_REQUEST, 6, 'the measured batch size (issue #202)');
    const queries = calls.filter((c) => c[1] === 'api');
    assertEq(queries.length, 3, '13 repos at 6 a request is three requests, never one');
    assertEq((queries[0][4].match(/repository\(/g) || []).length, REPOS_PER_REQUEST, 'the first request carries a full batch');
    assertEq((queries[2][4].match(/repository\(/g) || []).length, 1, 'and the last carries the remainder');
    assertEq(res.ok, true, 'ok');
  });

  await test('the batches merge back in roster order, each issue on the repo that answered it', () => {
    const res = fetchBoard(bigRoster(13), { exec: fakeBatched([]) });
    assertEq(res.repos.map((r) => r.slug).join(','), bigRoster(13).map((r) => r.slug).join(','),
      'every repo is reported once, in the order the roster names them');
    assertEq(res.issues.length, 13, 'and no batch was dropped');
    assertEq(res.issues.map((i) => `${i.repo}#${i.number}`).join(' '),
      bigRoster(13).map((r, i) => `${r.slug}#${i}`).join(' '),
      'the aliases restart per request, so this is what proves the offset is applied');
  });

  await test('a request that fails outright still fails the sweep, batches or not', () => {
    const res = fetchBoard(bigRoster(13), {
      exec: (cmd, args) => {
        if (args[0] === '--version') return 'gh version 2.0.0\n';
        throw execError('HTTP 502', { stderr: 'gateway' });
      },
    });
    assertEq(res.ok, false, 'nothing usable came back');
    assert(/502/.test(res.reason), 'and the underlying message survives');
  });

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
    assertEq(res.issues[0].repo, 'ianwieds/.dotfiles', 'and they are attributed correctly');
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
