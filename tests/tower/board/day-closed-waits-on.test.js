//
// Tests for tower/api/lib/board.js: what the day closed (the per-repo count
// of issues closed in the last 24 hours) and what an issue waits on (the
// native dependency edges merged with the inline `Depends on:` line).
// The shared prologue (the fake gh, the issue and label builders, the roster, the module under test) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fetchBoard, buildBoardQuery, CLOSED_PAGE, issue, fakeGh, ROSTER } = require('./helpers');

const run = async () => {
  group('tower/board: what the day closed');

  // Issue #55: the sweep gains a COUNT of the issues closed in the last 24
  // hours, per repo - never the closed issues themselves. The clock is stated,
  // because a 24-hour window judged at whatever moment the suite runs is a
  // window no fixture can sit either side of.
  const NOW = Date.parse('2026-07-29T11:00:00Z');
  const closedAt = (...stamps) => ({ nodes: stamps.map((stamp) => ({ closedAt: stamp })) });

  await test('the query asks each repo for its recently closed issues, and only their stamps', () => {
    const q = buildBoardQuery(['ITW-Creative-Works/workkit']);
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
    const q = buildBoardQuery(['ITW-Creative-Works/workkit']);
    assert(q.includes('blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }'),
      `the dependency edges ride the one sweep, state and all: ${q}`);
  });

  await test('an open edge is a blocker; a closed one is satisfied and never surfaces', () => {
    const res = swept(issue(17, {
      blockedBy: blockedBy([4, 'OPEN'], [5, 'CLOSED'], [9, 'OPEN', 'alice/.dotfiles']),
    }));
    assertEq(waits(res), 'ITW-Creative-Works/workkit#4 alice/.dotfiles#9',
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
