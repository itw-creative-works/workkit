//
// The board over time - the payload's history turned into what a chart draws.
//
// The history rides the brief payload (issue #55): one entry per published
// morning, oldest first, each carrying that day's totals, what it closed and
// its per-repo open counts. Every page that draws it asks the same two
// questions - what is the series, and how does today compare with last week -
// so the answers live here, pure, rather than twice in two page modules.
//
// THREE ABSENCES, three different sentences, and none of them is a zero:
//   null      the read failed, or this copy has no home repo to read from
//   []        nothing has been published with a stats block yet
//   one point history has started but has nothing to compare against
// A chart drawn from any of them would be an empty axis claiming to be data,
// which is why `hasSeries` is what the pages gate on and `ACCRUES` is the one
// sentence they say instead.
//

/** What a page says where the charts would be until the history has two points. */
export const ACCRUES = 'charts appear after two published briefs';

/** What a page says when the history could not be read at all. */
export const UNREAD = 'the published briefs could not be read, so there is no history to draw';

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
 * The DATE is the label, short: a five-week axis of ISO stamps is unreadable at
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
 * Today's value against the one about a week ago.
 *
 * The entry ~7 days back is found by DATE rather than by counting entries: a
 * morning whose brief never published leaves no point, so the seventh entry
 * back can be a fortnight ago. The nearest entry on or before that date is the
 * honest comparison, and when none exists the answer is null - a delta against
 * the oldest point this history happens to have would silently become "since
 * the beginning" on a young board.
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
