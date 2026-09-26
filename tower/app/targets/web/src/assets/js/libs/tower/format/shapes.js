// libs/tower/format/shapes.js: the markup that repeats: the stat tile and its
// grid, the card, the issue chip row and what it waits on, and the pill.
// format.js re-exports it whole; no piece imports format.js.

import { esc, issueKey } from './values.js';
import { typeChip, priorityChip } from './chips.js';

// ── The shapes that repeat ─────────────────────────────────────────────────

/**
 * One omega-statgrid tile. `href` makes it a link to the page that owns it.
 *
 * A tile says one number: the label holds one line and the value is never
 * broken across lines, so a long one ends in an ellipsis rather than stacking
 * "v3.5.0" one character per row.
 *
 * `note` is the tile's tooltip - what a value that is NOT a number means. A
 * dash is honest and mute, and the sentence behind it is the difference between
 * "nothing is happening" and "this cannot be read from here".
 *
 * `sub` is one short line UNDER the number - how it compares with a week ago
 * (issue #55). It is drawn only when there is something to say: a tile with no
 * comparison keeps exactly the shape it had.
 */
export const statCell = (label, value, href, note, sub) => {
  const title = note ? ` title="${esc(note)}"` : '';
  const inner = `<div class="omega-statgrid__label"><span class="omega-micro text-nowrap">${esc(label)}</span></div>
    <h3 class="omega-statgrid__value text-truncate">${esc(value)}</h3>${sub ? `
    <p class="omega-micro text-body-secondary mb-0 text-truncate">${esc(sub)}</p>` : ''}`;
  return href
    ? `<a class="omega-statgrid__cell text-reset text-decoration-none" href="${esc(href)}"${title}>${inner}</a>`
    : `<div class="omega-statgrid__cell"${title}>${inner}</div>`;
};

/**
 * A row of tiles - as many per row as fit, so a narrow card wraps them.
 *
 * The reflow is the theme's own now: `.omega-statgrid` sizes off the
 * CONTAINER, with `--omega-statgrid-cols` as the ceiling, so a grid inside a
 * half-width repo card drops columns instead of overflowing.
 */
export const statgrid = (cells, extraClass = 'mb-4') => `<div class="omega-statgrid ${extraClass}">
  ${cells.join('')}
</div>`;

/** A Bootstrap card with the theme's panel head. `chip` is an optional count. */
export const card = (heading, body, options = {}) => `<div class="card ${options.class || ''}">
  <div class="card-body">
    <div class="omega-panel-head mb-3">
      <span class="text-truncate">${esc(heading)}</span>
      ${options.chip === undefined ? '' : `<span class="omega-chip${options.alarm ? ' omega-chip--accent' : ''}">${esc(options.chip)}</span>`}
      ${options.link ? `<a class="omega-chip text-decoration-none" href="${esc(options.link.href)}">${esc(options.link.label)}</a>` : ''}
    </div>
    ${body}
  </div>
</div>`;

/**
 * The chips saying what an issue is WAITING on (issue #103) - one per blocker,
 * and only while that blocker is still on the board.
 *
 * A dependency is advisory: nothing about the pipeline changes because of one,
 * so it is drawn in the plain muted chip every undyed value uses rather than
 * borrowing a status or priority hue. A blocker in the same repo is said the
 * short way, the way the issue's own author would write it; one in another repo
 * carries its slug, since `#12` there is a different issue.
 *
 * The blocker's repo is remote text like every other value here, so it is
 * escaped along with the rest. Repo names are case-insensitive on GitHub and
 * the inline fallback is hand-typed, so every comparison folds case.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {Set<string>} [open] the sweep's `repo#number` keys, lowercased
 * @returns {string} markup, or nothing when it waits on nothing the board holds
 */
export const waitsOnChips = (issue, open) => (issue.blockedBy || [])
  .filter((blocker) => open && open.has(issueKey(blocker).toLowerCase()))
  .map((blocker) => `<span class="omega-chip">${esc(`waits on ${String(blocker.repo).toLowerCase() === String(issue.repo).toLowerCase() ? `#${blocker.number}` : issueKey(blocker)}`)}</span>`)
  .join('');

/**
 * The chips that label one issue - its type, its priority, what it waits on,
 * whether an agent may take it, and who holds it.
 *
 * One row of markup for the Board's cards and the Brief's list, which say the
 * same things about the same issue and had drifted into two copies of it.
 *
 * @param {object} issue one issue from /api/board or /api/brief
 * @param {string} [extraClass] spacing the caller's layout needs
 * @param {Set<string>} [open] the sweep's `repo#number` keys - what a "waits on"
 *   chip is judged against; without it the row says nothing about dependencies
 * @returns {string} markup
 */
export const issueChips = (issue, extraClass = '', open = null) => `<span class="d-flex flex-wrap align-items-center gap-1${extraClass ? ` ${extraClass}` : ''}">
  ${typeChip(issue.type)}
  ${priorityChip(issue.priority)}
  ${waitsOnChips(issue, open)}
  ${issue.agentOk ? '<span class="omega-chip">agent:ok</span>' : ''}
  ${(issue.assignees || []).length ? `<span class="omega-micro">@${esc(issue.assignees.join(', @'))}</span>` : ''}
</span>`;

/** A status pill in the theme's three tones. */
export const pill = (tone, label) => `<span class="omega-status omega-status--${esc(tone)}"><span class="omega-dot omega-dot--${esc(tone)}"></span>${esc(label)}</span>`;
