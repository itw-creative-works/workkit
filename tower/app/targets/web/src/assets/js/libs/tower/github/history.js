// libs/tower/github/history.js: the mornings' numbers and the documents off one
// Discussions read, and the brief freshness. github.js re-exports it whole; no
// piece imports github.js.

// ── The history, and the documents beside it ───────────────────────────────
//
// The board over time, read back off the published briefs (issue #55), and the
// briefs THEMSELVES (issue #181). The server reads exactly this
// (tower/api/lib/history.js, tower/api/lib/documents.js) and this side cannot
// import it, so the prefix, the pattern and the caps are restated and the suite
// pins both parses against the server's own.
//
// ONE read answers both, here as there: the same hundred Discussions carry the
// numbers a morning recorded and the text it was written in.

import { graphql } from './wire.js';
import { BRIEF_TITLE_PREFIX } from './summaries.js';

/** The line a brief carries its day's numbers on - jobs/stats.js renders it. */
const STATS_RE = /<!--\s*workkit-stats:\s*(\{.*\})\s*-->/;

/** How many mornings a chart draws, and how wide the read that finds them is. */
const HISTORY_LIMIT = 35;
const HISTORY_WINDOW = 100;

/** How many documents the archive carries - tower/api/lib/documents.js's cap. */
const DOCUMENT_LIMIT = 40;

/** Every machine marker a published body carries - that module's rule too. */
const MARKER_RE = /<!--[\s\S]*?-->/g;

/** The same Discussions read the summaries make, WITH the body the line lives in. */
export const buildHistoryQuery = (slug, first = HISTORY_WINDOW) => {
  const [owner, name] = slug.split('/');
  return `query {
  repository(owner: "${owner}", name: "${name}") {
    discussions(first: ${first}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { title url createdAt body }
    }
  }
}
`;
};

/** One brief body's stats block, or null - a brief published before the block is simply skipped. */
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

/** The discussion nodes, parsed into the history series - oldest first, the order a chart draws in. */
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

// How old the newest published brief may be before the cloud brief is judged to
// have stopped - tower/api/lib/history.js's own bar, restated for the
// copy-boundary reason the caps above are. ONE whole calendar day: the brief
// posts once a morning, so at 08:00 the newest post is yesterday's and nothing
// is wrong; it is the morning BEFORE that going unanswered which means no run
// has landed.
const FRESH_DAYS = 1;
const DAY_MS = 86400000;

/** The UTC day a stamp falls on, or '' when it names no moment this can place. */
const utcDay = (stamp) => {
  const at = Date.parse(stamp);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : '';
};

/**
 * Whether the cloud brief is still posting - the API's `briefFreshness`, decided
 * in the browser (issue #176).
 *
 * The local tower answers this server-side and the published copy could not, so
 * a viewer away from the machine saw a normal-looking dashboard however many
 * mornings had failed - which is the longest a stopped brief goes unnoticed.
 * It is ARITHMETIC on the history this copy just read, never a read of its own,
 * so the charts and the alarm cannot disagree about which morning was the last.
 *
 * CALENDAR DAYS in UTC, the four states and the one-day bar are all the server's
 * (tower/api/lib/history.js); the suite judges the same mornings with both and
 * compares the verdicts.
 *
 * @param {Array<{date: string}>|null} history - the parsed history, oldest first
 * @param {string} generatedAt - the moment to judge against, as an ISO stamp
 * @returns {{state: string, date: string|null}} fresh · stale · never · unreadable
 */
export const briefFreshness = (history, generatedAt) => {
  const unreadable = { state: 'unreadable', date: null };
  if (!Array.isArray(history)) return unreadable;
  if (!history.length) return { state: 'never', date: null };

  // Ascending by date is what normalizeHistory promises, so the newest morning
  // is the last entry.
  const date = history[history.length - 1].date;
  const age = (Date.parse(`${utcDay(generatedAt)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
  // A date the arithmetic cannot place is a date nothing can be judged against;
  // fresh and stale would both be guesses, so it says so instead.
  if (!Number.isFinite(age)) return unreadable;
  return { state: age > FRESH_DAYS ? 'stale' : 'fresh', date };
};

/** One published body as a reader sees it - the markers stripped with the blank lines they leave. */
export const readable = (body) => String(body || '')
  .replace(MARKER_RE, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/**
 * The discussion nodes as the archive draws them - newest first, whole.
 *
 * The opposite order to the series above, because an archive is read newest
 * first and a chart is drawn oldest first; neither is derived from the other.
 *
 * @param {object} data - the GraphQL answer's data
 * @returns {Array<{kind: string, title: string, url: string, createdAt: string|null, body: string}>}
 */
export const normalizeDocuments = (data) => ((((data || {}).repository || {}).discussions || {}).nodes || [])
  .filter((node) => node && typeof node.title === 'string' && node.title)
  .slice(0, DOCUMENT_LIMIT)
  .map((node) => ({
    kind: node.title.startsWith(BRIEF_TITLE_PREFIX) ? 'brief' : 'summary',
    title: node.title,
    url: node.url || '',
    createdAt: node.createdAt || null,
    body: readable(node.body),
  }));

/**
 * The board over time and the documents it was written in - one read, two
 * readings, or nulls when it could not be read.
 *
 * NULL rather than an empty list, because the two say opposite things: a site
 * whose home repo cannot be reached has nothing to show, while a home repo whose
 * briefs carry no stats line yet has a history that is genuinely empty - and the
 * page says a different sentence for each.
 *
 * The REASON rides beside them (issue #215), as it does on the tower's own read
 * (tower/api/lib/history.js): a refusal this read already worded is a sentence
 * the pages can draw, and dropping it left them saying only that the mornings
 * were unreadable. A site with no home repo has none to give - there is nothing
 * it failed to read.
 *
 * @param {string} home - the home repo slug, or ''
 * @param {object} ctx
 * @returns {Promise<{history: Array<object>|null, documents: Array<object>|null, reason: string|null}>}
 */
export const fetchDiscussions = async (home, ctx = {}) => {
  const nothing = { history: null, documents: null, reason: null };
  if (!home) return nothing;
  const answer = await graphql(buildHistoryQuery(home), ctx);
  if (!answer.ok) return { ...nothing, reason: answer.reason || null };
  return { history: normalizeHistory(answer.data), documents: normalizeDocuments(answer.data), reason: null };
};
