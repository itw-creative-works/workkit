//
// The stats line a published brief carries — the day, in numbers a chart can
// read back.
//
// The digest a model writes is prose, and prose is not a series. So the morning
// leaves one machine-readable line under it, composed HERE from the payload the
// brief was built out of and appended mechanically by the runner — the same
// path the upstream-news cursor takes (jobs/cc-news.js, `brief-publish.sh`).
// Nothing asks the model to reproduce JSON: a number it retyped would be a
// number that could be wrong.
//
// The published Discussion is the only store. `tower/api/lib/history.js` reads
// these lines back, and it owns the PATTERN this renders to match — writer and
// reader are two halves of one shape.
//
// Usage:
//   const { renderStatsMark } = require('./stats');
//   renderStatsMark(payload);   // '<!-- workkit-stats: {…} -->'
//

const { STATS_RE } = require('../tower/api/lib/history');

/**
 * The day this payload is about, from the payload's OWN stamp.
 *
 * Never `new Date()`: a brief composed at 09:00 and a line stamped whenever this
 * function happened to run are the same day almost always, and the exception —
 * a run crossing midnight, a rerun of yesterday's dispatch — is exactly the day
 * a chart would draw twice.
 *
 * @param {string} generatedAt the ISO stamp buildBrief put on the payload
 * @returns {string} YYYY-MM-DD, or '' when the stamp is not one
 */
const dayOf = (generatedAt) => {
  const when = new Date(generatedAt);
  return Number.isNaN(when.getTime()) ? '' : when.toISOString().slice(0, 10);
};

/**
 * The open-issue count per repo, keyed by slug — the one section of the line
 * that is per repo, so a chart can answer "which board grew" as well as "how
 * big is the board".
 *
 * @param {Array<{slug: string, open: number}>} repoCounts the payload's per-repo sweep counts
 * @returns {Object<string, {open: number}>}
 */
const perRepo = (repoCounts) => {
  const out = {};
  for (const entry of repoCounts || []) {
    if (!entry || typeof entry.slug !== 'string') continue;
    out[entry.slug] = { open: typeof entry.open === 'number' ? entry.open : 0 };
  }
  return out;
};

/**
 * The line the runner appends under the digest.
 *
 * A payload with no usable stamp renders NOTHING rather than a line dated
 * today: an undated point is a point a series cannot place, and a wrongly dated
 * one is worse than a missing day. A payload whose sweep FAILED renders nothing
 * for the same reason — buildBrief reports that morning as a failure, but its
 * counts are zeros, and a zero point in the only store would be a permanent
 * cliff in every chart.
 *
 * @param {object} payload what buildBrief returned
 * @returns {string} the comment line, or '' when there is nothing to say
 */
const renderStatsMark = (payload) => {
  if (!payload || !payload.ok || !payload.counts) return '';
  const date = dayOf(payload.generatedAt);
  if (!date) return '';

  const counts = payload.counts;
  // The key order is fixed and the JSON is one line, because this is read by a
  // regex out of a Discussion body rather than parsed out of a file.
  const body = {
    v: 1,
    date,
    totals: {
      open: counts.open || 0,
      waiting: counts.waiting || 0,
      qa: counts.qa || 0,
      ready: counts.ready || 0,
      inFlight: counts.inFlight || 0,
      inbox: counts.inbox || 0,
      backlog: counts.backlog || 0,
    },
    closedDay: typeof payload.closedDay === 'number' ? payload.closedDay : 0,
    repos: perRepo(payload.repoCounts),
  };
  return `<!-- workkit-stats: ${JSON.stringify(body)} -->`;
};

module.exports = { renderStatsMark, dayOf, STATS_RE };
