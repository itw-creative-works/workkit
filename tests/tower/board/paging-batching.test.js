//
// Tests for tower/api/lib/board.js: paging past the first page (the cursor,
// the ceiling, the loops that must stop) and the sweep batched a handful
// of repos per request.
// The shared prologue (the fake gh, the issue and label builders, the roster, the module under test) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  fetchBoard, PAGE_SIZE, MAX_OPEN_ISSUES, REPOS_PER_REQUEST, issue, ROSTER,
} = require('./helpers');

const run = async () => {
  group('tower/board: paging past the first page');

  // Issue #194: GitHub caps one connection page at 100, so a repo past that is
  // asked again with the cursor its last page ended on - and only that repo,
  // since the rest of the batch was already exhausted.

  /**
   * A fake `gh` that answers each request from a per-alias script.
   *
   * `pages` is keyed by repo slug and holds that repo's answers in order, so a
   * repo asked twice gets its second page on the second ask. The query is read
   * back for the aliases it names, which is what makes a request for the WRONG
   * repo - or one that forgot the cursor - visible.
   */
  const fakePaged = (pages, calls = []) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === '--version') return 'gh version 2.0.0\n';
    const query = args[args.length - 1];
    const data = {};
    const re = /(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
    let match = re.exec(query);
    while (match) {
      const slug = `${match[2]}/${match[3]}`;
      data[match[1]] = { issues: (pages[slug] || []).shift() || { totalCount: 0, nodes: [] } };
      match = re.exec(query);
    }
    return JSON.stringify({ data });
  };

  /** One connection page: its nodes, its total, and whether another follows. */
  const conn = (numbers, { total = numbers.length, next = null } = {}) => ({
    totalCount: total,
    pageInfo: { hasNextPage: Boolean(next), endCursor: next },
    nodes: numbers.map((n) => issue(n)),
  });

  await test('a repo with another page is asked again with the cursor, and only that repo', () => {
    const calls = [];
    const res = fetchBoard(ROSTER, {
      exec: fakePaged({
        'ITW-Creative-Works/workkit': [conn([1, 2], { total: 4, next: 'CUR1' }), conn([3, 4], { total: 4 })],
        'alice/.dotfiles': [conn([9])],
      }, calls),
    });
    const queries = calls.filter((c) => c[1] === 'api').map((c) => c[c.length - 1]);
    assertEq(queries.length, 2, 'the batch, then one continuation');
    assert(queries[1].includes('after: "CUR1"'), 'the second ask carries the cursor the first page ended on');
    assert(queries[1].includes('name: "workkit"') && !queries[1].includes('name: ".dotfiles"'),
      'and names only the repo that had more');
    assertEq(res.repos[0].count, 4, 'both pages are on the board');
    assertEq(res.repos[0].truncated, false, 'a repo swept to the end is not truncated');
    assertEq(res.issues.map((i) => i.number).join(','), '1,2,3,4,9',
      'a repo\u2019s pages stay together, and the roster order is kept');
  });

  await test('a total ahead of the count is no longer truncation - only the ceiling is', () => {
    const res = fetchBoard(ROSTER, {
      exec: fakePaged({
        'ITW-Creative-Works/workkit': [conn([1, 2, 3], { total: 140 })],
        'alice/.dotfiles': [conn([9], { total: 1 })],
      }),
    });
    assertEq(res.repos[0].truncated, false, 'GitHub said there was no next page, whatever the total claims');
    assertEq(res.repos[0].totalCount, 140, 'the real total is still reported');
    assertEq(res.repos[0].count, 3, 'and what actually came back');
  });

  await test('the ceiling stops the sweep and the repo says it was cut', () => {
    const calls = [];
    // Every page says another follows, so nothing but the ceiling can end it.
    const endless = { shift: () => conn(Array.from({ length: PAGE_SIZE }, (_, i) => i + 1), { total: 5000, next: 'MORE' }) };
    const res = fetchBoard([ROSTER[0]], { exec: fakePaged({ 'ITW-Creative-Works/workkit': endless }, calls) });
    assertEq(MAX_OPEN_ISSUES, 1000, 'the ceiling both halves of the sweep hold');
    assertEq(res.repos[0].count, MAX_OPEN_ISSUES, 'the sweep stops at it rather than paging forever');
    assertEq(res.repos[0].truncated, true, 'and the repo says there is more it did not carry');
    assertEq(calls.filter((c) => c[1] === 'api').length, MAX_OPEN_ISSUES / PAGE_SIZE, 'no request past the ceiling');
  });

  await test('an answer claiming more pages without saying where stops rather than looping', () => {
    // The loop's own footgun: `hasNextPage` with no cursor beside it would have
    // it re-read the same page forever, inside a request the dashboard is
    // waiting on. The fake gives up after fifty asks so a regression fails here
    // instead of hanging the suite.
    let asked = 0;
    const res = fetchBoard([ROSTER[0]], {
      exec: (cmd, args) => {
        if (args[0] === '--version') return 'gh version 2.0.0\n';
        asked += 1;
        if (asked > 50) throw new Error('the sweep never stopped asking');
        return JSON.stringify({
          data: { r0: { issues: { totalCount: 9, pageInfo: { hasNextPage: true, endCursor: null }, nodes: [issue(1)] } } },
        });
      },
    });
    assertEq(asked, 1, 'asked once and stopped - there was nowhere to resume from');
    assertEq(res.repos[0].truncated, true, 'and the repo still says there is more it did not carry');
  });

  await test('a page that resumes where the last one did stops rather than looping', () => {
    // The other footgun the cursor guard does not cover: an answer that claims
    // more pages, hands back the cursor it was ASKED with, and carries nothing.
    // Neither the resume point nor `nodes.length` moves, so the ceiling never
    // arrives either and the loop the API drives its sweep with would turn
    // forever. A round that moved nothing is the tell, and the fake gives up
    // after fifty asks so a regression fails here instead of hanging the suite.
    let asked = 0;
    const res = fetchBoard([ROSTER[0]], {
      exec: (cmd, args) => {
        if (args[0] === '--version') return 'gh version 2.0.0\n';
        asked += 1;
        if (asked > 50) throw new Error('the sweep never stopped asking');
        return JSON.stringify({
          data: { r0: { issues: {
            totalCount: 9,
            pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
            nodes: asked === 1 ? [issue(1)] : [],
          } } },
        });
      },
    });
    assertEq(asked, 2, 'the first page, one continuation, and no more - the cursor had not moved');
    assertEq(res.repos[0].count, 1, 'the page that arrived is kept');
    assertEq(res.repos[0].truncated, true, 'and the repo still says there is more it did not carry');
  });

  await test('a continuation that fails keeps the pages that arrived and says why', () => {
    // The first page is already drawn; blanking the whole board because page
    // two of one repo failed would throw away every other repo's answer too.
    let asked = 0;
    const res = fetchBoard(ROSTER, {
      exec: (cmd, args) => {
        if (args[0] === '--version') return 'gh version 2.0.0\n';
        asked += 1;
        if (asked === 1) {
          return JSON.stringify({
            data: {
              r0: { issues: conn([1, 2], { total: 4, next: 'CUR1' }) },
              r1: { issues: conn([9]) },
            },
          });
        }
        throw execError('HTTP 502', { stderr: 'gateway' });
      },
    });
    assertEq(res.ok, true, 'the board still renders');
    assertEq(res.repos[0].count, 2, 'the page that arrived is kept');
    assert(/502/.test(res.repos[0].error), `the repo carries the reason, got: ${res.repos[0].error}`);
    assertEq(res.repos[1].error, null, 'and the repo that answered whole carries none');
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
    assertEq((queries[0][queries[0].length - 1].match(/repository\(/g) || []).length, REPOS_PER_REQUEST, 'the first request carries a full batch');
    assertEq((queries[2][queries[2].length - 1].match(/repository\(/g) || []).length, 1, 'and the last carries the remainder');
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
