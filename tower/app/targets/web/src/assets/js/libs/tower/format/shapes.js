// libs/tower/format/shapes.js: the markup that repeats: the stat tile and its
// grid, the card, the issue chip row and what it waits on, and the pill.
// format.js re-exports it whole; no piece imports format.js.

import { esc, issueKey } from './values.js';
import { typeChip, priorityChip } from './chips.js';

// ── The shapes that repeat ─────────────────────────────────────────────────

/**
 * One omega-statgrid tile, a link to the page that owns it when given `href`.
 * The value never wraps. `note` is the tooltip saying what a non-number value
 * means; `sub` is one short line under the number, drawn only when given.
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
 * A row of tiles: `.omega-statgrid` sizes off its container, so a grid in a
 * half-width card drops columns instead of overflowing.
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
 * The chips saying what an issue waits on, one per blocker still on the board,
 * in the plain muted chip since a dependency is advisory. A same-repo blocker
 * is said short, `#<n>`; case folds, since the inline fallback is hand-typed.
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
 * The chips that label one issue, one row for the Board's cards and the
 * Brief's list: type, priority, what it waits on, `agent:ok`, and who holds it.
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
