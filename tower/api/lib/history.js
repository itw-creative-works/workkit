// The published briefs, read back: the mornings before this one, off the
// `workkit-stats` line each brief carries (tower/README.md § The pages). It owns
// the two literals writer and reader share (the title prefix, the stats pattern):
// jobs/ can reach tower/api/lib, and nothing under tower/ reaches back.
//
// Usage:
//   briefHistory({ workflowHome, exec });   // ascending by date, oldest first

const { execFileSync } = require('child_process');

// The sweep's round trip, and with it the reading of a refusal: one `gh api
// graphql` and one answer to "why did that come back empty" for the whole tower.
const { ask } = require('./board');
const { homeSlugFor } = require('./summaries');

/**
 * The title every published brief carries (`jobs/morning/brief-publish.sh` writes it,
 * `jobs/morning/brief/cc-news.js` reads its cursor back by it). One home, three readers.
 */
const BRIEF_TITLE_PREFIX = 'brief: ';

/**
 * The stats line, as it sits in a published brief's body; its renderer is
 * `jobs/morning/brief/stats.js`.
 */
const STATS_RE = /<!--\s*workkit-stats:\s*(\{.*\})\s*-->/;

// How many mornings a chart draws. Five weeks is enough to see a trend and
// short enough that a line chart's points stay distinguishable; the read itself
// asks for the page maximum, since the board is shared (the summaries publish
// beside the briefs) and a narrow window would answer with half as many days.
const HISTORY_LIMIT = 35;
const WINDOW = 100;

// `url` and `createdAt` ride the same query the bodies do: the archive names
// each document by its day and links it back to the post, and four scalars off
// one read cost nothing beside a second round trip for two of them.
const HISTORY_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:${WINDOW}, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title url createdAt body }
    }
  }
}`;

// stderr is piped, not ignored: `gh` writes its "gh auth login" guidance there,
// and the reading that names an auth failure as one needs that text (board.js).
const defaultExec = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

/**
 * One brief body's stats block, or null: a brief without one (published before
 * the line, or whose payload failed) is skipped, never a failure.
 * @param {string} body the Discussion body
 * @returns {{date: string, totals: object, closedDay: number, repos: object}|null}
 */
const parseStatsMark = (body) => {
  const match = STATS_RE.exec(String(body || ''));
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    // A line that is not JSON is a line a chart cannot draw.
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

/**
 * The home repo's Discussions, newest first: the one round trip every reading
 * is made from, each node normalized here. Both keys, always: `nodes` is null
 * where nothing could be read, and `reason` says why when there is a why.
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout: the gh seam
 * @returns {{nodes: Array<{title: string, url: string, createdAt: string|null, body: string}>|null, reason: string|null}}
 */
const readDiscussions = (opts = {}) => {
  const slug = homeSlugFor(opts);
  if (!slug) return { nodes: null, reason: null };
  const [owner, name] = slug.split('/');

  const { payload, reason } = ask(opts.exec || defaultExec, HISTORY_QUERY, { owner, name });
  if (!payload) return { nodes: null, reason };

  const nodes = (((payload.data || {}).repository || {}).discussions || {}).nodes;
  if (!Array.isArray(nodes)) return { nodes: null, reason: null };

  return {
    nodes: nodes.filter(Boolean).map((node) => ({
      title: typeof node.title === 'string' ? node.title : '',
      url: typeof node.url === 'string' ? node.url : '',
      createdAt: node.createdAt || null,
      body: typeof node.body === 'string' ? node.body : '',
    })),
    reason: null,
  };
};

/**
 * The board over time, oldest first (the order a chart draws in): one entry per
 * published brief that carried a stats line.
 * @param {Array<{title: string, body: string}>} nodes the `nodes` readDiscussions returned
 * @returns {Array<{date: string, totals: object, closedDay: number, repos: object}>}
 */
const historyFrom = (nodes) => {
  const entries = [];
  for (const node of nodes || []) {
    if (!node.title.startsWith(BRIEF_TITLE_PREFIX)) continue;
    const stats = parseStatsMark(node.body);
    if (stats) entries.push(stats);
  }

  // Newest first is what the query asked for, so the cap takes the newest
  // mornings and the sort puts them back in the order a chart reads.
  return entries
    .slice(0, HISTORY_LIMIT)
    .sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * The read and the reading, for a caller that wants only the series; one that
 * must say why it is missing reads `readDiscussions` itself.
 * @param {object} [opts] what readDiscussions takes
 * @returns {Array<object>|null} null when the board could not be read at all
 */
const briefHistory = (opts = {}) => {
  const { nodes } = readDiscussions(opts);
  return nodes && historyFrom(nodes);
};

// How old the newest brief may be, in whole UTC calendar days, before the cloud
// brief is judged stopped. `hooks/docs/session/run.sh` holds the same bar off the
// 9am marker (which counts any `brief: ` post): change both together.
const FRESH_DAYS = 1;
const DAY_MS = 86400000;

/** The UTC day a moment falls on: the same stamp `jobs/morning/brief/stats.js` dates a brief with. */
const utcDay = (when) => when.toISOString().slice(0, 10);

/**
 * Whether the cloud brief is still posting: arithmetic on what `briefHistory`
 * returned, never a second round trip. Its four states (fresh, stale, never,
 * unreadable): tower/README.md § The pages.
 * @param {Array<{date: string}>|null} history what briefHistory returned
 * @param {Date} [now] the moment to judge against
 * @returns {{state: string, date: string|null}}
 */
const briefFreshness = (history, now = new Date()) => {
  const unreadable = { state: 'unreadable', date: null };
  if (!Array.isArray(history)) return unreadable;
  if (!history.length) return { state: 'never', date: null };

  // Ascending by date is what briefHistory promises, so the newest morning is
  // the last entry.
  const date = history[history.length - 1].date;
  const age = (Date.parse(`${utcDay(now)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
  // A date the arithmetic cannot place is a date nothing can be judged against;
  // fresh and stale would both be guesses, so it says so instead.
  if (!Number.isFinite(age)) return unreadable;
  return { state: age > FRESH_DAYS ? 'stale' : 'fresh', date };
};

module.exports = {
  readDiscussions,
  historyFrom,
  briefHistory,
  briefFreshness,
  parseStatsMark,
  BRIEF_TITLE_PREFIX,
  STATS_RE,
  HISTORY_LIMIT,
};
