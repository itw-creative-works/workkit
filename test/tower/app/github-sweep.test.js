//
// Tests for the tower dashboard's github.js: the sweep is the tower's own.
// The shared prologue (the lib loader, the fetch stub, the sweep fixture) is ./helpers.js.
//

const path = require('path');
const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW } = require('./helpers');

describe('tower/app: github - the sweep is the tower’s own', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  const apiBoard = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'board.js'));

  test('every branch of what an issue waits on survives the browser’s normalization', () => {
    // The composition is one shared function, so this asks that the fixture
    // exercises every branch of it: two empty lists agreeing prove nothing.
    const keys = (issue) => issue.blockedBy.map((blocker) => `${blocker.repo}#${blocker.number}`).join(',');
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    expect(fromBrowser.issues[0].blockedBy.length, 'an issue depending on nothing carries the empty list').toBe(0);
    expect(keys(fromBrowser.issues[1]), 'the unreadable-repo edge is carried whole, the closed one is satisfied, and the edge written both ways is one edge').toBe('owner/gone#7,ITW-Creative-Works/workkit#81');
    expect(keys(fromBrowser.issues[2]), 'a bulleted Depends on: line is the same line - issue bodies are markdown').toBe('Omega-JS-Stack/omega#144');
  });

  test('the day’s closed count rides the sweep, and no closed issue enters the board', () => {
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    expect(fromBrowser.repos[0].closedDay, 'two of the four closed inside the last 24 hours').toBe(2);
    expect(fromBrowser.repos[1].closedDay, 'a repo that did not resolve closed nothing').toBe(0);
    expect(fromBrowser.issues.length, 'the issue list is the OPEN board and nothing else').toBe(3);
    expect(fromBrowser.issues.every((issue) => issue.status !== undefined), 'no closed issue rode in on the count').toBeTruthy();
  });

  test('a closed issue one minute past the window is not this day’s', () => {
    // The edge is stated on both sides of it rather than computed: 23h59 in,
    // 24h01 out, at an instant this suite names.
    const one = (closedAt) => github.normalizeBoard(['o/r'], { r0: { issues: { totalCount: 0, nodes: [] }, closed: { nodes: [{ closedAt }] } } }, [], CLOSED_NOW).repos[0].closedDay;
    expect(one('2026-07-28T11:01:00Z'), '23 hours 59 minutes ago counts').toBe(1);
    expect(one('2026-07-28T10:59:00Z'), '24 hours 1 minute ago does not').toBe(0);
    expect(one('2026-07-30T11:00:00Z'), 'and neither does a stamp from the future').toBe(0);
    expect(one('not a date'), 'nor one that is not a stamp').toBe(0);
  });

  test('the newest comment rides the sweep folded to one line and cut where a card ends', () => {
    // A blocked issue's open question is its last comment; the fold is the
    // shared module's, so this asks only that a browser board carries it.
    const one = (body) => ({ data: { r0: { issues: { totalCount: 1, nodes: [{ number: 1, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 1, nodes: [{ body }] } }] } } } });
    const long = 'z'.repeat(300);
    const fromBrowser = github.normalizeBoard(['o/r'], one('Which one?\nSay the word.').data, []).issues[0];
    expect(fromBrowser.lastComment, 'the comment as one line').toBe('Which one? Say the word.');
    const cutBrowser = github.normalizeBoard(['o/r'], one(long).data, []).issues[0].lastComment;
    expect(cutBrowser.length, 'cut at the same 280 characters, plus the ellipsis that says it was').toBe(281);
    expect(cutBrowser.endsWith('…'), 'never stopping mid-word in silence').toBeTruthy();
    expect(github.normalizeBoard(['o/r'], one('').data, []).issues[0].lastComment, 'and an issue nobody has commented on carries the empty string').toBe('');
  });

  test('a body over the limit is cut and flagged, the same as the tower’s', () => {
    const long = { data: { r0: { issues: { totalCount: 1, nodes: [{ number: 1, body: 'x'.repeat(5000), labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 0 } }] } } } };
    const issue = github.normalizeBoard(['o/r'], long.data, []).issues[0];
    expect(issue.body.length, 'cut at the same 4,000 characters').toBe(4000);
    expect(issue.bodyTruncated, 'and never cut silently').toBe(true);
  });

  // GitHub refuses the whole roster in one request, so both halves ask a batch
  // at a time. The browser's batches go out together, and the aliases restart at
  // r0 in every one of them, which the merge has to get right.
  test('a roster longer than one batch goes out as one request per batch, merged in order', async () => {
    const slugs = Array.from({ length: 13 }, (_, i) => `owner/repo${i}`);
    // Each request is answered only for the aliases it named, which makes a
    // merge that ignored the offset visible: the issue number is the repo's
    // index, so a mis-mapped alias is a mismatched pair.
    const fetchImpl = mkFetch((url, options) => {
      const query = JSON.parse(options.body).query;
      const data = {};
      const re = /(r\d+): repository\(owner: "[^"]+", name: "repo(\d+)"\)/g;
      let match = re.exec(query);
      while (match) {
        data[match[1]] = { issues: { totalCount: 1, nodes: [{ number: Number(match[2]), labels: { nodes: [] }, assignees: { nodes: [] } }] } };
        match = re.exec(query);
      }
      return jsonResponse(200, { data });
    });
    const board = await github.fetchBoard(slugs, { token: 't', fetch: fetchImpl });
    expect(fetchImpl.calls.length, '13 repos at 6 a request is three requests, never one').toBe(3);
    expect(board.repos.map((repo) => repo.slug).join(','), 'every repo once, in roster order').toBe(slugs.join(','));
    expect(board.issues.map((issue) => `${issue.repo}#${issue.number}`).join(' '), 'and each issue on the repo whose batch answered it').toBe(slugs.map((slug, i) => `${slug}#${i}`).join(' '));
  });

  test('one refused request fails the sweep rather than half-drawing the board', async () => {
    const slugs = Array.from({ length: 13 }, (_, i) => `owner/repo${i}`);
    let sent = 0;
    const fetchImpl = mkFetch(() => {
      sent += 1;
      return sent === 2 ? jsonResponse(401, { message: 'Bad credentials' }) : jsonResponse(200, { data: {} });
    });
    const board = await github.fetchBoard(slugs, { token: 't', fetch: fetchImpl });
    expect(board.ok, 'a board missing a batch is not a board').toBe(false);
    expect(board.status, 'and the status survives, so Settings can say the token is the problem').toBe(401);
  });

  // GitHub caps a connection page at 100, so a repo past that is asked again
  // with the cursor its last page ended on, and the published copy draws each
  // page as it lands.

  /** One connection page: its nodes, its total, and whether another follows. */
  const connPage = (numbers, { total = numbers.length, next = null } = {}) => ({
    totalCount: total,
    pageInfo: { hasNextPage: Boolean(next), endCursor: next },
    nodes: numbers.map((number) => ({ number, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 0 } })),
  });

  /** A repo's pages, in the order it will be asked for them - fresh per side. */
  const pageScript = () => ({
    'owner/big': [connPage([1, 2], { total: 3, next: 'CUR1' }), connPage([3], { total: 3 })],
    'owner/small': [connPage([9])],
  });

  /** The aliases one document names, mapped to the slug each stands for. */
  const aliasesOf = (query) => {
    const out = [];
    const re = /(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g;
    let match = re.exec(query);
    while (match) {
      out.push([match[1], `${match[2]}/${match[3]}`]);
      match = re.exec(query);
    }
    return out;
  };

  /** The answer to one document, taking each named repo's next page off the script. */
  const answerFor = (script, query) => {
    const data = {};
    for (const [alias, slug] of aliasesOf(query)) {
      data[alias] = { issues: (script[slug] || []).shift() || connPage([]) };
    }
    return { data };
  };

  test('a repo with another page is asked again with the cursor, and only that repo', async () => {
    const script = pageScript();
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(script, JSON.parse(options.body).query)));
    const board = await github.fetchBoard(['owner/big', 'owner/small'], { token: 't', fetch: fetchImpl });
    expect(fetchImpl.calls.length, 'the batch, then one continuation').toBe(2);
    const second = JSON.parse(fetchImpl.calls[1].options.body).query;
    expect(second.includes('after: "CUR1"'), 'the second ask carries the cursor the first page ended on').toBeTruthy();
    expect(second.includes('name: "big"') && !second.includes('name: "small"'), 'and names only the repo that had more').toBeTruthy();
    expect(board.repos[0].count, 'both pages are on the board').toBe(3);
    expect(board.repos[0].truncated, 'a repo swept to the end is not truncated').toBe(false);
    expect(board.issues.map((issue) => `${issue.repo}#${issue.number}`).join(' '), 'a repo’s pages stay together, and the roster order is kept').toBe('owner/big#1 owner/big#2 owner/big#3 owner/small#9');
  });

  test('each page lands as it arrives, marked as still loading until the sweep is done', async () => {
    const script = pageScript();
    const seen = [];
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(script, JSON.parse(options.body).query)));
    const board = await github.fetchBoard(['owner/big', 'owner/small'], {
      token: 't', fetch: fetchImpl, onPage: (partial) => seen.push(partial),
    });
    expect(seen.length, 'the first pages are handed over before the second is asked for').toBe(1);
    expect(seen[0].issues.length, 'with everything that had arrived by then').toBe(3);
    expect(seen[0].repos[0].loading, 'the repo still being paged says so, which is what the progress line reads').toBe(true);
    expect(seen[0].repos[0].count, 'showing how many of').toBe(2);
    expect(seen[0].repos[0].totalCount, 'how many it is holding').toBe(3);
    expect(!seen[0].repos[1].loading, 'a repo that was exhausted on its first page is not loading').toBeTruthy();
    expect(board.repos.every((repo) => repo.loading === undefined),
      'and the finished board carries no progress at all - the line clears by being absent').toBeTruthy();
  });

  test('a single-page sweep hands nothing over mid-flight - there is no progress to draw', async () => {
    let handed = 0;
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(pageScript(), JSON.parse(options.body).query)));
    await github.fetchBoard(['owner/small'], { token: 't', fetch: fetchImpl, onPage: () => { handed += 1; } });
    expect(handed, 'a board that arrived whole is drawn once, by the read landing').toBe(0);
  });

  test('the ceiling stops the browser’s sweep too, and the repo says it was cut', async () => {
    // Every page says another follows, so nothing but the ceiling can end it.
    const full = Array.from({ length: 100 }, (_, i) => i + 1);
    const fetchImpl = mkFetch((url, options) => {
      const data = {};
      for (const [alias] of aliasesOf(JSON.parse(options.body).query)) {
        data[alias] = { issues: connPage(full, { total: 5000, next: 'MORE' }) };
      }
      return jsonResponse(200, { data });
    });
    const board = await github.fetchBoard(['owner/big'], { token: 't', fetch: fetchImpl });
    expect(board.repos[0].count, 'the sweep stops at the ceiling rather than paging forever').toBe(github.MAX_OPEN_ISSUES);
    expect(board.repos[0].truncated, 'and the repo says there is more it did not carry').toBe(true);
    expect(fetchImpl.calls.length, 'no request past the ceiling').toBe(github.MAX_OPEN_ISSUES / 100);
  });

  test('a paged sweep ends in exactly the payload the tower serves', async () => {
    // The parity that matters most once there is more than one request per repo:
    // both halves have to merge the pages into the same list, in the same order.
    const browserScript = pageScript();
    const towerScript = pageScript();
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(browserScript, JSON.parse(options.body).query)));
    const fromBrowser = await github.fetchBoard(['owner/big', 'owner/small'], { token: 't', fetch: fetchImpl, now: CLOSED_NOW });
    const fromTower = apiBoard.fetchBoard([{ slug: 'owner/big' }, { slug: 'owner/small' }], {
      exec: (cmd, args) => (args[0] === '--version' ? 'gh version 2' : JSON.stringify(answerFor(towerScript, args[args.length - 1]))),
      now: CLOSED_NOW,
    });
    expect(JSON.stringify(fromBrowser), 'one payload shape, however many pages it took').toBe(JSON.stringify(fromTower));
  });

  test('a null issue node is skipped on both sides, and the repo says what was dropped', () => {
    // GitHub can answer the board's shape with every issue node null, and
    // reading a field off one must not end the tower's API.
    const dropped = {
      data: {
        r0: {
          issues: {
            totalCount: 3,
            nodes: [{ number: 17, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 0 } }, null, null],
          },
        },
      },
      errors: [
        { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 1], message: 'the query exceeded a limit' },
        { type: 'RESOURCE_LIMITS_EXCEEDED', path: ['r0', 'issues', 'nodes', 2], message: 'and again' },
      ],
    };
    const fromBrowser = github.normalizeBoard(['o/r'], dropped.data, dropped.errors, CLOSED_NOW);
    const fromTower = apiBoard.fetchBoard([{ slug: 'o/r' }], {
      exec: (cmd, args) => (args[0] === '--version' ? 'gh version 2' : JSON.stringify(dropped)),
      now: CLOSED_NOW,
    });
    expect(fromBrowser.issues.length, 'the nulls are skipped rather than thrown on').toBe(1);
    expect(fromBrowser.repos[0].error, 'and the drop is on the repo entry, where the Overview’s warning reads it').toBe('GitHub dropped 2 of 3 issues: the query exceeded a limit');
    expect(JSON.stringify(fromBrowser), 'the two halves drop it identically').toBe(JSON.stringify(fromTower));
  });

  test('an empty roster is an empty board, not a request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const board = await github.fetchBoard([], { token: 't', fetch: fetchImpl });
    expect(board.ok, 'a site that sweeps nothing is not a failure').toBe(true);
    expect(fetchImpl.calls.length, 'and nothing went out').toBe(0);
  });
});
