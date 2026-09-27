// The board over time: the payload's history turned into what a chart draws,
// pure, for every page that draws it. Three absences, none of them a zero:
// null (the read failed, or no home repo), [] (nothing published with a stats
// block yet), one point (nothing to compare against). Pages gate on `hasSeries`.

/** What a page says where the charts would be until the history has two points. */
export const ACCRUES = 'charts appear after two published briefs';

/** What a page says when the history could not be read at all. */
export const UNREAD = 'the published briefs could not be read, so there is no history to draw';

/**
 * A page's own absence sentence with the read's reason on the end of it, where
 * the payload carries one; an absent key leaves the sentence alone.
 *
 * @param {string} sentence - the page's own line
 * @param {object} payload - the brief payload
 * @returns {string}
 */
export const unreadLine = (sentence, payload) => {
  const reason = (payload && payload.historyReason) || null;
  return reason ? `${sentence} - ${reason}` : sentence;
};

/** The entries a payload carries, or an empty list - never null, for the callers that map. */
export const entriesOf = (payload) => {
  const history = payload && payload.history;
  return Array.isArray(history) ? history : [];
};

/** Whether there is enough history to draw a line rather than a dot. */
export const hasSeries = (payload) => entriesOf(payload).length >= 2;

/** Whether the history is absent because the read failed, rather than because nothing is published. */
export const unread = (payload) => !payload || payload.history === null || payload.history === undefined;

/**
 * One field of the totals, per day - the series a chart takes.
 *
 * The date is the label, short: a five-week axis of ISO stamps is unreadable at
 * chart width, and the year is the same on every point.
 *
 * @param {object[]} entries - what entriesOf returned
 * @param {string} key - a key of `totals`, or 'closedDay'
 * @returns {{labels: string[], values: number[]}}
 */
export const seriesOf = (entries, key) => ({
  labels: (entries || []).map((entry) => String(entry.date || '').slice(5)),
  values: (entries || []).map((entry) => {
    const value = key === 'closedDay' ? entry.closedDay : (entry.totals || {})[key];
    return typeof value === 'number' ? value : 0;
  }),
});

/** How many days back a "last week" comparison looks. */
const WEEK = 7;

/**
 * Today's value against the one about a week ago, found by date rather than by
 * counting entries, since an unpublished morning leaves no point. With no entry
 * on or before that date the answer is null, never a delta against the oldest.
 *
 * @param {object[]} entries - what entriesOf returned, oldest first
 * @param {string} key - a key of `totals`, or 'closedDay'
 * @returns {{change: number, from: number, to: number, days: number}|null}
 */
export const weekDelta = (entries, key) => {
  const list = entries || [];
  if (list.length < 2) return null;
  const valueOf = (entry) => {
    const value = key === 'closedDay' ? entry.closedDay : (entry.totals || {})[key];
    return typeof value === 'number' ? value : 0;
  };

  const latest = list[list.length - 1];
  const asked = new Date(`${latest.date}T00:00:00Z`);
  if (Number.isNaN(asked.getTime())) return null;
  asked.setUTCDate(asked.getUTCDate() - WEEK);
  const cutoff = asked.toISOString().slice(0, 10);

  let before = null;
  for (let i = list.length - 2; i >= 0; i--) {
    if (list[i].date <= cutoff) { before = list[i]; break; }
  }
  if (!before) return null;

  const from = valueOf(before);
  const to = valueOf(latest);
  const days = Math.round((Date.parse(`${latest.date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`)) / 86400000);
  return { change: to - from, from, to, days };
};

/**
 * The delta as the sub-line a stat cell wears - plain language, and nothing at
 * all when there is nothing to say.
 *
 * @param {{change: number, days: number}|null} delta - what weekDelta returned
 * @returns {string}
 */
export const deltaLine = (delta) => {
  if (!delta) return '';
  const ago = delta.days === WEEK ? 'last week' : `${delta.days} days ago`;
  if (delta.change === 0) return `unchanged since ${ago}`;
  const size = Math.abs(delta.change);
  return `${delta.change > 0 ? 'up' : 'down'} ${size} from ${ago}`;
};

// ── Whether the cloud brief is still posting ───────────────────────────────
// The API decides it (tower/api/lib/history.js); the line a page draws for each
// state lives here once, so the Health and Brief pages cannot differ.

// The two sentences that are not about a date. ACCRUES and UNREAD above are
// exported because the pages say them where a chart would be; these are said
// only by the line below, so they stay in here with it.
const UNJUDGED = 'the published briefs could not be read, so whether the cloud brief is still posting is unknown';
const UNPUBLISHED = 'no brief has ever been published - the cloud brief has not posted one yet';

/**
 * The line a page draws about the cloud brief, or null for a morning that
 * posted or a payload with no freshness block. The level is the alarm's: a
 * stopped brief is red, an unread or empty history is only worth saying.
 *
 * @param {object} payload - the brief payload
 * @returns {{level: string, text: string}|null}
 */
export const briefAlert = (payload) => {
  const freshness = (payload && payload.briefFreshness) || null;
  if (!freshness) return null;
  if (freshness.state === 'stale') {
    return { level: 'danger', text: `last brief posted ${freshness.date} - the cloud brief has not run since` };
  }
  if (freshness.state === 'unreadable') return { level: 'warning', text: UNJUDGED };
  if (freshness.state === 'never') return { level: 'warning', text: UNPUBLISHED };
  return null;
};
