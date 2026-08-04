//
// The published briefs, read back — what the board looked like on the mornings
// before this one.
//
// Nothing on a machine records the shape of a day. The one durable trace a
// morning leaves is the Discussion the runner publishes on the home repo, so
// that post is where the history lives too: every brief carries a machine
// readable `workkit-stats` line, appended after the digest exactly the way the
// upstream-news cursor is (jobs/stats.js renders it, `jobs/brief-publish.sh`
// appends it), and reading those lines back IS the history. No store, no
// backfill, no second source of truth — a brief that was never published is a
// day the charts do not have, which is the honest answer.
//
// THIS MODULE OWNS THE TWO LITERALS the writer and the reader share: the title
// prefix a brief publishes under, and the pattern its stats line matches. They
// live here rather than in `jobs/` because both halves can reach `tower/api/lib`
// while nothing under `tower/` may reach back into the job layer.
//
// EVERY FAILURE IS null, the posture `summaries.js` reads its board with: no
// home repo, no `gh`, a token that refuses, an answer of another shape. A page
// says the history could not be read; it never says the board was empty.
//
// Usage:
//   const { briefHistory, STATS_RE } = require('./history');
//   briefHistory({ workflowHome, exec });   // ascending by date, oldest first
//

const { execFileSync } = require('child_process');

const { homeSlugFor } = require('./summaries');

/**
 * The title every published brief carries (`jobs/brief-publish.sh` writes it,
 * `jobs/cc-news.js` reads its cursor back by it). One home, three readers.
 */
const BRIEF_TITLE_PREFIX = 'brief: ';

/**
 * The stats line, as it sits in a published brief's body. The renderer is
 * `jobs/stats.js` — writer and reader are two halves of one shape, which is why
 * the pattern lives beside the prefix rather than beside either half.
 */
const STATS_RE = /<!--\s*workkit-stats:\s*(\{.*\})\s*-->/;

// How many mornings a chart draws. Five weeks is enough to see a trend and
// short enough that a line chart's points stay distinguishable; the read itself
// asks for the page maximum, since the board is SHARED — the summaries publish
// beside the briefs — and a narrow window would answer with half as many days.
const HISTORY_LIMIT = 35;
const WINDOW = 100;

const HISTORY_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    discussions(first:${WINDOW}, orderBy:{field:CREATED_AT, direction:DESC}){
      nodes { title body }
    }
  }
}`;

const defaultExec = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

/**
 * One brief body's stats block, or null.
 *
 * A brief without one is not a failure: every morning published before the
 * block existed is exactly that shape, and so is a morning whose payload could
 * not be composed. The caller skips it and the series is one day shorter.
 *
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
 * The board over time, oldest first — one entry per published brief that
 * carried a stats line.
 *
 * ASCENDING because that is the order a chart draws in, and the axis is the one
 * consumer: a caller that wanted the newest would ask for the last entry rather
 * than reverse a series.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout — the gh seam
 * @returns {Array<{date: string, totals: object, closedDay: number, repos: object}>|null}
 *   null when the board could not be read at all
 */
const briefHistory = (opts = {}) => {
  const slug = homeSlugFor(opts);
  if (!slug) return null;
  const [owner, name] = slug.split('/');
  const exec = opts.exec || defaultExec;

  let nodes;
  try {
    const out = exec('gh', ['api', 'graphql', '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `query=${HISTORY_QUERY}`]);
    nodes = JSON.parse(out).data.repository.discussions.nodes;
  } catch {
    return null;
  }
  if (!Array.isArray(nodes)) return null;

  const entries = [];
  for (const node of nodes) {
    if (!node || typeof node.title !== 'string') continue;
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

module.exports = {
  briefHistory, parseStatsMark, BRIEF_TITLE_PREFIX, STATS_RE, HISTORY_LIMIT,
};
