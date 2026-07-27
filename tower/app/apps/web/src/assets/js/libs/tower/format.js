//
// The vocabulary every tower page shares: escaping, the status pipeline, and
// the handful of markup shapes that repeat. Not a page — nothing here fetches
// or draws on its own, so escaping and filtering are written once and mean the
// same thing on every surface.
//

/**
 * HTML-escape a value for interpolation into a template string.
 *
 * EVERY GitHub-sourced value goes through this: issue titles, labels, repo
 * slugs and assignee handles are all attacker-controlled text as far as the
 * tower is concerned, and a hostile title must render as text.
 */
export const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A count that may legitimately be unknown — null renders as a dash, not 0. */
export const num = (value) => (value === null || value === undefined ? '—' : String(value));

/** One "nothing here" line, in the theme's muted voice. */
export const empty = (message) => `<p class="text-body-secondary mb-0">${esc(message)}</p>`;

/** The line a page shows where a section would be when its feed did not answer. */
export const problem = (message) => `<div class="alert alert-warning mb-0">${esc(message)}</div>`;

/** The last path segment of a repo path — what a session's cwd is shown as. */
export const shortPath = (value) => String(value || '').split('/').filter(Boolean).pop() || String(value || '');

/** 1234567 → "1.23M". Token counts are large and the exact digit never matters. */
export const compact = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
};

/** A dollar amount, at the precision a per-session cost is actually known to. */
export const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(n >= 10 ? 2 : 3)}`;
};

//
// The status pipeline, in the order the board reads left to right, plus the
// column for issues carrying no status label at all. It mirrors the `status`
// group in the workflow label SSOT the API reads, and is restated here only
// because a column has to exist while it is EMPTY, which no amount of looking
// at the data can tell you.
//
export const STATUSES = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'specced', label: 'Specced' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'parked', label: 'Parked' },
  { key: '', label: 'No status' },
];

/** The theme token a status is drawn in, on cards and in charts. */
export const statusToken = (key) => ({
  inbox: '--omega-chart-2',
  specced: '--omega-ok',
  blocked: '--omega-danger',
  parked: '--omega-ink-faint',
}[key] || '--omega-warn');

/** The resolved colour for a status — CSS custom properties, so dark mode follows. */
export const statusColor = (key) => `var(${statusToken(key)})`;

// ── The shapes that repeat ─────────────────────────────────────────────────

// The statgrid's geometry, which the tower has to state itself. The theme sizes
// the grid off the VIEWPORT — two tiles per row, all of them in one row above
// 1200px — and draws the tile separators with nth-child rules that hold for
// exactly those two shapes. The tower puts the same six tiles inside a
// half-width repo card, where that gives six 80px columns with their labels
// overlapping and "v3.5.0" broken one character per line. So the row reflows off
// the CONTAINER instead, and each tile carries its own right and bottom hairline
// — a rule that is right at ANY column count, unlike the borders it replaces.
// The outermost hairlines fall on the container's edge, which already clips.
const GRID_STYLE = 'grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));';
const CELL_STYLE = 'border: 0; box-shadow: 1px 0 0 var(--omega-line), 0 1px 0 var(--omega-line);';

/**
 * One classy-statgrid tile. `href` makes it a link to the page that owns it.
 *
 * A tile says one number: the label holds one line and the value is never
 * broken across lines, so a long one ends in an ellipsis rather than stacking
 * "v3.5.0" one character per row.
 */
export const statCell = (label, value, href) => {
  const inner = `<div class="classy-statgrid__label"><span class="classy-micro text-nowrap">${esc(label)}</span></div>
    <h3 class="classy-statgrid__value text-truncate">${esc(value)}</h3>`;
  return href
    ? `<a class="classy-statgrid__cell text-reset text-decoration-none" style="${CELL_STYLE}" href="${esc(href)}">${inner}</a>`
    : `<div class="classy-statgrid__cell" style="${CELL_STYLE}">${inner}</div>`;
};

/** A row of tiles — as many per row as fit, so a narrow card wraps them. */
export const statgrid = (cells, extraClass = 'mb-4') => `<div class="classy-statgrid ${extraClass}" style="${GRID_STYLE}">
  ${cells.join('')}
</div>`;

/** A Bootstrap card with the theme's panel head. `chip` is an optional count. */
export const card = (heading, body, options = {}) => `<div class="card ${options.class || ''}">
  <div class="card-body">
    <div class="classy-panel-head mb-3">
      <span class="text-truncate">${esc(heading)}</span>
      ${options.chip === undefined ? '' : `<span class="classy-chip${options.alarm ? ' classy-chip--accent' : ''}">${esc(options.chip)}</span>`}
      ${options.link ? `<a class="classy-chip" href="${esc(options.link.href)}">${esc(options.link.label)}</a>` : ''}
    </div>
    ${body}
  </div>
</div>`;

/**
 * The chips that label one issue — its type, whether it is high priority,
 * whether an agent may take it, and who holds it.
 *
 * One row of markup for the Board's cards and the Brief's list, which say the
 * same four things about the same issue and had drifted into two copies of it.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {string} [extraClass] spacing the caller's layout needs
 * @returns {string} markup
 */
export const issueChips = (issue, extraClass = '') => `<span class="d-flex flex-wrap align-items-center gap-1${extraClass ? ` ${extraClass}` : ''}">
  ${issue.type ? `<span class="classy-chip">${esc(issue.type)}</span>` : ''}
  ${issue.priority === 'high' ? '<span class="classy-chip classy-chip--accent">high</span>' : ''}
  ${issue.agentOk ? '<span class="classy-chip">agent:ok</span>' : ''}
  ${(issue.assignees || []).length ? `<span class="classy-micro">@${esc(issue.assignees.join(', @'))}</span>` : ''}
</span>`;

/** A status pill in the theme's three tones. */
export const pill = (tone, label) => `<span class="classy-status classy-status--${esc(tone)}"><span class="classy-dot classy-dot--${esc(tone)}"></span>${esc(label)}</span>`;
