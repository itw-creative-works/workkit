// libs/tower/format/status.js: the status pipeline, its tokens, its chart
// series and its alarm, and the priority bands and their order.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';

// The status pipeline in stage order, mirroring the `status` group of the label
// SSOT: restated because a column must exist while it is empty. A missing
// status is a fault, drawn as the alarm below, and `pocket` marks the two
// waiting states the Board sets apart.
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
 * The theme token a status is drawn in, on cards and in charts. Green is a
 * verdict, so only `complete` wears it. Within a vocabulary a hue never
 * repeats; across vocabularies it may, since every chip carries its own word
 * and glyph. No status takes the muted fallback ink, the no-status alarm's.
 * The light-mode hex pairing with `workflow/labels.json`: `workflow/README.md`.
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
 * The status chart series, labels, values and colors in step, plus a "No
 * status" slice only while an unlabelled issue exists, so the ring sums to the
 * open count beside it.
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

/**
 * The alarm the Board draws above its columns for open issues in scope with no
 * `status:` label: named, linked and counted in the danger tone, and drawn
 * nowhere else, since a lane would make the fault look like a resting place.
 *
 * @param {object[]} issues - the open issues in scope
 * @param {boolean} [showRepo] - whether the board is showing more than one repo
 * @returns {string} markup, or nothing at all when every issue is labelled
 */
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

// ── Priority ───────────────────────────────────────────────────────────────
// Normal priority is the absent label: three bands, two with a name to draw.
// The ends share a hue with the status they mean the same as (high with
// `blocked`, low with `backlog`); the word and the glyph keep the chips apart.

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
