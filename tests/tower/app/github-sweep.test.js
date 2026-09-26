//
// Tests for the tower dashboard's github.js: the sweep is the tower's own.
// The shared prologue (the lib loader, the fetch stub, the sweep fixture) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the sweep is the tower’s own');

  const apiBoard = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'board.js'));

  // Issue #195: the sweep's pure half - the document, the numbers that bound it,
  // the parse that turns one answered node into one board issue, and the reading
  // of the errors beside them - is ONE module now (libs/tower/sweep.js), which
  // board.js requires and github.js
  // imports. What used to be pinned value by value against a second copy is
  // asked once, as IDENTITY: a browser symbol that is not the very object the
  // tower runs is a copy that has grown back. What each of those functions
  // does is asked where it is now owned - the board suite - rather than twice.
  await test('both halves of the sweep run the one module, not two copies of it', () => {
    for (const name of ['buildBoardQuery', 'parseLabels', 'blockersFor', 'lastCommentOf', 'issueFrom', 'closedSince', 'errorsByAlias', 'firstErrorFor', 'droppedReason']) {
      assert(typeof github[name] === 'function', `${name} is reachable from the browser's half`);
      // `assert`, not `assertEq`: a function has no useful printed form, and
      // the question is object identity rather than a value that reads back.
      assert(github[name] === apiBoard[name], `${name} is the tower's own function, not a restatement of it`);
    }
    assertEq(github.MAX_OPEN_ISSUES, apiBoard.MAX_OPEN_ISSUES, 'and the ceiling is read off that module by both (#194)');
    assertEq(github.MAX_OPEN_ISSUES, 1000, 'the ceiling itself');
    assertEq(github.REPOS_PER_REQUEST, apiBoard.REPOS_PER_REQUEST, 'as is the batch size a request is cut to (#202)');
    assertEq(github.REPOS_PER_REQUEST, 6, 'the measured number itself');
  });

  await test('the browser normalizes an answer into exactly what /api/board serves', () => {
    const exec = (cmd, args) => {
      if (args[0] === '--version') return 'gh version 2';
      return JSON.stringify(SWEEP);
    };
    const fromTower = apiBoard.fetchBoard(SLUGS.map((slug) => ({ slug })), { exec, now: CLOSED_NOW });
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(JSON.stringify(fromBrowser), JSON.stringify(fromTower), 'one payload shape, whichever side read it');
    assertEq(fromBrowser.issues[0].status, 'building', 'the label vocabulary is parsed the same way');
    assertEq(fromBrowser.issues[0].agentOk, true, 'agent:ok included');
    assertEq(fromBrowser.repos[0].truncated, false,
      'a total ahead of the count is no longer truncation - the sweep pages, and GitHub said there was no next page (#194)');
    assertEq(fromBrowser.repos[1].error, 'Could not resolve to a Repository', 'and the unresolved repo carries its reason');
  });

  await test('every branch of what an issue waits on survives the browser’s normalization', () => {
    // The composition itself is one shared function (#195), so what is asked
    // here is that the fixture above exercises every branch of it - which is
    // what makes the JSON comparison a real proof rather than two empty lists
    // agreeing.
    const keys = (issue) => issue.blockedBy.map((blocker) => `${blocker.repo}#${blocker.number}`).join(',');
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(fromBrowser.issues[0].blockedBy.length, 0, 'an issue depending on nothing carries the empty list');
    assertEq(keys(fromBrowser.issues[1]), 'owner/gone#7,ITW-Creative-Works/workkit#81',
      'the unreadable-repo edge is carried whole, the closed one is satisfied, and the edge written both ways is one edge');
    assertEq(keys(fromBrowser.issues[2]), 'Omega-JS-Stack/omega#144',
      'a bulleted Depends on: line is the same line - issue bodies are markdown');
  });

  await test('the day’s closed count rides the sweep, and no closed issue enters the board', () => {
    const fromBrowser = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    assertEq(fromBrowser.repos[0].closedDay, 2, 'two of the four closed inside the last 24 hours');
    assertEq(fromBrowser.repos[1].closedDay, 0, 'a repo that did not resolve closed nothing');
    assertEq(fromBrowser.issues.length, 3, 'the issue list is the OPEN board and nothing else');
    assert(fromBrowser.issues.every((issue) => issue.status !== undefined), 'no closed issue rode in on the count');
  });

  await test('a closed issue one minute past the window is not this day’s', () => {
    // The edge is stated on both sides of it rather than computed: 23h59 in,
    // 24h01 out, at an instant this suite names.
    const one = (closedAt) => github.normalizeBoard(['o/r'], { r0: { issues: { totalCount: 0, nodes: [] }, closed: { nodes: [{ closedAt }] } } }, [], CLOSED_NOW).repos[0].closedDay;
    assertEq(one('2026-07-28T11:01:00Z'), 1, '23 hours 59 minutes ago counts');
    assertEq(one('2026-07-28T10:59:00Z'), 0, '24 hours 1 minute ago does not');
    assertEq(one('2026-07-30T11:00:00Z'), 0, 'and neither does a stamp from the future');
    assertEq(one('not a date'), 0, 'nor one that is not a stamp');
  });

  await test('the label groups the browser knows are the vocabulary’s own', () => {
    const groups = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'labels.json'), 'utf8')).groups);
    assertEq([...github.LABEL_GROUPS].sort().join(','), groups.sort().join(','),
      'a group defined in the SSOT and missing here would be a group the published board cannot show');
  });

  await test('the newest comment rides the sweep folded to one line and cut where a card ends', () => {
    // Issue #196: the sweep carries a blocked issue's open question, which is
    // its last comment. The fold is the shared module's (#195); what is asked
    // here is that a browser board actually carries it.
    const one = (body) => ({ data: { r0: { issues: { totalCount: 1, nodes: [{ number: 1, labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 1, nodes: [{ body }] } }] } } } });
    const long = 'z'.repeat(300);
    const fromBrowser = github.normalizeBoard(['o/r'], one('Which one?\nSay the word.').data, []).issues[0];
    assertEq(fromBrowser.lastComment, 'Which one? Say the word.', 'the comment as one line');
    const cutBrowser = github.normalizeBoard(['o/r'], one(long).data, []).issues[0].lastComment;
    assertEq(cutBrowser.length, 281, 'cut at the same 280 characters, plus the ellipsis that says it was');
    assert(cutBrowser.endsWith('…'), 'never stopping mid-word in silence');
    assertEq(github.normalizeBoard(['o/r'], one('').data, []).issues[0].lastComment, '',
      'and an issue nobody has commented on carries the empty string');
  });

  await test('a body over the limit is cut and flagged, the same as the tower’s', () => {
    const long = { data: { r0: { issues: { totalCount: 1, nodes: [{ number: 1, body: 'x'.repeat(5000), labels: { nodes: [] }, assignees: { nodes: [] }, comments: { totalCount: 0 } }] } } } };
    const issue = github.normalizeBoard(['o/r'], long.data, []).issues[0];
    assertEq(issue.body.length, 4000, 'cut at the same 4,000 characters');
    assertEq(issue.bodyTruncated, true, 'and never cut silently');
  });

  // Issue #202: the whole roster in one request is what GitHub refuses, so both
  // halves of the sweep ask a batch at a time. The browser's requests go out
  // together - a page has no cache in front of it and nothing to serialize for -
  // and the aliases restart at r0 in every one of them, which is what the merge
  // has to get right.
  await test('a roster longer than one batch goes out as one request per batch, merged in order', async () => {
    const slugs = Array.from({ length: 13 }, (_, i) => `owner/repo${i}`);
    // Each request is answered only for the aliases IT named, which is what
    // makes a merge that ignored the offset visible: the issue number is the
    // repo's index, so a mis-mapped alias is a mismatched pair.
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
    assertEq(fetchImpl.calls.length, 3, '13 repos at 6 a request is three requests, never one');
    assertEq(board.repos.map((repo) => repo.slug).join(','), slugs.join(','), 'every repo once, in roster order');
    assertEq(board.issues.map((issue) => `${issue.repo}#${issue.number}`).join(' '),
      slugs.map((slug, i) => `${slug}#${i}`).join(' '),
      'and each issue on the repo whose batch answered it');
  });

  await test('one refused request fails the sweep rather than half-drawing the board', async () => {
    const slugs = Array.from({ length: 13 }, (_, i) => `owner/repo${i}`);
    let sent = 0;
    const fetchImpl = mkFetch(() => {
      sent += 1;
      return sent === 2 ? jsonResponse(401, { message: 'Bad credentials' }) : jsonResponse(200, { data: {} });
    });
    const board = await github.fetchBoard(slugs, { token: 't', fetch: fetchImpl });
    assertEq(board.ok, false, 'a board missing a batch is not a board');
    assertEq(board.status, 401, 'and the status survives, so Settings can say the token is the problem');
  });

  // Issue #194: GitHub caps a connection page at 100, so a repo past that is
  // asked again with the cursor its last page ended on - and the published copy
  // draws each page as it lands rather than making the viewer wait for the last.

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

  await test('a repo with another page is asked again with the cursor, and only that repo', async () => {
    const script = pageScript();
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(script, JSON.parse(options.body).query)));
    const board = await github.fetchBoard(['owner/big', 'owner/small'], { token: 't', fetch: fetchImpl });
    assertEq(fetchImpl.calls.length, 2, 'the batch, then one continuation');
    const second = JSON.parse(fetchImpl.calls[1].options.body).query;
    assert(second.includes('after: "CUR1"'), 'the second ask carries the cursor the first page ended on');
    assert(second.includes('name: "big"') && !second.includes('name: "small"'), 'and names only the repo that had more');
    assertEq(board.repos[0].count, 3, 'both pages are on the board');
    assertEq(board.repos[0].truncated, false, 'a repo swept to the end is not truncated');
    assertEq(board.issues.map((issue) => `${issue.repo}#${issue.number}`).join(' '),
      'owner/big#1 owner/big#2 owner/big#3 owner/small#9',
      'a repo’s pages stay together, and the roster order is kept');
  });

  await test('each page lands as it arrives, marked as still loading until the sweep is done', async () => {
    const script = pageScript();
    const seen = [];
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(script, JSON.parse(options.body).query)));
    const board = await github.fetchBoard(['owner/big', 'owner/small'], {
      token: 't', fetch: fetchImpl, onPage: (partial) => seen.push(partial),
    });
    assertEq(seen.length, 1, 'the first pages are handed over before the second is asked for');
    assertEq(seen[0].issues.length, 3, 'with everything that had arrived by then');
    assertEq(seen[0].repos[0].loading, true, 'the repo still being paged says so, which is what the progress line reads');
    assertEq(seen[0].repos[0].count, 2, 'showing how many of');
    assertEq(seen[0].repos[0].totalCount, 3, 'how many it is holding');
    assert(!seen[0].repos[1].loading, 'a repo that was exhausted on its first page is not loading');
    assert(board.repos.every((repo) => repo.loading === undefined),
      'and the finished board carries no progress at all - the line clears by being absent');
  });

  await test('a single-page sweep hands nothing over mid-flight - there is no progress to draw', async () => {
    let handed = 0;
    const fetchImpl = mkFetch((url, options) => jsonResponse(200, answerFor(pageScript(), JSON.parse(options.body).query)));
    await github.fetchBoard(['owner/small'], { token: 't', fetch: fetchImpl, onPage: () => { handed += 1; } });
    assertEq(handed, 0, 'a board that arrived whole is drawn once, by the read landing');
  });

  await test('the ceiling stops the browser’s sweep too, and the repo says it was cut', async () => {
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
    assertEq(board.repos[0].count, github.MAX_OPEN_ISSUES, 'the sweep stops at the ceiling rather than paging forever');
    assertEq(board.repos[0].truncated, true, 'and the repo says there is more it did not carry');
    assertEq(fetchImpl.calls.length, github.MAX_OPEN_ISSUES / 100, 'no request past the ceiling');
  });

  await test('a paged sweep ends in exactly the payload the tower serves', async () => {
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
    assertEq(JSON.stringify(fromBrowser), JSON.stringify(fromTower), 'one payload shape, however many pages it took');
  });

  await test('a null issue node is skipped on both sides, and the repo says what was dropped', () => {
    // The crash itself (#202): GitHub answers the shape of the board with every
    // issue node null. Reading a field off one of those ended the tower's API.
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
    assertEq(fromBrowser.issues.length, 1, 'the nulls are skipped rather than thrown on');
    assertEq(fromBrowser.repos[0].error, 'GitHub dropped 2 of 3 issues: the query exceeded a limit',
      'and the drop is on the repo entry, where the Overview’s warning reads it');
    assertEq(JSON.stringify(fromBrowser), JSON.stringify(fromTower), 'the two halves drop it identically');
  });

  await test('an empty roster is an empty board, not a request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const board = await github.fetchBoard([], { token: 't', fetch: fetchImpl });
    assertEq(board.ok, true, 'a site that sweeps nothing is not a failure');
    assertEq(fetchImpl.calls.length, 0, 'and nothing went out');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
