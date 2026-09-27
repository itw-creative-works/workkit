// The cross-repo issue sweep: the machine's transport (`gh api graphql`, a batch
// of repos per aliased request, paged per repo) around the pure half in the app's
// libs/tower/github/sweep.js, which the published copy imports too. Paging and
// soft failures: tower/README.md § Endpoints.
//
// Usage:
//   fetchBoard(discoverRepos());          // live, the whole board in one call
//   const s = startSweep(repos);          // page by page: s.board(), s.paging(), s.step()

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The sweep's pure half, shared with the published dashboard. An ES module,
// reached by the relative path the cloud brief's runner preserves.
const {
  buildBoardQuery, parseLabels, blockersFor, lastCommentOf, issueFrom, closedSince,
  errorsByAlias, firstErrorFor, droppedReason, rateLimitReason,
  PAGE_SIZE, MAX_OPEN_ISSUES, REPOS_PER_REQUEST, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, CLOSED_WINDOW_MS,
} = require('../../app/targets/web/src/assets/js/libs/tower/github/sweep.js');

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
 * The status line, the headers and the body of a `gh --include` answer. Text
 * with no header block in front is handed back whole as the body.
 * @param {string} text stdout, from the call or from its error
 * @returns {{status: number|null, headers: object, body: string}} header names lowercased
 */
const splitResponse = (text) => {
  const raw = text == null ? '' : String(text);
  const opening = raw.match(/^HTTP\/\S+\s+(\d{3})/);
  if (!opening) return { status: null, headers: {}, body: raw };

  const gap = raw.search(/\r?\n\r?\n/);
  const head = gap === -1 ? raw : raw.slice(0, gap);
  const body = gap === -1 ? '' : raw.slice(gap).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.split(/\r?\n/).slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(opening[1]), headers, body };
};

/**
 * One `gh api graphql` round trip, believed even when the exit code says no:
 * `gh` fails whenever an errors array is present, so the payload decides. The
 * headers come too (`--include`), since a spent rate limit is only legible in
 * them. summaries.js and history.js call this, so one reading answers them all.
 * @param {Function} exec the `gh` seam
 * @param {string} query the document to send
 * @param {Object<string, string>} [variables] `-f name=value` pairs to send with it
 * @returns {{payload: object|null, reason: string|null}}
 */
const ask = (exec, query, variables = {}) => {
  const read = (text) => {
    const { status, headers, body } = splitResponse(text);
    return { status, headers, payload: tryParse(body) };
  };
  const limited = ({ status, headers, payload }) => rateLimitReason(status, headers, Date.now(), {
    message: payload && payload.message,
    errors: payload && payload.errors,
  });

  const args = ['api', 'graphql', '--include'];
  for (const [name, value] of Object.entries(variables)) args.push('-f', `${name}=${value}`);
  args.push('-f', `query=${query}`);

  try {
    const answer = read(exec('gh', args));
    if (answer.payload && answer.payload.data) return { payload: answer.payload, reason: null };
    return { payload: null, reason: limited(answer) || 'gh graphql returned no data' };
  } catch (err) {
    const answer = read(err.stdout ? String(err.stdout) : '');
    if (answer.payload && answer.payload.data) return { payload: answer.payload, reason: null };
    return { payload: null, reason: limited(answer) || failureReason(err) };
  }
};

/**
 * Fold one answered page into what the sweep has collected for that repo. The
 * first answer carries the repo's facts (total, closed page), and the first
 * reason anything went wrong is the one kept.
 * @param {object} entry what has been collected for this repo so far
 * @param {object} resolved the repo's resolved alias in this answer
 * @param {object} ctx `{ errors, aliasErrors, alias, now }` from the answer it came in
 */
const absorb = (entry, resolved, { errors, aliasErrors, alias, now }) => {
  const conn = (resolved || {}).issues || {};
  const answered = conn.nodes || [];
  // A null node is an issue GitHub could not deliver: skipped, and said on its
  // repo, so the board shows what arrived and the Overview warns over the rest.
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
 * Begin a sweep: the first page of every repo, and a handle on the rest, so a
 * caller answers with what arrived and pages on behind it (tower/README.md §
 * Endpoints). A round asks one page of every repo that has one, as the
 * browser's sweep does, never draining one repo first.
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
    // Local and free: "is gh installed". Auth is judged from the sweep's own
    // failure, since `gh auth status` would be a network round trip every poll.
    exec('gh', ['--version']);
  } catch {
    return settled({ ok: false, reason: 'gh not found', issues: [], repos: [] });
  }

  const withSlug = (repos || []).filter((r) => r && typeof r.slug === 'string' && r.slug.includes('/'));
  if (withSlug.length === 0) return settled({ ok: true, issues: [], repos: [] });

  const collected = withSlug.map((repo) => ({
    slug: repo.slug, nodes: [], answers: 0, totalCount: 0, closedDay: 0, more: false, cursor: null, error: null, stopped: false,
  }));

  // The first page of every repo, a batch at a time, serially: firing them
  // together is how a roster this size meets a secondary rate limit.
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

  // A page is left only with a cursor too: `hasNextPage` without one would
  // re-read the same page forever. `stopped` (a failed or stalled continuation)
  // stays apart from `more`, since the repo was still truncated.
  const pending = (entry) => entry.more && Boolean(entry.cursor) && !entry.stopped && entry.nodes.length < MAX_OPEN_ISSUES;

  /**
   * One round: the next page of every repo that has one, one repo to a request.
   * A failed continuation is carried on its repo, never on the sweep. A round
   * that moved neither the cursor nor the count stops the repo, or
   * `while (paging()) step()` would turn forever.
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
      // Added last and only while it is true, so a finished board is byte for
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
 * Every open issue across the roster: `startSweep` run to the end, for a caller
 * nobody watches. A `repos` entry says `truncated` at the ceiling and `error`
 * where its alias did not resolve or GitHub dropped issues.
 * @param {Array<{slug: string|null}>} repos the roster (repos without a slug are skipped)
 * @param {object} [opts]
 * @param {Function} [opts.exec] (cmd, args) => stdout: the `gh` seam
 * @param {string} [opts.labelsFile] override the vocabulary SSOT
 * @param {number} [opts.now] epoch ms the day's closed count is measured back from
 * @returns {{ok: boolean, reason?: string, issues: object[], repos: object[]}}
 */
const fetchBoard = (repos, opts = {}) => {
  const sweep = startSweep(repos, opts);
  while (sweep.paging()) sweep.step();
  return sweep.board();
};

// The sweep's pure half is re-exported, so a caller never reaches past this module.
module.exports = { fetchBoard, startSweep, ask, splitResponse, buildBoardQuery, parseLabels, issueFrom, labelGroups, errorsByAlias, firstErrorFor, droppedReason, rateLimitReason, closedSince, blockersFor, lastCommentOf, REPOS_PER_REQUEST, PAGE_SIZE, MAX_OPEN_ISSUES, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, CLOSED_WINDOW_MS, LABELS_FILE };
