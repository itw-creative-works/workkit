//
// The published site's data layer — GitHub, spoken from the browser.
//
// The local dashboard reads the tower API on this machine (api.js). A PUBLISHED
// copy has no tower on the other end, and nothing is baked into it but the slug
// of the home repo — which the site's own URL already names: every number on the
// page, and the roster of repos to sweep with it, comes from a live GitHub call
// made by the page itself (issues #81, #110). The key that unlocks those calls is a
// fine-grained personal access token the viewer supplies, held in that browser's
// localStorage and nowhere else — never in the repo, the built site, an engine
// file or a URL. Without it the site has no data to show, which is what makes
// the token the auth layer as well as the credential.
//
// It answers in the SAME shapes the tower API serves, so the page modules do not
// know which half is talking to them: `/api/repos` is a roster, `/api/board` is
// the sweep, `/api/brief` is the morning payload. `readFeed` is the one door,
// mirroring api.js's `fetchFeed` four-key result and its promise never to throw.
// It WRITES with that token too: the published site works exactly like the
// dashboard on the machine, so the two writes the tower has — moving a card and
// filing an issue — are here as well, in the same shapes and behind the same
// door discipline.
//
// Three things are RESTATED here rather than imported, for one reason: the app is
// copied out of this repo and becomes a project of its own in `~/.workkit/tower`
// (issue #77), so nothing under `tower/api/` is reachable from it. The label
// groups, the sweep's shape and the brief's sections are the same rules
// tower/api/lib/{board,brief}.js hold, and the suite pins the ones that can
// drift.
//
// Every function takes its seams as arguments — the token, `fetch`, the clock —
// so the whole module imports and answers under Node.
//

import { priorityRank, issueKey } from './format.js';

const GRAPHQL_URL = 'https://api.github.com/graphql';

/** Where the viewer's token lives. One key, one browser, never sent anywhere but GitHub. */
export const TOKEN_KEY = 'tower.github-token';

/** Where a viewer goes to make one. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * What that token needs to be able to do. The site MANAGES the issues it shows
 * — a card is dragged between columns and the dialog files one — so writing
 * issues is part of the ask. Contents: Read is the one addition, and only on the
 * home repo: the roster of repositories to sweep lives on its default branch
 * rather than beside the public pages (issue #110), and the token is what reads
 * it.
 */
export const TOKEN_SCOPES = 'a fine-grained token: Repository permissions → Issues: Read and write, Metadata: Read, Discussions: Read, on the repositories this board covers — plus Contents: Read on the home repo, which is where the list of those repositories lives.';

/** The baked artifact, and the only one: which repo is the home, and which branch of it carries the roster. Relative, so a project-path Pages site resolves it too. */
export const HOME_PATH = 'data/home.json';

/** Where the roster lives — a path on the home repo, read through the API with the viewer's token. */
export const ROSTER_PATH = 'data/repos.json';

/**
 * The branch it is read from when the home pointer does not say.
 *
 * The publish names the branch it actually pushed to (issue #112), so nothing
 * here has to assume; this is what a site published BEFORE that key existed
 * falls back to, and it is what those sites were written by. Asking GitHub for
 * the default branch instead would cost a request before the first row is drawn.
 */
export const ROSTER_REF = 'main';

// Per repo, per request — GitHub caps a connection page at 100 (tower/api/lib/board.js).
const PAGE_SIZE = 100;

// How much of an issue body rides the sweep; the dialog reads it straight off.
const BODY_LIMIT = 4000;

// The closed issues a repo is asked for, and the window they are counted over —
// tower/api/lib/board.js's numbers, restated for the copy-boundary reason every
// other constant here is. The count is all that survives normalization: no
// closed issue enters the board.
const CLOSED_PAGE = 30;
const CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;

// The label vocabulary's groups (workflow/labels.json, the SSOT the heal reads).
// A group missing here is a group the published board cannot show, so the suite
// holds this list against the file.
export const LABEL_GROUPS = new Set(['status', 'type', 'priority', 'agent']);

// ── The token ──────────────────────────────────────────────────────────────

/**
 * This browser's storage, or null when it has none to give.
 *
 * The GUARD is on the property access itself, not on the read through it: a
 * browser told to block all site data throws on `window.localStorage` rather
 * than answering null, and that access happens at module load in api.js and at
 * every Token click in page.js — an unguarded one takes the whole bundle down.
 * A locked-down browser is a viewer with no token, not a broken page.
 *
 * @param {object} [scope] - the global carrying `localStorage`, if any
 * @returns {Storage|null}
 */
export const safeStorage = (scope) => {
  try {
    return (scope && scope.localStorage) || null;
  } catch {
    return null;
  }
};

/**
 * The stored token, or ''.
 *
 * The storage is an argument because this module is imported under Node by its
 * own suite, and because a browser with storage disabled throws on the read as
 * well as on the access `safeStorage` covers.
 *
 * @param {Storage} [storage] - localStorage, or anything with getItem
 * @returns {string}
 */
export const readToken = (storage) => {
  try {
    return (storage && storage.getItem(TOKEN_KEY)) || '';
  } catch {
    return '';
  }
};

/**
 * Store a token, or clear it when the value is empty.
 *
 * @param {Storage} storage
 * @param {string} value
 * @returns {string} what is stored afterwards
 */
export const writeToken = (storage, value) => {
  const token = String(value || '').trim();
  try {
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
  } catch {
    // A browser that refuses storage cannot be given a token. The prompt stays.
  }
  return token;
};

/** Forget the token this browser holds. */
export const clearToken = (storage) => writeToken(storage, '');

// ── The wire ───────────────────────────────────────────────────────────────

/** What the caller must be told when there is no token at all. */
const NO_TOKEN = 'no GitHub token in this browser — add one to unlock the board';

/**
 * One GraphQL request.
 *
 * Never throws, and reports the four ways it can fail apart: no token, a
 * transport failure, a status GitHub refused it with, and a body that is not
 * JSON. A payload carrying BOTH data and errors is a success — a roster with one
 * unreadable repo is the ordinary shape, and the caller hangs each error on the
 * repo it names.
 *
 * @param {string} query - the document
 * @param {object} ctx
 * @param {string} ctx.token
 * @param {Function} ctx.fetch - the fetch implementation
 * @returns {Promise<{ok: boolean, data: any, errors: any[], status: number|null, reason: string|null}>}
 */
export const graphql = async (query, ctx = {}) => {
  const token = ctx.token || '';
  if (!token) return { ok: false, data: null, errors: [], status: null, reason: NO_TOKEN };

  let response;
  try {
    response = await ctx.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    return { ok: false, data: null, errors: [], status: null, reason: `GitHub did not answer (${error.message})` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      data: null,
      errors: [],
      status: response.status,
      reason: `GitHub refused the token (${response.status}) — it may be expired, or it may not cover these repositories. Hand over one that does.`,
    };
  }
  if (!response.ok) {
    return { ok: false, data: null, errors: [], status: response.status, reason: `GitHub answered ${response.status}` };
  }
  if (!payload || !payload.data) {
    const said = payload && Array.isArray(payload.errors) && payload.errors[0] && payload.errors[0].message;
    return { ok: false, data: null, errors: (payload && payload.errors) || [], status: response.status, reason: said || 'GitHub answered without data' };
  }
  return { ok: true, data: payload.data, errors: payload.errors || [], status: response.status, reason: null };
};

// ── The roster ─────────────────────────────────────────────────────────────

/**
 * The slug list, as the roster shape every page already reads.
 *
 * It carries names and nothing else: which repos this site sweeps, plus which
 * of them is the home repo the summaries are published on. A published roster
 * entry has no `path` — there is no machine under it — so the fields that place
 * a session by its working directory simply find nothing, which is correct: a
 * published copy has no sessions.
 *
 * @param {object} parsed - the parsed data/repos.json
 * @returns {{repos: Array<{name: string, path: string, slug: string}>, home: string}}
 */
export const parseSlugs = (parsed) => {
  const slugs = ((parsed && parsed.repos) || [])
    .filter((slug) => typeof slug === 'string' && slug.includes('/'));
  return {
    repos: slugs.map((slug) => ({ name: slug.split('/')[1], path: '', slug })),
    home: (parsed && typeof parsed.home === 'string' && parsed.home.includes('/')) ? parsed.home : '',
  };
};

/**
 * The home repo's slug, from the one file published beside the pages.
 *
 * Unauthenticated, because it is public and says nothing the site's own URL does
 * not: the repo it is served from.
 *
 * It carries the BRANCH as well as the repo (issue #112): the publish pushes
 * whatever branch the home clone is on, so the reader is told which one rather
 * than assuming the account's default is named `main`.
 *
 * @param {object} ctx
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, home: string|null, branch: string, status: number|null, reason: string|null}>}
 */
export const fetchHome = async (ctx = {}) => {
  const url = ctx.homePath || HOME_PATH;
  let response;
  try {
    response = await ctx.fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { ok: false, home: null, branch: ROSTER_REF, status: null, reason: `${url} did not answer (${error.message})` };
  }
  if (!response.ok) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} answered ${response.status} — this site was published without its home repo` };
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch (error) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} is not JSON (${error.message})` };
  }
  const home = parsed && typeof parsed.home === 'string' && parsed.home.includes('/') ? parsed.home : null;
  // A site published before the key existed says nothing about a branch, which
  // is the one case the fallback is for.
  const branch = (parsed && typeof parsed.branch === 'string' && parsed.branch) ? parsed.branch : ROSTER_REF;
  if (!home) return { ok: false, home: null, branch, status: response.status, reason: `${url} names no home repo, so there is nowhere to read the board's repositories from` };
  return { ok: true, home, branch, status: response.status, reason: null };
};

/**
 * Read the roster: the repos this board covers.
 *
 * Two steps, because the list is PRIVATE (issue #110). Pages is public even when
 * the repo serving it is not, so the names of the repositories on it are read
 * from the home repo's default branch through the API — with the same viewer
 * token the sweep uses, and refused in the same words when it does not reach.
 * The only thing published beside the pages is which repo to ask.
 *
 * @param {object} ctx
 * @param {string} ctx.token
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, data: object|null, status: number|null, reason: string|null}>}
 */
export const fetchSlugs = async (ctx = {}) => {
  const pointer = await fetchHome(ctx);
  if (!pointer.ok) return { ok: false, data: null, status: pointer.status, reason: pointer.reason };

  // The raw media type, so the answer is the file itself rather than GitHub's
  // envelope with the bytes base64'd inside it.
  const answer = await rest(
    `/repos/${pointer.home}/contents/${ROSTER_PATH}?ref=${encodeURIComponent(pointer.branch)}`,
    ctx,
    { accept: 'application/vnd.github.raw+json' },
  );
  if (!answer.ok) return { ok: false, data: null, status: answer.status, reason: answer.reason };
  if (!answer.data || !Array.isArray(answer.data.repos)) {
    return { ok: false, data: null, status: answer.status, reason: `${pointer.home} answered without a repo list at ${ROSTER_PATH} — the board has no repositories to sweep` };
  }
  return {
    ok: true,
    data: parseSlugs({ repos: answer.data.repos, home: answer.data.home || pointer.home }),
    status: answer.status,
    reason: null,
  };
};

// ── The board ──────────────────────────────────────────────────────────────

/** The sweep, one aliased field per repo — one request whatever the roster's size. */
export const buildBoardQuery = (slugs) => {
  const fields = slugs.map((slug, i) => {
    const [owner, name] = slug.split('/');
    return `  r${i}: repository(owner: "${owner}", name: "${name}") {
    issues(states: OPEN, first: ${PAGE_SIZE}, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number
        title
        url
        body
        createdAt
        updatedAt
        comments { totalCount }
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

/** How many of a repo's closed issues were closed in the last 24 hours — the API's own count. */
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

/** `group:value` labels into a map of group → values, keeping only the groups the vocabulary defines. */
export const parseLabels = (nodes) => {
  const out = {};
  for (const node of nodes || []) {
    const name = node && node.name;
    if (typeof name !== 'string') continue;
    const idx = name.indexOf(':');
    if (idx < 1) continue;
    const group = name.slice(0, idx);
    if (!LABEL_GROUPS.has(group)) continue;
    (out[group] = out[group] || []).push(name.slice(idx + 1));
  }
  return out;
};

// The inline fallback for a dependency GitHub itself will not hold (issue #103)
// — tower/api/lib/board.js's label and expression, restated for the copy-boundary
// reason every other rule here is, and pinned against it by the suite.
const DEPENDS_LABEL = 'depends on:';
const DEPENDS_RE = /(?:^|[\s,;(])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/g;

/**
 * What one issue is WAITING on — the native edges merged with that inline
 * fallback, in the API's own composition: a CLOSED edge is satisfied and never
 * surfaces, an inline reference carries no state and counts until the line is
 * edited away, and the same blocker written both ways is one edge.
 *
 * @param {object} node the issue node as GraphQL answered it
 * @param {string} slug the repo it was swept from — what a bare `#<n>` means
 * @returns {Array<{repo: string, number: number}>} empty when it waits on nothing
 */
export const blockersFor = (node, slug) => {
  const out = [];
  const seen = new Set();
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

/** A GraphQL errors array indexed by the alias it names; an error with no path belongs to no repo. */
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
 * One GraphQL answer, normalized to the board payload the pages read.
 *
 * @param {string[]} slugs - the roster, in the order the aliases were built
 * @param {object} data - the answer's `data`
 * @param {object[]} errors - its `errors`, if any
 * @param {number} [now] - epoch ms the day's closed count is measured back from
 * @returns {{ok: true, issues: object[], repos: object[]}}
 */
export const normalizeBoard = (slugs, data, errors, now = Date.now()) => {
  const aliasErrors = errorsByAlias(errors);
  const issues = [];
  const repos = [];

  slugs.forEach((slug, i) => {
    const alias = `r${i}`;
    const resolved = (data || {})[alias];
    const conn = (resolved || {}).issues || {};
    const nodes = conn.nodes || [];
    const total = typeof conn.totalCount === 'number' ? conn.totalCount : nodes.length;
    repos.push({
      slug,
      count: nodes.length,
      totalCount: total,
      truncated: total > nodes.length,
      closedDay: closedSince(resolved, now),
      error: aliasErrors[alias] || (resolved ? null : 'not resolved'),
    });
    for (const node of nodes) {
      const parsed = parseLabels((node.labels || {}).nodes);
      const agent = parsed.agent || [];
      const body = String(node.body || '');
      issues.push({
        repo: slug,
        number: node.number,
        title: node.title,
        url: node.url,
        body: body.slice(0, BODY_LIMIT),
        bodyTruncated: body.length > BODY_LIMIT,
        comments: ((node.comments || {}).totalCount) || 0,
        createdAt: node.createdAt || null,
        updatedAt: node.updatedAt,
        status: (parsed.status || [])[0] || null,
        type: (parsed.type || [])[0] || null,
        priority: (parsed.priority || [])[0] || null,
        agentOk: agent.includes('ok'),
        agentWorking: agent.includes('working'),
        assignees: ((node.assignees || {}).nodes || []).map((a) => a.login),
        blockedBy: blockersFor(node, slug),
      });
    }
  });

  return { ok: true, issues, repos };
};

/**
 * Sweep the board.
 *
 * The STATUS survives a failure alongside the reason, because one status is
 * acted on rather than read: a token GitHub refused is the one failure a new
 * token fixes, and the runtime turns it back into the prompt (page.js).
 *
 * @param {string[]} slugs
 * @param {object} ctx - `{ token, fetch }`
 * @returns {Promise<{ok: boolean, reason?: string, status?: number|null, issues: object[], repos: object[]}>}
 */
export const fetchBoard = async (slugs, ctx = {}) => {
  if (!slugs.length) return { ok: true, issues: [], repos: [] };
  const answer = await graphql(buildBoardQuery(slugs), ctx);
  if (!answer.ok) {
    return {
      ok: false, reason: answer.reason, status: answer.status, issues: [], repos: [],
    };
  }
  return normalizeBoard(slugs, answer.data, answer.errors);
};

/** The two statuses that mean the TOKEN is the problem, not the read. */
const REFUSED = [401, 403];

/**
 * Whether a feed result is GitHub refusing the token itself.
 *
 * One home for the question, because two places ask it: the fetchers here and
 * the runtime, which answers a refusal with the prompt instead of a page problem.
 *
 * @param {{ok: boolean, status: number|null}} result - a feed result
 * @returns {boolean}
 */
export const isTokenRefusal = (result) => Boolean(result) && result.ok === false && REFUSED.includes(result.status);

// ── The summaries ──────────────────────────────────────────────────────────

// The card is SUMMARIES, and the board is shared: the 9am job publishes its
// digest there too, as a Discussion titled `brief: <date>` (the prefix
// `jobs/cc-news.js` reads its cursor back by), roughly one a day beside each
// summary. GraphQL has no title filter, so the read asks for a wider window and
// the prefix is dropped here — a card of five summaries, not five posts.
const BRIEF_TITLE_PREFIX = 'brief: ';
const SUMMARY_WINDOW = 20;
const SUMMARY_LIMIT = 5;

/** The latest Discussions on the home repo — where the daily summaries are published. */
export const buildDiscussionsQuery = (slug, first = SUMMARY_LIMIT) => {
  const [owner, name] = slug.split('/');
  return `query {
  repository(owner: "${owner}", name: "${name}") {
    discussions(first: ${first}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { title url createdAt category { name } }
    }
  }
}
`;
};

/** The discussion nodes, flattened to what a list draws. */
export const normalizeDiscussions = (data) => ((((data || {}).repository || {}).discussions || {}).nodes || [])
  .filter(Boolean)
  .map((node) => ({
    title: node.title || '',
    url: node.url || '',
    createdAt: node.createdAt || null,
    category: (node.category && node.category.name) || null,
  }));

/**
 * The published summaries, or an empty list with the reason it is empty.
 *
 * A site whose home repo is not in the slug list has nowhere to read them from,
 * which is a fact about the publish rather than a failure of this read.
 *
 * The morning briefs sharing the board are not summaries and do not appear.
 *
 * @param {string} home - the home repo slug, or ''
 * @param {object} ctx
 * @returns {Promise<{ok: boolean, reason: string|null, items: object[]}>}
 */
export const fetchSummaries = async (home, ctx = {}) => {
  if (!home) return { ok: false, reason: 'this site was published without a home repo, so it has no summaries to read', items: [] };
  const answer = await graphql(buildDiscussionsQuery(home, SUMMARY_WINDOW), ctx);
  if (!answer.ok) return { ok: false, reason: answer.reason, items: [] };
  const items = normalizeDiscussions(answer.data)
    .filter((item) => !item.title.startsWith(BRIEF_TITLE_PREFIX))
    .slice(0, SUMMARY_LIMIT);
  return { ok: true, reason: null, items };
};

// ── The brief ──────────────────────────────────────────────────────────────

// The four sections, the urgency order and the headline are tower/api/lib/brief.js's
// rules, restated because that module is on the other side of the copy boundary.
// `warnings` is the one thing this side cannot answer: uncommitted, unpushed and
// unreleased are read off the working copies on a machine, and a browser has
// none — so it is always empty here and the page says why rather than showing a
// clean table that would read as good news.

const briefIssue = (issue) => ({
  repo: issue.repo,
  number: issue.number,
  title: issue.title,
  url: issue.url,
  body: issue.body || '',
  bodyTruncated: Boolean(issue.bodyTruncated),
  comments: issue.comments || 0,
  createdAt: issue.createdAt || null,
  updatedAt: issue.updatedAt || null,
  status: issue.status || null,
  type: issue.type || null,
  priority: issue.priority || null,
  agentOk: Boolean(issue.agentOk),
  assignees: issue.assignees || [],
  blockedBy: issue.blockedBy || [],
});

// The three priority bands are format.js's — the same ones the Board sorts and
// colours by — so the brief and the board can never disagree about what "high"
// is. Only the tie-break differs: a brief section reads oldest first.
const byUrgency = (a, b) => {
  const spread = priorityRank(a.priority) - priorityRank(b.priority);
  if (spread !== 0) return spread;
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
};

// `nextUp` is that module's rule too, and restated for the same reason: the few
// items a morning could move, per repo — decisions, then the checks waiting on
// the owner, then accepted specs — three at most. The published copy carries it
// because the payloads are one shape — the suite compares them key for key.
const NEXT_UP_PER_REPO = 3;

// The per-repo sweep counts the payload carries, and the roster-wide closed
// count summed off them — that module's `repoCountsFrom`, restated. A published
// copy carries them for the same reason it carries `nextUp`: the payloads are
// one shape, and the suite compares them key for key.
const repoCountsFrom = (board) => ((board && board.repos) || [])
  .filter((repo) => !repo.error)
  .map((repo) => ({
    slug: repo.slug,
    open: typeof repo.totalCount === 'number' ? repo.totalCount : (repo.count || 0),
    closedDay: typeof repo.closedDay === 'number' ? repo.closedDay : 0,
  }));

// An issue waiting on another orders last inside its repo and says which ones
// (issue #103) — that module's rule as well, down to which edges count: only a
// blocker the sweep can see is still open, matched on the `repo#number` pair
// rather than the number alone.
const nextUpFrom = (issues) => {
  // Repo names are case-insensitive on GitHub and the inline fallback is
  // hand-typed, so the match folds case — and answers in the sweep's spelling.
  const open = new Map(issues.map((issue) => [issueKey(issue).toLowerCase(), issueKey(issue)]));
  const waitsOnFor = (issue) => (issue.blockedBy || [])
    .map((blocker) => open.get(issueKey(blocker).toLowerCase()))
    .filter(Boolean);
  const actionable = [
    ...issues.filter((i) => i.status === 'blocked'),
    ...issues.filter((i) => i.status === 'qa'),
    ...issues.filter((i) => i.status === 'specced'),
  ];
  const byRepo = new Map();
  for (const issue of actionable) {
    const items = byRepo.get(issue.repo) || [];
    items.push({
      number: issue.number,
      title: issue.title,
      repo: issue.repo,
      status: issue.status || null,
      priority: issue.priority || null,
      url: issue.url,
      waitsOn: waitsOnFor(issue),
    });
    byRepo.set(issue.repo, items);
  }
  return [...byRepo].map(([repo, items]) => ({
    repo,
    items: [...items.filter((i) => !i.waitsOn.length), ...items.filter((i) => i.waitsOn.length)].slice(0, NEXT_UP_PER_REPO),
  }));
};

/** The headline — the order of consequence, in the API's own words. */
export const headlineFor = (counts) => {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (counts.waiting) return `${plural(counts.waiting, 'issue is', 'issues are')} waiting on a decision from you.`;
  if (counts.qa) return `${plural(counts.qa, 'issue is', 'issues are')} built and waiting on your check.`;
  if (counts.inFlight) return `${plural(counts.inFlight, 'issue is', 'issues are')} in flight, and nothing is blocked.`;
  if (counts.ready) return `Nothing is blocked — ${plural(counts.ready, 'issue is', 'issues are')} specced and ready to start.`;
  if (counts.inbox) return `The board is clear of specced work; ${plural(counts.inbox, 'item is', 'items are')} sitting in the inbox.`;
  return 'Nothing is waiting, in flight, or ready — the board is empty.';
};

/**
 * The brief, from the board this browser just swept.
 *
 * @param {object} board - the sweep
 * @param {object} [opts] - `{ generatedAt, summaries }`
 * @returns {object} the same payload shape /api/brief serves
 */
export const buildBrief = (board, opts = {}) => {
  const issues = (board && Array.isArray(board.issues) ? board.issues : []).slice().sort(byUrgency);

  const waiting = issues.filter((i) => i.status === 'blocked').map(briefIssue);
  // Its own section, the API's brief's rule (issue #135): a qa item is finished
  // work waiting on the OWNER, not work somebody is still on.
  const qa = issues.filter((i) => i.status === 'qa').map(briefIssue);
  // The status label is the whole answer here as it is in the API's brief
  // (issue #62): a claimed `specced` issue is a transient the standards sweep
  // flips to `building`, never a second in-flight shape to be read for.
  const ready = issues.filter((i) => i.status === 'specced').map(briefIssue);
  const inFlight = issues.filter((i) => i.status === 'building').map(briefIssue);
  const inbox = issues.filter((i) => i.status === 'inbox').map(briefIssue);

  const counts = {
    open: issues.length,
    waiting: waiting.length,
    qa: qa.length,
    ready: ready.length,
    inFlight: inFlight.length,
    inbox: inbox.length,
    parked: issues.filter((i) => i.status === 'parked').length,
  };

  const repoCounts = repoCountsFrom(board);

  return {
    ok: Boolean(board && board.ok),
    reason: board && board.ok === false ? (board.reason || 'the board sweep failed') : null,
    generatedAt: opts.generatedAt || new Date().toISOString(),
    headline: headlineFor(counts),
    counts,
    closedDay: repoCounts.reduce((sum, repo) => sum + repo.closedDay, 0),
    repoCounts,
    nextUp: nextUpFrom(issues),
    waiting,
    qa,
    ready,
    inFlight,
    inbox,
    warnings: [],
    summaries: opts.summaries || null,
    history: opts.history || null,
  };
};

// ── The history ────────────────────────────────────────────────────────────
//
// The board over time, read back off the published briefs (issue #55). The
// server reads exactly this (tower/api/lib/history.js) and this side cannot
// import it, so the prefix, the pattern and the cap are restated and the suite
// pins the parse against the server's own.

/** The line a brief carries its day's numbers on — jobs/stats.js renders it. */
const STATS_RE = /<!--\s*workkit-stats:\s*(\{.*\})\s*-->/;

/** How many mornings a chart draws, and how wide the read that finds them is. */
const HISTORY_LIMIT = 35;
const HISTORY_WINDOW = 100;

/** The same Discussions read the summaries make, WITH the body the line lives in. */
export const buildHistoryQuery = (slug, first = HISTORY_WINDOW) => {
  const [owner, name] = slug.split('/');
  return `query {
  repository(owner: "${owner}", name: "${name}") {
    discussions(first: ${first}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { title body }
    }
  }
}
`;
};

/** One brief body's stats block, or null — a brief published before the block is simply skipped. */
export const parseStatsMark = (body) => {
  const match = STATS_RE.exec(String(body || ''));
  if (!match) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.date !== 'string' || !parsed.date) return null;
  if (!parsed.totals || typeof parsed.totals !== 'object') return null;
  return {
    date: parsed.date,
    totals: parsed.totals,
    closedDay: typeof parsed.closedDay === 'number' ? parsed.closedDay : 0,
    repos: (parsed.repos && typeof parsed.repos === 'object') ? parsed.repos : {},
  };
};

/** The discussion nodes, parsed into the history series — oldest first, the order a chart draws in. */
export const normalizeHistory = (data) => {
  const nodes = (((data || {}).repository || {}).discussions || {}).nodes || [];
  const entries = [];
  for (const node of nodes) {
    if (!node || typeof node.title !== 'string') continue;
    if (!node.title.startsWith(BRIEF_TITLE_PREFIX)) continue;
    const stats = parseStatsMark(node.body);
    if (stats) entries.push(stats);
  }
  return entries.slice(0, HISTORY_LIMIT).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * The board over time, or null when it could not be read.
 *
 * NULL rather than an empty list, because the two say opposite things: a site
 * whose home repo cannot be reached has no history to show, while a home repo
 * whose briefs carry no stats line yet has a history that is genuinely empty —
 * and the page says a different sentence for each.
 *
 * @param {string} home - the home repo slug, or ''
 * @param {object} ctx
 * @returns {Promise<Array<object>|null>}
 */
export const fetchHistory = async (home, ctx = {}) => {
  if (!home) return null;
  const answer = await graphql(buildHistoryQuery(home), ctx);
  if (!answer.ok) return null;
  return normalizeHistory(answer.data);
};

// ── The one door ───────────────────────────────────────────────────────────

/**
 * Answer one feed path against GitHub — the published half of api.js's
 * `fetchFeed`, in the same four-key shape and with the same promise never to
 * throw.
 *
 * The slug list is read on every call rather than held: it is one cached static
 * file and one small API read, so re-reading it costs almost nothing, and a site
 * republished under an open tab starts sweeping the new roster.
 *
 * @param {string} path - '/api/repos', '/api/board' or '/api/brief'
 * @param {object} ctx - `{ token, fetch, homePath, generatedAt }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const readFeed = async (path, ctx = {}) => {
  const list = await fetchSlugs(ctx);
  if (!list.ok) return list;
  const { repos, home } = list.data;
  const slugs = repos.map((repo) => repo.slug);

  if (path === '/api/repos') return { ok: true, data: repos, status: 200, reason: null };

  const board = await fetchBoard(slugs, ctx);
  if (path === '/api/board') {
    return board.ok
      ? { ok: true, data: board, status: 200, reason: null }
      : { ok: false, data: null, status: board.status || null, reason: board.reason };
  }

  if (path === '/api/brief') {
    const summaries = await fetchSummaries(home, ctx);
    // The history rides the brief here exactly as it does on the tower's own
    // endpoint, so the charts on Overview and Brief work off-machine too.
    const history = await fetchHistory(home, ctx);
    return board.ok
      ? { ok: true, data: buildBrief(board, { generatedAt: ctx.generatedAt, summaries, history }), status: 200, reason: null }
      : { ok: false, data: null, status: board.status || null, reason: board.reason };
  }

  // A page asking for a feed only the machine can answer. It is the runtime's
  // job to keep those pages from arming at all (page.js), so reaching here is a
  // wiring mistake and says so in the sentence the page will draw.
  return { ok: false, data: null, status: null, reason: `${path} is not something a published copy can read` };
};

// ── The two writes ─────────────────────────────────────────────────────────
//
// The tower has exactly two write paths, and so does this: moving an issue
// along the pipeline (the Board's drag) and filing one (the intake dialog).
// The published copy performs them with the SAME token it reads with, which is
// what makes the site function exactly like the dashboard on the machine, and
// why the token asks for Issues: Read and write.
//
// They speak REST where the reads speak GraphQL, for one reason: a GraphQL
// mutation addresses a label by node ID, so each write would first have to look
// up the issue's id and an id per label name. REST speaks label NAMES — the
// vocabulary the columns, the sweep and workflow/labels.json already use — so a
// write is the plainest call that can do the job. Same host, same bearer token,
// same four-key result and the same promise never to throw.

const REST_URL = 'https://api.github.com';

// The intake rules, restated from tower/api/server.js for the copy-boundary
// reason the sweep is: nothing under tower/api/ is reachable from the published
// project. A published copy has no endpoint to refuse a bad intake, so the
// refusals are made here in the endpoint's own words, and the suite pins each
// value against its source.

/** The longest title the endpoint accepts. */
export const TITLE_MAX = 256;

/** The longest body it accepts. */
export const BODY_MAX = 4000;

/** What a filed issue says when the dialog was submitted with no body. */
export const DEFAULT_BODY = 'Filed from the tower.';

/** What every filed issue is labelled: captured, and an idea until triage says otherwise. */
export const INTAKE_LABELS = ['status:inbox', 'type:idea'];

/**
 * What a refused WRITE means — which is not what a refused read means.
 *
 * A token that reads these repositories and cannot change them answers 403 on
 * the write and nothing else, and the viewer holding it has no way of knowing
 * that from "GitHub refused the token": the board just drew itself with it. So
 * the sentence names the missing permission and how to get it.
 *
 * @param {number} status - 401 or 403
 * @returns {string}
 */
const writeRefusal = (status) => (status === 403
  ? 'GitHub refused the write (403) — this token can read these repositories but not change them. Make one with Issues: Read and write, and hand that one over.'
  : 'GitHub refused the token (401) — it is expired, or it is not a token any more. Hand over a fresh one.');

/**
 * What a refused READ means — the other half, and the reason the two are split.
 *
 * A write is two calls: the issue is read, then patched. A 403 on the READ says
 * the token cannot SEE that repository, and telling that viewer to make a token
 * with write access sends them after the wrong permission.
 *
 * @param {number} status - 401 or 403
 * @returns {string}
 */
const readRefusal = (status) => (status === 403
  ? 'GitHub refused the read (403) — this token does not cover that repository. Hand over one that does.'
  : 'GitHub refused the token (401) — it is expired, or it is not a token any more. Hand over a fresh one.');

/**
 * One REST request.
 *
 * @param {string} path - the path under api.github.com
 * @param {object} ctx - `{ token, fetch }`
 * @param {object} [init] - `{ method, body, accept }`; a body is sent as JSON
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
const rest = async (path, ctx = {}, init = {}) => {
  const token = ctx.token || '';
  if (!token) return { ok: false, data: null, status: null, reason: NO_TOKEN };

  const method = init.method || 'GET';
  let response;
  try {
    response = await ctx.fetch(`${REST_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: init.accept || 'application/vnd.github+json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    return { ok: false, data: null, status: null, reason: `GitHub did not answer (${error.message})` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (REFUSED.includes(response.status)) {
    const refusal = method === 'GET' ? readRefusal : writeRefusal;
    return { ok: false, data: null, status: response.status, reason: refusal(response.status) };
  }
  if (!response.ok) {
    // GitHub's own sentence is the useful half of a refusal that is not the
    // token's fault — a deleted issue, a label the repo does not carry.
    const said = payload && payload.message;
    return { ok: false, data: null, status: response.status, reason: said ? `GitHub answered ${response.status}: ${said}` : `GitHub answered ${response.status}` };
  }
  return { ok: true, data: payload, status: response.status, reason: null };
};

/**
 * The label set one move leaves behind: the old status off, the new one on,
 * every other label untouched.
 *
 * This is the endpoint's semantics exactly — `gh issue edit --remove-label
 * status:<from> --add-label status:<to>`, one call so the issue is never
 * momentarily unlabelled and never momentarily carrying two statuses. Pure, so
 * the invariant is askable without a request.
 *
 * @param {Array<{name: string}|string>} current - the labels the issue carries now
 * @param {string} from - the status being left
 * @param {string} to - the status being moved to
 * @returns {string[]} the whole set to write
 */
export const nextLabels = (current, from, to) => {
  const kept = (current || [])
    .map((label) => (typeof label === 'string' ? label : (label && label.name) || ''))
    .filter((name) => name && name !== `status:${from}`);
  const wanted = `status:${to}`;
  return kept.includes(wanted) ? kept : [...kept, wanted];
};

/** The shape of a repository slug, the endpoint's own pattern. */
const SLUG_SHAPE = /^[\w.-]+\/[\w.-]+$/;

/**
 * The statuses a move may name — the label vocabulary's `status` group,
 * restated across the copy boundary for the reason the groups above are, and
 * pinned to `workflow/labels.json` by the suite.
 */
export const MOVE_STATUSES = ['inbox', 'specced', 'building', 'qa', 'blocked', 'parked'];

/**
 * What a move may do, or why it may not — the endpoint's `validateMove`, on
 * this side of the copy boundary.
 *
 * The endpoint judges every field before `gh` is reached and trusts none of
 * them for being well formed; so does this, for the same reason: a drag on a
 * page is where these values come from, which is exactly why none of that is
 * assumed. The repo is checked for SHAPE rather than membership — unlike an
 * intake, whose repo is chosen in a dialog, a move's repo is one this site
 * swept, and confirming it against the roster would cost the two reads that
 * fetch it, which the move does not otherwise need.
 *
 * @param {object} move - `{ repo, number, from, to }`
 * @returns {{ok: boolean, reason?: string, repo?: string, number?: number, from?: string, to?: string}}
 */
export const validateMove = (move) => {
  if (!move || typeof move !== 'object') return { ok: false, reason: 'nothing to move' };

  const { number } = move;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return { ok: false, reason: 'issue number must be a positive integer' };
  }

  const repo = typeof move.repo === 'string' ? move.repo.trim() : '';
  if (!SLUG_SHAPE.test(repo)) return { ok: false, reason: `not a repository slug: ${repo || '(none)'}` };

  const from = typeof move.from === 'string' ? move.from.trim() : '';
  const to = typeof move.to === 'string' ? move.to.trim() : '';
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (!MOVE_STATUSES.includes(value)) return { ok: false, reason: `${field} is not a status: ${value || '(none)'}` };
  }
  if (from === to) return { ok: false, reason: `the issue is already status:${to}` };

  return {
    ok: true, repo, number, from, to,
  };
};

/**
 * Move one issue along the pipeline — the Board's drag, written straight to
 * GitHub.
 *
 * Two calls, one mutation: REST replaces the whole label set, so the labels the
 * issue carries NOW are read first. They are read rather than taken from the
 * board's copy because that copy is up to a minute old, and a label added since
 * the sweep must survive a status move that knows nothing about it.
 *
 * @param {{repo: string, number: number, from: string, to: string}} move - api.js's `moveRequest`
 * @param {object} ctx - `{ token, fetch }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `data` is the answer the tower's endpoint sends, so the page reads one shape
 */
export const moveIssueStatus = async (move, ctx = {}) => {
  const checked = validateMove(move);
  // The endpoint answers a refused move 400 with the reason; so does this, and
  // the board puts the card back where it was.
  if (!checked.ok) return { ok: false, data: null, status: 400, reason: checked.reason };
  const { repo, number, from, to } = checked;

  const read = await rest(`/repos/${repo}/issues/${number}`, ctx);
  if (!read.ok) return read;

  // A PATCH sends the WHOLE label set, so a read that answered without one is
  // not a base to write from: relabelling off nothing would take every label
  // the issue carries with it.
  const carried = (read.data || {}).labels;
  if (!Array.isArray(carried)) {
    return {
      ok: false,
      data: null,
      status: read.status,
      reason: 'GitHub answered the read without the issue’s labels, so the move had nothing safe to write from — nothing was changed.',
    };
  }

  const written = await rest(`/repos/${repo}/issues/${number}`, ctx, {
    method: 'PATCH',
    body: { labels: nextLabels(carried, from, to) },
  });
  if (!written.ok) return written;

  return {
    ok: true, data: { ok: true, repo, number, status: to }, status: written.status, reason: null,
  };
};

/**
 * What an intake may do, or why it may not — the endpoint's `validateIntake`,
 * on this side of the copy boundary.
 *
 * The repo is checked against the site's own slug list rather than pattern
 * matched, for the endpoint's reason: that list is the only set of repositories
 * this copy has agreed to file against. Its SPELLING is what gets filed, since
 * GitHub names are case-insensitive and a slug is whatever case the roster
 * carried.
 *
 * @param {object} payload - `{ repo, title, body }`
 * @param {string[]} slugs - the roster this site sweeps
 * @returns {{ok: boolean, reason?: string, repo?: string, title?: string, body?: string}}
 */
export const validateIntake = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };
  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const repo = (slugs || []).find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked || '(none)'}` };
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > TITLE_MAX) return { ok: false, reason: `title is longer than ${TITLE_MAX} characters` };
  if (body.length > BODY_MAX) return { ok: false, reason: `body is longer than ${BODY_MAX} characters` };
  return { ok: true, repo, title, body: body || DEFAULT_BODY };
};

/**
 * File one issue — the intake dialog, written straight to GitHub.
 *
 * @param {{repo: string, title: string, body: string}} payload - what the dialog holds
 * @param {object} ctx - `{ token, fetch, homePath }`
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `data` is `{ ok: true, url }`, the endpoint's own answer, which the dialog links
 */
export const createIssue = async (payload, ctx = {}) => {
  if (!(ctx.token || '')) return { ok: false, data: null, status: null, reason: NO_TOKEN };

  const list = await fetchSlugs(ctx);
  if (!list.ok) return { ok: false, data: null, status: list.status, reason: list.reason };

  const checked = validateIntake(payload, list.data.repos.map((repo) => repo.slug));
  // The endpoint answers a refused intake 400 with the reason; so does this, and
  // the dialog shows that sentence and leaves what was typed alone.
  if (!checked.ok) return { ok: false, data: null, status: 400, reason: checked.reason };

  const written = await rest(`/repos/${checked.repo}/issues`, ctx, {
    method: 'POST',
    body: { title: checked.title, body: checked.body, labels: INTAKE_LABELS },
  });
  if (!written.ok) return written;

  const url = (written.data || {}).html_url;
  if (!url) return { ok: false, data: null, status: written.status, reason: 'GitHub filed the issue but answered without its URL' };
  return { ok: true, data: { ok: true, url }, status: written.status, reason: null };
};
