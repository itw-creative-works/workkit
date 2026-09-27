// libs/tower/format/chips.js: the glyph table and the status, priority and
// type chips drawn through the one tone chip.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';
import { statusToken, priorityToken } from './status.js';

// ── The glyphs ─────────────────────────────────────────────────────────────
// What a `status:`, `type:` and `priority:` chip wears before its label: one
// table, since the keys are disjoint. Three share a crew role's glyph
// (agent.js), which is fine: no surface draws both. All free Font Awesome.
export const CHIP_GLYPHS = {
  inbox: 'fa-inbox',
  specced: 'fa-clipboard-check',
  building: 'fa-hammer',
  qa: 'fa-eye',
  complete: 'fa-circle-check',
  blocked: 'fa-hand',
  backlog: 'fa-circle-pause',
  bug: 'fa-bug',
  enhancement: 'fa-wand-magic-sparkles',
  idea: 'fa-lightbulb',
  high: 'fa-angles-up',
  low: 'fa-angles-down',
};

/**
 * The glyph markup for a chip, or nothing for a name that has none: decorative,
 * and carrying its own `me-1` because the chip is no flex row to gap (toneChip).
 * The Board's column header draws it too; `main.scss` nudges it vertically.
 */
export const chipGlyph = (key) => (CHIP_GLYPHS[key] ? `<i class="fa-solid ${CHIP_GLYPHS[key]} me-1" aria-hidden="true"></i>` : '');

/**
 * One chip painted in a theme token through the framework's tone chip, the
 * token inline since status and priority use semantic slots, not the ramp.
 * The theme's `.omega-badge-tone` makes it inline-block, so no flex gap
 * applies. The glyph is the caller's decision, never looked up here.
 */
const toneChip = (label, token, glyph = '') => `<span class="omega-chip omega-badge-tone text-uppercase" style="--omega-tone: var(${token});">${glyph}${esc(label)}</span>`;

/**
 * The chip for an issue's status, in the colour its Board column header wears,
 * with the glyph of the act it names.
 */
export const statusChip = (status) => (status ? toneChip(status, statusToken(status), chipGlyph(status)) : '');

/** The chip for an issue's priority. The unlabelled middle draws nothing. */
export const priorityChip = (priority) => (priority === 'high' || priority === 'low' ? toneChip(priority, priorityToken(priority), chipGlyph(priority)) : '');

/**
 * The theme token a type is drawn in: an identity, not a signal, so the ramp's
 * orange and purple, and the danger red for a bug. `specced` shares the purple:
 * hues are unique within a vocabulary only.
 */
export const typeToken = (key) => ({
  bug: '--omega-danger',
  enhancement: '--omega-chart-5',
  idea: '--omega-chart-3',
}[key]);

/**
 * The chip for an issue's type. A type outside the vocabulary stays plain - no
 * colour and no glyph, since both are named per type and an unknown one has
 * neither.
 */
export const typeChip = (type) => {
  if (!type) return '';
  const token = typeToken(type);
  return token ? toneChip(type, token, chipGlyph(type)) : `<span class="omega-chip">${esc(type)}</span>`;
};
