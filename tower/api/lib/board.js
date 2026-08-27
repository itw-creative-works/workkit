//
// The cross-repo issue sweep — the board's data, in one call.
//
// Every opted-in repo's open issues arrive from `gh api graphql` using per-repo
// aliases (`r0:`, `r1:`, …), a BATCH of repos to a request. Batching instead of
// one request per repo is most of the point: the board is polled, and a roster
// of a dozen repos would otherwise be a dozen round trips and a dozen
// rate-limit hits every refresh. Asking for the whole roster at once is the
// other half — GitHub refuses a query that is too much work in one go
// (REPOS_PER_REQUEST says what that cost), and the aliases restart at `r0` in
// every request, so a batch is mapped back onto the roster by its offset.
//
// The sweep's PURE half is not written here at all: the document, the numbers
// that bound it, the parse that turns a node into a board issue and the reading
// of the errors beside them live in the app's `libs/tower/sweep.js`, which the
// published copy of the dashboard also
// imports (issue #195). This file is the machine's transport around it, and
// nothing else. That module is an ES module and this one is not — Node 22
// `require()`s it directly.
//
// The label vocabulary is not restated here either. Group names come from
// workflow/labels.json — the SSOT the standards heal also reads — so a new
// group appears in the parse the moment it is defined there, and a value list
// never drifts between the two files.
//
// `gh` missing or unauthenticated is a SOFT skip, matching workflow/standards.sh:
// the caller gets `{ ok: false, reason }` and an empty list, never an exception.
// The tower has to render on a machine where `gh auth` has lapsed. Only the
// MISSING binary is pre-checked (`gh --version`, local and free); auth is judged
// from the sweep's own failure, because `gh auth status` is a network round trip
// and paying for it on every poll to learn what the next call is about to say
// costs a request per refresh for nothing.
//
// A PARTIAL answer is kept. GraphQL returns data and errors together — a repo
// that was renamed, or one the token cannot see, resolves to null while every
// other alias comes back complete — and `gh` exits non-zero whenever an errors
// array is present, putting that complete payload on the error's stdout. So a
// failed exit is parsed before it is believed: if there is data in it, the board
// renders what resolved and the repos that did not carry their reason. Treating
// that exit as total failure would blank the whole board over one bad repo.
//
// The sweep is STEPWISE. `startSweep` takes the first page of every repo and
// hands back a handle on the rest, so the API can answer with what has arrived
// and go on paging behind the answer (issue #194): the dashboard on this machine
// draws each page as it lands, exactly as a published copy does. `fetchBoard` is
// that handle run to the end, and stays what a caller wanting the whole board in
// one call uses.
//
// Usage:
//   const { fetchBoard, startSweep } = require('./board');
//   fetchBoard(discoverRepos());          // live, the whole board in one call
//   fetchBoard(repos, { exec: fake });    // offline, against a fixture payload
//   const s = startSweep(repos);          // page by page: s.board(), s.paging(), s.step()
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The sweep's pure half, shared with the published dashboard (issue #195). An
// ES module, reached by the relative path the cloud brief's runner preserves.
const {
  buildBoardQuery, parseLabels, blockersFor, lastCommentOf, issueFrom, closedSince,
  errorsByAlias, firstErrorFor, droppedReason,
  PAGE_SIZE, MAX_OPEN_ISSUES, REPOS_PER_REQUEST, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, CLOSED_WINDOW_MS,
} = require('../../app/targets/web/src/assets/js/libs/tower/sweep.js');

const LABELS_FILE = path.join(__dirname, '..', '..', '..', 'workflow', 'labels.json');

// stderr is piped, not ignored: gh writes its "gh auth login" guidance there,
// and failureReason needs that text to name an auth failure as one.
const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...opts,
});

/** The label group names, from the vocabulary SSOT. */
const labelGroups = (file = LABELS_FILE) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(Object.keys(parsed.groups || {}));
  } catch {
    return new Set();
  }
};

/** JSON, or null when the text is not JSON (or is not there at all). */
const tryParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Why the sweep produced nothing usable, in the caller's terms. */
const failureReason = (err) => {
  // A bad token surfaces on stdout ({"message":"Bad credentials","status":"401"})
  // with nothing useful on stderr, so both streams join the haystack.
  const text = `${err.stderr || ''}\n${err.stdout || ''}\n${err.message || ''}`;
  if (/not logged in|authentication|auth status|HTTP 401|gh auth login|Bad credentials|"status": ?"401"/i.test(text)) {
    return 'gh not authenticated';
  }
  return `gh graphql failed: ${err.message}`;
};

/**
 * One `gh api graphql` round trip, believed even when the exit code says no.
 *
 * A non-zero exit still carries the response: `gh` fails whenever an errors
 * array is present, and a roster with one bad repo is exactly that shape. So
 * the payload decides, never the exit code — and only a payload with no data
 * in it at all is a failure to report.
 *
 * @param {Function} exec the `gh` seam
 * @param {string} query the document to send
 * @returns {{payload: object|null, reason: string|null}}
 */
const ask = (exec, query) => {
  try {
    const payload = tryParse(exec('gh', ['api', 'graphql', '-f', `query=${query}`]));
    return payload && payload.data ? { payload, reason: null } : { payload: null, reason: 'gh graphql returned no data' };
  } catch (err) {
    const payload = tryParse(err.stdout ? String(err.stdout) : '');
    return payload && payload.data ? { payload, reason: null } : { payload: null, reason: failureReason(err) };
  }
};

/**
 * Fold one answered PAGE into what the sweep has collected for that repo.
 *
 * The first answer is the one that carries the repo's facts — its total and its
 * closed page — because every later page repeats them for the same repo, and
 * the first reason anything went wrong is the one kept: the failure this guards
 * against answers with an error per dropped node (issue #202), and a later page
 * saying it again adds nothing.
 *
 * @param {object} entry what has been collected for this repo so far
 * @param {object} resolved the repo's resolved alias in this answer
 * @param {object} ctx `{ errors, aliasErrors, alias, now }` from the answer it came in
 */
const absorb = (entry, resolved, { errors, aliasErrors, alias, now }) => {
  const conn = (resolved || {}).issues || {};
  const answered = conn.nodes || [];
  // A NULL node is an issue GitHub could not deliver, and reading a field off
  // one is what ended this process (issue #202). It is skipped, counted, and
  // said out loud on the repo it belongs to, so the board shows what arrived
  // and the Overview's warning fires over what did not.
  const nodes = answered.filter(Boolean);
  const info = conn.pageInfo || {};

  if (entry.answers === 0) {
    entry.totalCount = typeof conn.totalCount === 'number' ? conn.totalCount : answered.length;
    entry.closedDay = closedSince(resolved, now);
  }
  entry.answers += 1;
  entry.nodes.push(...nodes);
  entry.more = Boolean(info.hasNextPage);
  entry.cursor = typeof info.endCursor === 'string' ? info.endCursor : null;
  entry.error = entry.error
    || droppedReason(answered, nodes, errors, alias)
    || aliasErrors[alias]
    || (resolved ? null : 'not resolved');
};

/**
 * Begin a sweep: the FIRST page of every repo, and a handle on the rest.
 *
 * The sweep is stepwise because the board is DRAWN as it arrives (issue #194).
 * A repo past a hundred open issues takes a request per hundred, and a caller
 * that has a reader waiting takes the first pages inside the request it is
 * answering, hands those back, and runs the continuations on afterwards —
 * asking `board()` again for the snapshot as it grows.
 *
 * `board()` marks every repo still being paged `loading: true`, which is the
 * progress line the Overview draws, and a finished board carries no such mark,
 * which is how that line clears. It is the same mark in the same shape the
 * browser's sweep hands its `onPage` callback, so one payload serves both.
 *
 * A round asks one page for each repo that still has one, rather than draining
 * a repo before starting the next: a round is what the reader sees move, and
 * every repo past its first page moving together is what the browser's sweep
 * shows too. The requests inside a round stay serial, for the reason the first
 * pages are.
 *
 * @param {Array<{slug: string|null}>} repos the roster (repos without a slug are skipped)
 * @param {object} [opts] as fetchBoard's
 * @returns {{board: Function, paging: Function, step: Function}}
 *   `board()` the sweep as it stands · `paging()` whether pages remain to ask
 *   for · `step()` one round, the next page of every repo that has one
 */
const startSweep = (repos, opts = {}) => {
  const exec = opts.exec || defaultExec;
  const groups = labelGroups(opts.labelsFile);
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

  // A sweep that never starts is still a sweep to its caller: it answers the
  // shape it would have answered and has nothing left to do.
  const settled = (value) => ({ board: () => value, paging: () => false, step: () => {} });

  try {
    // Local and free — it answers "is gh installed", which no failure of the
    // sweep itself distinguishes cleanly from a network or token problem.
    exec('gh', ['--version']);
  } catch {
    return settled({ ok: false, reason: 'gh not found', issues: [], repos: [] });
  }

  const withSlug = (repos || []).filter((r) => r && typeof r.slug === 'string' && r.slug.includes('/'));
  if (withSlug.length === 0) return settled({ ok: true, issues: [], repos: [] });

  const collected = withSlug.map((repo) => ({
    slug: repo.slug, nodes: [], answers: 0, totalCount: 0, closedDay: 0, more: false, cursor: null, error: null, stopped: false,
  }));

  // The FIRST page of every repo, a batch at a time, in sequence. The requests
  // are serial because the sweep runs behind one cached endpoint on a poll —
  // three round trips one after the other is what the cache absorbs, and firing
  // them together is how a roster this size meets a secondary rate limit
  // instead of the resource one.
  for (let offset = 0; offset < withSlug.length; offset += REPOS_PER_REQUEST) {
    const batch = withSlug.slice(offset, offset + REPOS_PER_REQUEST);
    const { payload, reason } = ask(exec, buildBoardQuery(batch.map((r) => r.slug)));
    if (!payload) return settled({ ok: false, reason, issues: [], repos: [] });
    const aliasErrors = errorsByAlias(payload.errors);
    batch.forEach((_, i) => {
      const alias = `r${i}`;
      absorb(collected[offset + i], payload.data[alias], { errors: payload.errors, aliasErrors, alias, now });
    });
  }

  // Has this repo a page left to ask for? The CURSOR is asked for as well as
  // `hasNextPage`: an answer claiming more without saying where it resumes is
  // one this sweep cannot act on, and asking again without it would re-read the
  // page it just read, forever. `stopped` is the third way it ends — a
  // continuation that failed — and it is kept apart from `more` because the
  // repo goes on saying it was truncated, which it was.
  const pending = (entry) => entry.more && Boolean(entry.cursor) && !entry.stopped && entry.nodes.length < MAX_OPEN_ISSUES;

  /**
   * One round: the page after the last for every repo that has one, one repo
   * to a request. A continuation that fails is carried on its repo rather than
   * failing the sweep — the first pages are already collected, and throwing
   * away every other repo's answer over page two of one of them is not a better
   * board.
   *
   * A round that moved NOTHING ends the repo too. An answer claiming another
   * page, handing back the cursor it was asked with and carrying no nodes, has
   * advanced neither of the two things that end a sweep — the resume point and
   * the count the ceiling is measured against — so `while (paging()) step()`
   * turns forever on it, inside the request or the timer driving it. Either one
   * moving is progress and the paging goes on; neither moving is the tell, and
   * it is read from the round itself rather than trusted to `hasNextPage`.
   */
  const step = () => {
    for (const entry of collected.filter(pending)) {
      const asked = entry.cursor;
      const had = entry.nodes.length;
      const { payload, reason } = ask(exec, buildBoardQuery([entry.slug], [asked]));
      if (!payload) {
        entry.error = entry.error || reason;
        entry.stopped = true;
        continue;
      }
      absorb(entry, payload.data.r0, {
        errors: payload.errors, aliasErrors: errorsByAlias(payload.errors), alias: 'r0', now,
      });
      if (entry.cursor === asked && entry.nodes.length === had) entry.stopped = true;
    }
  };

  /** The board as it stands, marking what is still being paged. */
  const board = () => {
    const issues = [];
    const repoEntries = [];
    for (const entry of collected) {
      const repo = {
        slug: entry.slug,
        count: entry.nodes.length,
        totalCount: entry.totalCount,
        truncated: entry.more,
        closedDay: entry.closedDay,
        error: entry.error,
      };
      // Added LAST and only while it is true, so a finished board is byte for
      // byte the payload the browser's sweep ends on (the parity suite pins it).
      if (pending(entry)) repo.loading = true;
      repoEntries.push(repo);
      for (const node of entry.nodes) issues.push(issueFrom(node, entry.slug, groups));
    }
    return { ok: true, issues, repos: repoEntries };
  };

  return { board, paging: () => collected.some(pending), step };
};

/**
 * Every open issue across the roster, normalized to the workflow's vocabulary.
 *
 * The result carries a `repos` array alongside the issues so a repo can report
 * what happened to it: `truncated: true` when the sweep stopped at the ceiling
 * with issues still to give (issue #194), and `error` when its alias did not
 * resolve or GitHub dropped issues out of its answer. The issue list itself
 * stays flat — the board sorts and groups it — with a repo's pages together and
 * the repos in roster order.
 *
 * This is `startSweep` run to the end: what a caller with nobody watching the
 * pages arrive wants — the 9am brief, a test — in one call.
 *
 * @param {Array<{slug: string|null}>} repos the roster (repos without a slug are skipped)
 * @param {object} [opts]
 * @param {Function} [opts.exec] (cmd, args) => stdout — the `gh` seam
 * @param {string} [opts.labelsFile] override the vocabulary SSOT
 * @param {number} [opts.now] epoch ms the day's closed count is measured back from
 * @returns {{ok: boolean, reason?: string, issues: object[], repos: object[]}}
 */
const fetchBoard = (repos, opts = {}) => {
  const sweep = startSweep(repos, opts);
  while (sweep.paging()) sweep.step();
  return sweep.board();
};

// The sweep's pure half is re-exported rather than restated, so a caller that
// has this module has the whole sweep and never reaches past it (issue #195).
module.exports = { fetchBoard, startSweep, buildBoardQuery, parseLabels, issueFrom, labelGroups, errorsByAlias, firstErrorFor, droppedReason, closedSince, blockersFor, lastCommentOf, REPOS_PER_REQUEST, PAGE_SIZE, MAX_OPEN_ISSUES, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, CLOSED_WINDOW_MS, LABELS_FILE };
