//
// The board sweep's pure half — one home for both the machine and the browser.
//
// The sweep has two transports and one meaning. `tower/api/lib/board.js` speaks
// GraphQL through the `gh` login on this machine; `github.js` beside this file
// speaks it from a published page with the viewer's token. Those halves cannot
// merge — a published copy has no server, and the machine copy should keep its
// login rather than a browser token — but everything BETWEEN the request and
// the payload is the same rules, and it was written twice with a suite pinning
// the copies together (issue #195). It is written once here instead.
//
// What lives here is what has no transport in it: the document to ask, the
// numbers that bound it, the parse that turns one answered node into one board
// issue, and the reading of the errors that came back beside them. No fetch, no
// token, no `gh` — the callers own all three, and their own assembly around the
// pages this shapes.
//
// It lives on the APP's side of the copy boundary because that is the side that
// gets copied out: the app becomes a project of its own in `~/.workkit/tower`
// (issue #77) and can reach nothing under `tower/api/`, while board.js can
// reach here — Node 22 `require()`s an ES module directly, and the cloud
// brief's runner carries this file at its checkout-relative path so the same
// require resolves there (workflow/home.sh).
//

// Per repo, per request. GitHub caps a connection page at 100, so a repo with
// more open issues than that is PAGED rather than cut off at the first hundred
// (issue #194): every page carries the cursor it ended on and the next request
// resumes there.
export const PAGE_SIZE = 100;

// Where the paging stops whatever GitHub still has to give. A ceiling rather
// than a setting: nobody knows what "enough issues" is, and a repo past this
// many open issues is a repo whose board is not the thing to fix first.
export const MAX_OPEN_ISSUES = 1000;

// How many repos ride ONE request (issue #202). GitHub scores a query before it
// runs it and refuses the ones that are too much work: measured 2026-08-26 on a
// 23-repo roster, every repo alone passed and batches of 4 and of 8 passed with
// zero nulls, while all 23 in one request came back RESOURCE_LIMITS_EXCEEDED —
// 357 of 357 issue nodes null. Six is inside what passed with room for repos
// that grow, and the roster is swept a batch at a time rather than whole.
export const REPOS_PER_REQUEST = 6;

// How much of an issue body the sweep carries. The dashboard's issue dialog
// reads the body straight off the board payload, so the whole roster's bodies
// ride every poll — and one issue with a pasted log in it would be larger than
// the rest of the board put together. What is cut is reported (`bodyTruncated`)
// and the rest is one click away on GitHub.
export const BODY_LIMIT = 4000;

// How much of an issue's LAST COMMENT the sweep carries (issue #196). A blocked
// issue's open question is a comment on it — that is the spec's convention — so
// the newest comment is the best signal there is for what the board is waiting
// to be told, and the Board draws it under the title of a blocked card. One
// line's worth is what a card can show; the whole thread is one click away.
export const LAST_COMMENT_LIMIT = 280;

// The closed issues a repo is asked for, and the window they are counted over.
// The sweep is about the OPEN board, and closed issues never enter it — what is
// wanted is one number per repo, "how much shipped in the last day", which the
// morning's stats line records and the history charts draw. Thirty is well past
// a day's worth on any repo this board covers, and the count is what survives:
// no closed issue is carried, so nothing downstream can start rendering one.
export const CLOSED_PAGE = 30;
export const CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The GraphQL document for a roster, one aliased field per repo — one document
 * per BATCH of them (issue #202), the aliases restarting at `r0` in each.
 *
 * `cursors` is what makes it the document for a LATER page too (issue #194):
 * the entry at a repo's index is the cursor its last page ended on, and a repo
 * with none starts where the connection does. A continuation names one repo,
 * so it re-asks for that repo's closed page as well — thirty stamps, ignored
 * on arrival, against a second document that would have to be kept in step
 * with this one forever.
 *
 * @param {string[]} slugs `owner/name`, in the order the aliases are read back
 * @param {Array<string|null>} [cursors] where each repo resumes
 * @returns {string}
 */
export const buildBoardQuery = (slugs, cursors = []) => {
  const fields = slugs.map((slug, i) => {
    const [owner, name] = slug.split('/');
    return `  r${i}: repository(owner: "${owner}", name: "${name}") {
    issues(states: OPEN, first: ${PAGE_SIZE}${typeof cursors[i] === 'string' ? `, after: "${cursors[i]}"` : ''}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
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
  }`;
  });
  return `query {\n${fields.join('\n')}\n}\n`;
};

/**
 * Split `group:value` label names into a map of group → values, keeping only
 * the groups the vocabulary defines. An unknown group is ignored: a repo may
 * carry labels this workflow knows nothing about.
 *
 * The vocabulary is an ARGUMENT because its two readers reach it differently —
 * the machine reads workflow/labels.json, the published page carries the list
 * it was built with — and neither of those is this module's to know.
 *
 * @param {Array<{name: string}>} nodes
 * @param {Set<string>} groups
 * @returns {Object<string, string[]>}
 */
export const parseLabels = (nodes, groups) => {
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
export const blockersFor = (node, slug) => {
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
export const lastCommentOf = (node) => {
  const nodes = ((node.comments || {}).nodes) || [];
  const body = String((nodes[nodes.length - 1] || {}).body || '').replace(/\s+/g, ' ').trim();
  return body.length > LAST_COMMENT_LIMIT ? `${body.slice(0, LAST_COMMENT_LIMIT)}…` : body;
};

/**
 * One answered issue node as one board issue — the whole normalization, so a
 * card says the same thing whichever half read it.
 *
 * @param {object} node the issue node as GraphQL answered it
 * @param {string} slug the repo it was swept from
 * @param {Set<string>} groups the label vocabulary's group names
 * @returns {object} the issue as `/api/board` serves it
 */
export const issueFrom = (node, slug, groups) => {
  const parsed = parseLabels((node.labels || {}).nodes, groups);
  const agent = parsed.agent || [];
  const body = String(node.body || '');
  return {
    repo: slug,
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
    // `filter(Boolean)` for the reason the issue list itself has one: GitHub
    // nulls out a node it could not deliver (issue #202), at whatever depth the
    // connection sits, and reading a field off one of those holes is what ended
    // the tower's API. Every other connection an issue carries already skips
    // them — the labels, the comment, the blockers — and this was the last that
    // did not.
    assignees: ((node.assignees || {}).nodes || []).filter(Boolean).map((a) => a.login),
    blockedBy: blockersFor(node, slug),
  };
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
export const closedSince = (resolved, now) => {
  const nodes = ((resolved || {}).closed || {}).nodes || [];
  let count = 0;
  for (const node of nodes) {
    const at = Date.parse((node || {}).closedAt || '');
    if (Number.isNaN(at)) continue;
    if (now - at <= CLOSED_WINDOW_MS && at <= now) count += 1;
  }
  return count;
};

/**
 * A GraphQL errors array indexed by the alias it names.
 *
 * `path` is the field path GitHub reports, so `["r1"]` is repo r1's failure; an
 * error with no path belongs to the request as a whole and has no repo to hang
 * on. Several errors against one alias join, because each of them is a separate
 * thing that went wrong to that repo.
 *
 * @param {object[]} errors the answer's `errors`, if any
 * @returns {Object<string, string>}
 */
export const errorsByAlias = (errors) => {
  const map = {};
  for (const error of errors || []) {
    const alias = Array.isArray(error.path) && typeof error.path[0] === 'string' ? error.path[0] : null;
    if (!alias) continue;
    const message = error.message || error.type || 'unknown error';
    map[alias] = map[alias] ? `${map[alias]}; ${message}` : message;
  }
  return map;
};

/**
 * The FIRST message GitHub reported against an alias — what a dropped-node
 * reason quotes. The failure this exists for answers with one error per dropped
 * node (464 of them on the roster that found it, issue #202); they all say the
 * same thing, and one of them is what a repo entry has room for.
 *
 * @param {object[]} errors the answer's `errors`, if any
 * @param {string} alias the repo's alias in that answer
 * @returns {string}
 */
export const firstErrorFor = (errors, alias) => {
  for (const error of errors || []) {
    if (Array.isArray(error.path) && error.path[0] === alias) return error.message || error.type || 'unknown error';
  }
  return 'no reason given';
};

/**
 * What a repo says when GitHub delivered fewer issues than it answered with,
 * or null when it delivered them all.
 *
 * A NULL node is an issue GitHub could not deliver, and reading a field off one
 * is what ended the tower's API (issue #202). Both halves skip it, count it, and
 * say it out loud on the repo it belongs to, in these words.
 *
 * @param {object[]} answered the nodes as they arrived, holes and all
 * @param {object[]} nodes what survived `filter(Boolean)`
 * @param {object[]} errors the answer's `errors`, if any
 * @param {string} alias the repo's alias in that answer
 * @returns {string|null}
 */
export const droppedReason = (answered, nodes, errors, alias) => {
  const dropped = answered.length - nodes.length;
  if (dropped < 1) return null;
  return `GitHub dropped ${dropped} of ${answered.length} issues: ${firstErrorFor(errors, alias)}`;
};
