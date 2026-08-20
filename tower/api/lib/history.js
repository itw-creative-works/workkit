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
// It owns the READ as well, and one read answers two questions (issue #181):
// the series above, and the ARCHIVE the Brief page draws - the mornings and the
// summaries themselves, whole. Both come off the same hundred Discussions, so
// `readDiscussions` is the round trip and `historyFrom` / `documents.js` are two
// pure readings of what it brought back. Asking twice would be two round trips
// for one answer.
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
 * The home repo's Discussions, newest first — the ONE round trip both readings
 * are made from.
 *
 * Every field is normalized here so neither reading has to defend itself
 * against a node of another shape: a title that is not a string cannot start
 * with the prefix, and a body that is not a string carries no stats line.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.home] overrides ~ for the default above
 * @param {Function} [opts.exec] (cmd, args) => stdout — the gh seam
 * @returns {Array<{title: string, url: string, createdAt: string|null, body: string}>|null}
 *   null when the board could not be read at all
 */
const readDiscussions = (opts = {}) => {
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

  return nodes.filter(Boolean).map((node) => ({
    title: typeof node.title === 'string' ? node.title : '',
    url: typeof node.url === 'string' ? node.url : '',
    createdAt: node.createdAt || null,
    body: typeof node.body === 'string' ? node.body : '',
  }));
};

/**
 * The board over time, oldest first — one entry per published brief that
 * carried a stats line.
 *
 * ASCENDING because that is the order a chart draws in, and the axis is the one
 * consumer: a caller that wanted the newest would ask for the last entry rather
 * than reverse a series.
 *
 * @param {Array<{title: string, body: string}>} nodes what readDiscussions returned
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
 * The read and the reading, for a caller that wants only the series.
 *
 * @param {object} [opts] what readDiscussions takes
 * @returns {Array<object>|null} null when the board could not be read at all
 */
const briefHistory = (opts = {}) => {
  const nodes = readDiscussions(opts);
  return nodes && historyFrom(nodes);
};

// How old the newest published brief may be before the cloud brief is judged to
// have stopped. ONE whole calendar day: the brief posts once a morning, so at
// 08:00 the newest post is yesterday's and nothing is wrong — it is the morning
// BEFORE that going unanswered which means no run has landed.
//
// The same bar is spelled out again in `hooks/docs/session/run.sh` (issue #173),
// which asks the same question of the same board at session start, off the
// marker the 9am job leaves rather than over the network — change both together.
// What the two COUNT diverges on purpose: this one reads the dates off briefs
// carrying a `workkit-stats` line, because a chart is what it feeds, while the
// marker counts any `brief: `-titled Discussion — a brief published without a
// stats line is still a morning that arrived, which is all that hook asks.
const FRESH_DAYS = 1;
const DAY_MS = 86400000;

/** The UTC day a moment falls on — the same stamp `jobs/stats.js` dates a brief with. */
const utcDay = (when) => when.toISOString().slice(0, 10);

/**
 * Whether the cloud brief is still posting (issue #172).
 *
 * Ten mornings failed in a row and every page looked normal, because the one
 * fact that would have said so — the newest published brief's date — was
 * already in the read above and nobody asked it. So this is ARITHMETIC on what
 * `briefHistory` returned: no second round trip, and no second definition of
 * what counts as a published brief.
 *
 * CALENDAR DAYS, not 24-hour windows, and in UTC like every other date in this
 * store: the post happens once a day, so "yesterday's" is the honest unit and a
 * brief read at 09:05 the morning after a 09:00 post is one day old, not none.
 *
 * FOUR ANSWERS, and the last two are never each other:
 *   fresh       today's morning or yesterday's posted
 *   stale       the newest post is older than that; `date` says which day it was
 *   never       the home repo has published no brief carrying a stats line
 *   unreadable  the history could not be read, so nothing can be judged at all
 *
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
