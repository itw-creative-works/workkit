// libs/tower/format/status.js: the status pipeline, its tokens, its chart
// series and its alarm, and the priority bands and their order.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';

//
// The status pipeline, in the order the board reads it. It mirrors the `status`
// group in the workflow label SSOT the API reads, and is restated here only
// because a column has to exist while it is EMPTY, which no amount of looking
// at the data can tell you.
//
// Every entry is a place an issue LIVES. A missing `status:` label is not one
// of those - it is a fault the pipeline forbids and the daily heal repairs - so
// it is drawn as the alarm below rather than a lane of its own (#118).
//
// The order is the STAGE order the spec defines, `complete` between the check
// and the ship (#196), and the two states that are not stages carry `pocket`:
// `blocked` and `backlog` are waiting, not progress, and the Board sets them
// apart on that flag rather than on a second list of its own.
//
export const STATUSES = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'specced', label: 'Specced' },
  { key: 'building', label: 'Building' },
  { key: 'qa', label: 'QA' },
  { key: 'complete', label: 'Complete' },
  { key: 'blocked', label: 'Blocked', pocket: true },
  { key: 'backlog', label: 'Backlog', pocket: true },
];

/**
 * The theme token a status is drawn in, on cards and in charts.
 *
 * `complete` wears the OK green (issue #196): the theme's success hue is a
 * VERDICT, and `complete` is the stage that carries one - QA passed, ready to
 * ship. `qa` held that green while it was the end of the pipeline (issue #135)
 * and gives it up to the stage after it for the magenta of `--omega-chart-4`
 * (issue #203, off the olive), a hue no chip in any vocabulary wears now that
 * `type:bug` took the danger red; waiting on a check is a stage, not a verdict.
 * `specced` gave the same green up for the categorical purple, for the same
 * reason - an authorization is a stage, not a verdict.
 *
 * Seven lanes, seven colours: WITHIN a vocabulary a hue never repeats, since a
 * column header, a card chip and a chart slice are all read by hue. Across the
 * vocabularies it may (issue #149) - `type:idea` shares this purple, `high` the
 * alarm red `blocked` wears, `low` the faint ink `backlog` is drawn in - because
 * every chip carries its own word and its own glyph, so nothing is told apart
 * by colour alone. The one slot a status may still not take is the muted ink an
 * unknown key falls back to: a pipeline colour that is also the no-status
 * fallback would make the alarm unreadable.
 *
 * These tokens are one HALF of a pairing: a label's colour on GitHub is the
 * LIGHT-mode value of the token its status is drawn in here, so the board and
 * the issue page agree. The hex side lives in `workflow/labels.json`, and the
 * heal keeps existing labels on it - every fixed label, with no exception left:
 * `priority:high` gave the brand accent up for the danger red, whose hex is the
 * theme's own rather than something that varies per brand.
 */
export const statusToken = (key) => ({
  inbox: '--omega-chart-2',
  specced: '--omega-chart-3',
  building: '--omega-warn',
  qa: '--omega-chart-4',
  complete: '--omega-ok',
  blocked: '--omega-danger',
  backlog: '--omega-ink-faint',
}[key] || '--omega-ink-muted');

/** The resolved colour for a status - CSS custom properties, so dark mode follows. */
export const statusColor = (key) => `var(${statusToken(key)})`;

/**
 * The alarm the Board draws above its columns when open issues carry no
 * `status:` label at all (#118).
 *
 * They used to be a column of their own, which said "here is where these live".
 * They do not live anywhere: exactly one `status:` per open issue is the rule,
 * the daily heal repairs a breach of it, and a lane makes the breach look like a
 * resting place - while on a normal day taking board width to show nothing. So
 * they are named, linked and counted here instead, in the theme's danger tone
 * that no ordinary board state uses, and drawn NOWHERE else on the page.
 *
 * Here rather than in the page for the reason every other shape is: it is
 * markup from values, and the suite can ask what a hostile title renders as.
 * The issues handed in are the SCOPED ones (state.issuesFor) - an unlabelled
 * issue in a repo the board is not showing is not this board's alarm.
 *
 * @param {object[]} issues - the open issues in scope
 * @param {boolean} [showRepo] - whether the board is showing more than one repo
 * @returns {string} markup, or nothing at all when every issue is labelled
 */
/**
 * The status chart series - labels, values and colors in step, one entry per
 * pipeline status, plus a "No status" slice ONLY while an unlabeled issue
 * exists. The Board surfaces that state as its danger alert; a chart that
 * silently dropped those issues would sum short of the open count beside it,
 * so the slice keeps the ring and the number telling one story. Its color is
 * the non-status fallback ink, which no pipeline status is drawn in.
 *
 * @param {object[]} issues - open issues, each carrying `status` ('' for none)
 * @returns {{labels: string[], values: number[], colors: string[]}}
 */
export const statusBreakdown = (issues) => {
  const all = issues || [];
  const labels = STATUSES.map((status) => status.label);
  const values = STATUSES.map((status) => all.filter((issue) => issue.status === status.key).length);
  const colors = STATUSES.map((status) => statusColor(status.key));
  const missing = all.filter((issue) => !issue.status).length;
  if (missing) {
    labels.push('No status');
    values.push(missing);
    colors.push(statusColor(''));
  }
  return { labels, values, colors };
};

export const noStatusAlert = (issues, showRepo = true) => {
  const missing = (issues || []).filter((issue) => !issue.status);
  if (!missing.length) return '';
  return `<div class="alert alert-danger mb-3" role="alert">
  <p class="mb-2">${missing.length} issue${missing.length === 1 ? ' carries' : 's carry'} no status label</p>
  <ul class="list-unstyled mb-0">
    ${missing.map((issue) => `<li><a href="${esc(issue.url)}" target="_blank" rel="noopener">${showRepo ? `${esc(issue.repo)} ` : ''}#${esc(issue.number)} - ${esc(issue.title)}</a></li>`).join('')}
  </ul>
</div>`;
};

//
// ── Priority ───────────────────────────────────────────────────────────────
//
// `priority:high|low` is a group of its own, and the middle of it is the label
// that is ABSENT - normal priority is never written on an issue, so there are
// three bands and only two of them have a name to draw.
//
// Both ends share the status they say the same thing as (issue #149): high
// takes the theme's danger red, which `blocked` also wears, and low the faint
// ink `backlog` is drawn in. A priority chip and a status chip sit side by side
// in the issue dialog, and each carries its own word and its own glyph, so a
// shared hue reads as the shared urgency rather than as a second status -
// while the alternative for the quiet end, the muted ink every plain chip
// already carries, would leave a `low` chip indistinguishable from an undyed
// one.
//

/** The theme token a priority is drawn in; the unlabelled middle is neutral. */
export const priorityToken = (key) => ({
  high: '--omega-danger',
  low: '--omega-ink-faint',
}[key] || '--omega-ink-muted');

/** Where a priority sorts: high first, the unlabelled middle next, low last. */
export const priorityRank = (key) => (key === 'high' ? 0 : key === 'low' ? 2 : 1);

/**
 * The order issues are read in inside one Board column - the three priority
 * bands, most recently updated first within each.
 *
 * Pure, and here rather than in the page, because the band definition is the
 * same one `priorityToken` colours and the brief's own sort ranks.
 */
export const byPriority = (a, b) => {
  const spread = priorityRank(a.priority) - priorityRank(b.priority);
  if (spread !== 0) return spread;
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
};
