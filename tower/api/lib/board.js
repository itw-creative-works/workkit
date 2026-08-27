//
// The cross-repo issue sweep — the board's data, in one call.
//
// Every opted-in repo's open issues arrive from a SINGLE `gh api graphql`
// request using per-repo aliases (`r0:`, `r1:`, …). One request instead of one
// per repo is the whole point: the board is polled, and a roster of a dozen
// repos would otherwise be a dozen round trips and a dozen rate-limit hits
// every refresh.
//
// The label vocabulary is not restated here. Group names come from
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
// Usage:
//   const { fetchBoard } = require('./board');
//   fetchBoard(discoverRepos());          // live
//   fetchBoard(repos, { exec: fake });    // offline, against a fixture payload
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Per repo, per request. GitHub caps a connection page at 100; a repo with more
// open issues than that is reported truncated rather than silently short.
const PAGE_SIZE = 100;

// How much of an issue body the sweep carries. The dashboard's issue dialog
// reads the body straight off the board payload, so the whole roster's bodies
// ride every poll — and one issue with a pasted log in it would be larger than
// the rest of the board put together. What is cut is reported (`bodyTruncated`)
// and the rest is one click away on GitHub.
const BODY_LIMIT = 4000;

// How much of an issue's LAST COMMENT the sweep carries (issue #196). A blocked
// issue's open question is a comment on it — that is the spec's convention — so
// the newest comment is the best signal there is for what the board is waiting
// to be told, and the Board draws it under the title of a blocked card. One
// line's worth is what a card can show; the whole thread is one click away.
const LAST_COMMENT_LIMIT = 280;

// The closed issues a repo is asked for, and the window they are counted over.
// The sweep is about the OPEN board, and closed issues never enter it — what is
// wanted is one number per repo, "how much shipped in the last day", which the
// morning's stats line records and the history charts draw. Thirty is well past
// a day's worth on any repo this board covers, and the count is what survives:
// no closed issue is carried, so nothing downstream can start rendering one.
const CLOSED_PAGE = 30;
const CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/**
 * Split `group:value` label names into a map of group → values, keeping only
 * the groups the vocabulary defines. An unknown group is ignored: a repo may
 * carry labels this workflow knows nothing about.
 * @param {Array<{name: string}>} nodes
 * @param {Set<string>} groups
 * @returns {Object<string, string[]>}
 */
const parseLabels = (nodes, groups) => {
  const out = {};
  for (const node of nodes || []) {
    const name = node && node.name;
    if (typeof name !== 'string') continue;
    const idx = name.indexOf(':');
    if (idx < 1) continue;
    const group = name.slice(0, idx);
    if (!groups.has(group)) continue;
    (out[group] = out[group] || []).push(name.slice(idx + 1));
  }
  return out;
};

// The inline fallback for a dependency GitHub itself will not hold (issue #103):
// a `Depends on:` line in the issue body, naming `<owner>/<repo>#<n>` where the
// edge crosses orgs and bare `#<n>` where it does not. The label is matched as
// plain text at the head of a line, so a `#12` anywhere else in the body is not
// a dependency, and the one expression below reads every reference on that line.
const DEPENDS_LABEL = 'depends on:';
const DEPENDS_RE = /(?:^|[\s,;(])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

/**
 * What one issue is WAITING on: the native dependency edges GitHub keeps,
 * merged with the inline fallback its body may carry (issue #103).
 *
 * A blocker that is CLOSED is satisfied — no ordering effect, nothing to draw —
 * which is the whole reason the edge's `state` rides the sweep. An inline
 * reference carries no state, so it counts as an edge until the line is edited
 * away: native edges are the norm and the line is the rare cross-org case the
 * API refuses to hold, so a stale one lingering is the accepted trade.
 *
 * @param {object} node the issue node as GraphQL answered it
 * @param {string} slug the repo it was swept from — what a bare `#<n>` means
 * @returns {Array<{repo: string, number: number}>} empty when it waits on nothing
 */
const blockersFor = (node, slug) => {
  const out = [];
  const seen = new Set();
  // Repo names are case-insensitive on GitHub, so the same blocker written two
  // ways is one edge; what is KEPT is the spelling the sweep answered with.
  const add = (repo, number) => {
    const key = `${repo}#${number}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ repo, number });
  };

  for (const edge of ((node.blockedBy || {}).nodes || [])) {
    if (!edge || edge.state !== 'OPEN' || typeof edge.number !== 'number') continue;
    add(((edge.repository || {}).nameWithOwner) || slug, edge.number);
  }

  // The WHOLE body, not the cut one the issue carries: a line past the body
  // limit is still a dependency somebody wrote down.
  for (const line of String(node.body || '').split('\n')) {
    const lower = line.toLowerCase();
    // Issue bodies are markdown: a list bullet or bold marker around the label
    // ("- Depends on:", "**Depends on:**") is the same line, still at its start.
    if (!lower.trim().replace(/^[-*>\s]+/, '').startsWith(DEPENDS_LABEL)) continue;
    const refs = line.slice(lower.indexOf(DEPENDS_LABEL) + DEPENDS_LABEL.length).replace(/^\*+/, '');
    DEPENDS_RE.lastIndex = 0;
    let match = DEPENDS_RE.exec(refs);
    while (match) {
      add(match[1] || slug, Number(match[2]));
      match = DEPENDS_RE.exec(refs);
    }
  }

  return out;
};

/**
 * The issue's newest comment as one line, cut to what a card can show.
 *
 * The query asks for the LAST one, so the connection holds at most a single
 * node. Its body is markdown over many lines and the surfaces that draw it draw
 * one line, so the whitespace is folded here rather than in each of them, and a
 * cut says so with an ellipsis instead of stopping mid-word in silence.
 *
 * @param {object} node the issue node as GraphQL answered it
 * @returns {string} '' on an issue nobody has commented on
 */
const lastCommentOf = (node) => {
  const nodes = ((node.comments || {}).nodes) || [];
  const body = String((nodes[nodes.length - 1] || {}).body || '').replace(/\s+/g, ' ').trim();
  return body.length > LAST_COMMENT_LIMIT ? `${body.slice(0, LAST_COMMENT_LIMIT)}…` : body;
};

/** The GraphQL document for a roster, one aliased field per repo. */
const buildQuery = (slugs) => {
  const fields = slugs.map(([owner, name], i) => `  r${i}: repository(owner: "${owner}", name: "${name}") {
    issues(states: OPEN, first: ${PAGE_SIZE}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number
        title
        url
        body
        createdAt
        updatedAt
        comments(last: 1) { totalCount nodes { body } }
        labels(first: 20) { nodes { name } }
        assignees(first: 5) { nodes { login } }
        blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } }
      }
    }
    closed: issues(states: CLOSED, first: ${CLOSED_PAGE}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { closedAt }
    }
  }`);
  return `query {\n${fields.join('\n')}\n}\n`;
};

/**
 * How many of a repo's closed issues were closed in the last 24 hours.
 *
 * The clock is an argument for the reason every other seam here is one: a count
 * that depends on the hour the suite runs at is a count no test can state.
 *
 * @param {object} resolved the repo's resolved alias
 * @param {number} now epoch ms the window is measured back from
 * @returns {number}
 */
const closedSince = (resolved, now) => {
  const nodes = ((resolved || {}).closed || {}).nodes || [];
  let count = 0;
  for (const node of nodes) {
    const at = Date.parse((node || {}).closedAt || '');
    if (Number.isNaN(at)) continue;
    if (now - at <= CLOSED_WINDOW_MS && at <= now) count += 1;
  }
  return count;
};

/** JSON, or null when the text is not JSON (or is not there at all). */
const tryParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * A GraphQL errors array indexed by the alias it names. `path` is the field
 * path GitHub reports, so `["r1"]` is repo r1's failure; an error with no path
 * belongs to the request as a whole and has no repo to hang on.
 * @param {object[]} errors
 * @returns {Object<string, string>}
 */
const errorsByAlias = (errors) => {
  const map = {};
  for (const e of errors || []) {
    const alias = Array.isArray(e.path) && typeof e.path[0] === 'string' ? e.path[0] : null;
    if (!alias) continue;
    const message = e.message || e.type || 'unknown error';
    map[alias] = map[alias] ? `${map[alias]}; ${message}` : message;
  }
  return map;
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
 * Every open issue across the roster, normalized to the workflow's vocabulary.
 *
 * The result carries a `repos` array alongside the issues so a repo can report
 * what happened to it: `truncated: true` when it hit the page cap, and `error`
 * when its alias did not resolve. The issue list itself stays flat; the board
 * sorts and groups it.
 *
 * @param {Array<{slug: string|null}>} repos the roster (repos without a slug are skipped)
 * @param {object} [opts]
 * @param {Function} [opts.exec] (cmd, args) => stdout — the `gh` seam
 * @param {string} [opts.labelsFile] override the vocabulary SSOT
 * @param {number} [opts.now] epoch ms the day's closed count is measured back from
 * @returns {{ok: boolean, reason?: string, issues: object[], repos: object[]}}
 */
const fetchBoard = (repos, opts = {}) => {
  const exec = opts.exec || defaultExec;
  const groups = labelGroups(opts.labelsFile);
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

  try {
    // Local and free — it answers "is gh installed", which no failure of the
    // sweep itself distinguishes cleanly from a network or token problem.
    exec('gh', ['--version']);
  } catch {
    return { ok: false, reason: 'gh not found', issues: [], repos: [] };
  }

  const withSlug = (repos || []).filter((r) => r && typeof r.slug === 'string' && r.slug.includes('/'));
  if (withSlug.length === 0) return { ok: true, issues: [], repos: [] };

  let payload;
  try {
    const query = buildQuery(withSlug.map((r) => r.slug.split('/')));
    payload = tryParse(exec('gh', ['api', 'graphql', '-f', `query=${query}`]));
  } catch (err) {
    // A non-zero exit still carries the response. Believe the payload, not the
    // exit code: partial data is the normal shape of a roster with one bad repo.
    payload = tryParse(err.stdout ? String(err.stdout) : '');
    if (!payload || !payload.data) {
      return { ok: false, reason: failureReason(err), issues: [], repos: [] };
    }
  }

  if (!payload || !payload.data) {
    return { ok: false, reason: 'gh graphql returned no data', issues: [], repos: [] };
  }

  const data = payload.data;
  const aliasErrors = errorsByAlias(payload.errors);
  const issues = [];
  const repoEntries = [];

  withSlug.forEach((repo, i) => {
    const alias = `r${i}`;
    const resolved = data[alias];
    const conn = (resolved || {}).issues || {};
    const nodes = conn.nodes || [];
    const total = typeof conn.totalCount === 'number' ? conn.totalCount : nodes.length;
    repoEntries.push({
      slug: repo.slug,
      count: nodes.length,
      totalCount: total,
      truncated: total > nodes.length,
      closedDay: closedSince(resolved, now),
      error: aliasErrors[alias] || (resolved ? null : 'not resolved'),
    });
    for (const node of nodes) {
      const parsed = parseLabels((node.labels || {}).nodes, groups);
      const agent = parsed.agent || [];
      const body = String(node.body || '');
      issues.push({
        repo: repo.slug,
        number: node.number,
        title: node.title,
        url: node.url,
        body: body.slice(0, BODY_LIMIT),
        bodyTruncated: body.length > BODY_LIMIT,
        comments: ((node.comments || {}).totalCount) || 0,
        lastComment: lastCommentOf(node),
        createdAt: node.createdAt || null,
        updatedAt: node.updatedAt,
        status: (parsed.status || [])[0] || null,
        type: (parsed.type || [])[0] || null,
        priority: (parsed.priority || [])[0] || null,
        agentOk: agent.includes('ok'),
        agentWorking: agent.includes('working'),
        assignees: ((node.assignees || {}).nodes || []).map((a) => a.login),
        blockedBy: blockersFor(node, repo.slug),
      });
    }
  });

  return { ok: true, issues, repos: repoEntries };
};

module.exports = { fetchBoard, buildQuery, parseLabels, labelGroups, errorsByAlias, closedSince, blockersFor, lastCommentOf, PAGE_SIZE, BODY_LIMIT, LAST_COMMENT_LIMIT, CLOSED_PAGE, CLOSED_WINDOW_MS, LABELS_FILE };
