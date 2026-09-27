// The board sweep's pure half, shared by the machine (`tower/api/lib/board.js`,
// through `gh`) and the browser (`../github.js`): no fetch, no token, no `gh`.
// It sits on the app's side because the app is what gets copied out to
// `~/.workkit/tower`; board.js `require()`s this ES module.

// Per repo, per request: GitHub caps a connection page at 100, so a bigger repo
// is paged by the cursor each page ended on.
export const PAGE_SIZE = 100;

// Where the paging stops whatever GitHub still has to give. A ceiling rather
// than a setting: nobody knows what "enough issues" is, and a repo past this
// many open issues is a repo whose board is not the thing to fix first.
export const MAX_OPEN_ISSUES = 1000;

// How many repos ride one request. GitHub refuses a query it scores as too much
// work, and a whole roster in one request came back RESOURCE_LIMITS_EXCEEDED
// with every node null; six sits inside what passed, with room to grow.
export const REPOS_PER_REQUEST = 6;

// How much of an issue body the sweep carries: every body rides every poll for
// the issue dialog, and one pasted log would outweigh the board. What is cut is
// flagged `bodyTruncated`.
export const BODY_LIMIT = 4000;

// How much of an issue's newest comment the sweep carries: a blocked issue's
// open question is its newest comment, and a card shows one line of it.
export const LAST_COMMENT_LIMIT = 280;

// The closed issues a repo is asked for, and the window they are counted over:
// only the count of what shipped in the last day survives, for the stats line,
// so no closed issue is ever carried.
export const CLOSED_PAGE = 30;
export const CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The GraphQL document for one batch of repos, one aliased field per repo from
 * `r0`. `cursors[i]` resumes repo i where its last page ended; a continuation
 * re-asks for the closed page too, ignored on arrival, rather than keeping a
 * second document in step with this one.
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
 * the groups the vocabulary defines. The vocabulary is an argument because the
 * machine and the published page each reach it their own way.
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

// The inline `Depends on:` fallback the spec defines: only a line headed by the
// label counts, and the expression reads every reference on that line.
const DEPENDS_LABEL = 'depends on:';
const DEPENDS_RE = /(?:^|[\s,;(])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

/**
 * What one issue is waiting on: GitHub's native edges merged with the inline
 * fallback. A closed blocker is satisfied, which is why an edge's `state`
 * rides the sweep; an inline reference has no state, so it counts until the
 * line is edited away.
 *
 * @param {object} node the issue node as GraphQL answered it
 * @param {string} slug the repo it was swept from: what a bare `#<n>` means
 * @returns {Array<{repo: string, number: number}>} empty when it waits on nothing
 */
export const blockersFor = (node, slug) => {
  const out = [];
  const seen = new Set();
  // Repo names are case-insensitive on GitHub, so the same blocker written two
  // ways is one edge; what is kept is the spelling the sweep answered with.
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

  // The whole body, not the cut one the issue carries: a line past the body
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
 * The issue's newest comment as one line, cut with an ellipsis to what a card
 * can show.
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
 * One answered issue node as one board issue: the whole normalization, so a
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
    // GitHub nulls out a node it could not deliver, at any depth, and reading a
    // field off one crashes the API: every connection here skips them.
    assignees: ((node.assignees || {}).nodes || []).filter(Boolean).map((a) => a.login),
    blockedBy: blockersFor(node, slug),
  };
};

/**
 * How many of a repo's closed issues were closed in the last 24 hours; the
 * clock is an argument so a suite can state the count.
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
 * A GraphQL errors array indexed by the alias its `path` names (`["r1"]`); a
 * pathless error belongs to the whole request, and several on one alias join.
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
 * The first message GitHub reported against an alias: what a dropped-node
 * reason quotes, since GitHub answers one identical error per dropped node.
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
 * or null when it delivered them all. Both halves skip a null node, count it,
 * and say so on its repo in these words.
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

/**
 * The rate limit said in the reader's own clock, or null when this is not one.
 * The three shapes and why `retry-after` wins: `tower/README.md` § Endpoints.
 * A token GitHub refused wears the same 403, so this reading tells them apart.
 * The headers arrive as a plain lowercased object from either transport.
 *
 * @param {number|null} status the response status
 * @param {Object<string, string|null>} headers the response headers, lowercased
 * @param {number} now epoch ms the wait is measured from
 * @param {object} [evidence] what the body said: `{ message, errors }`
 * @returns {string|null}
 */
export const rateLimitReason = (status, headers, now, evidence = {}) => {
  const head = headers || {};
  const { message, errors } = evidence || {};
  // The GraphQL error is the whole tell on its own: its type starts with
  // RATE_LIMIT (the live wire says RATE_LIMIT, the docs say RATE_LIMITED) or
  // its message names the limit, and the status line above it says 200.
  const flagged = (errors || []).some((error) => error
    && (/^RATE_LIMIT/.test(error.type || '') || /rate limit/i.test(error.message || '')));
  const spent = head['x-ratelimit-remaining'] === '0';
  const said = /rate limit/i.test(message || '');
  if (!flagged && !((status === 403 || status === 429) && (spent || said))) return null;

  const after = Number(head['retry-after']);
  const reset = after > 0 ? now + (after * 1000) : Number(head['x-ratelimit-reset']) * 1000;
  if (!Number.isFinite(reset) || reset <= 0) return null;
  const clock = new Date(reset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const left = reset - now;
  const wait = left <= 0 ? 'now' : (left < 60000 ? 'in under a minute' : `in ${Math.ceil(left / 60000)} min`);
  return `GitHub rate limit hit for this token; resets at ${clock} (${wait}).`;
};
