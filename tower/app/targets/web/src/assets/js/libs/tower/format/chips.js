// libs/tower/format/chips.js: the glyph table and the status, priority and
// type chips drawn through the one tone chip.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';
import { statusToken, priorityToken } from './status.js';

//
// ── The glyphs ─────────────────────────────────────────────────────────────
//
// What a `status:`, a `type:` and a `priority:` chip wear before their label
// (issues #136 and #149), so a column of cards is read at a glance rather than
// word by word. One table for all three vocabularies, the way TONES in badges.js holds
// models and classes at once - the keys are disjoint, so one table cannot be
// ambiguous, and the chips that sit side by side on every card cannot drift
// into three homes. The glyph is also what lets a hue be shared across the
// vocabularies: the picture and the word are what tell a `high` chip from a
// `blocked` one.
//
// The picks say the thing rather than encode it: the bug is a bug, an
// enhancement is the wand that improves what is already there, an idea is the
// lamp, the priority ends are arrows pointing where the band sits, and a status
// is the act it names - the tray it was captured into, the clipboard its spec
// was signed off on, the hammer, the eye the owner checks it with, the tick
// that check earns it (#196), the raised hand, the pause. Three are a crew
// role's glyph too (agent.js) - the lamp is the advisor's, the hammer the
// worker's, the clipboard the verifier's - which
// is fine: a role glyph is drawn on the Crew page and in the agent dialog, and
// no surface that draws an issue chip shows one, so the two never say different
// things in one place.
//
// Free Font Awesome, every one of them, drawn by the framework's shared
// renderer the same way every other glyph the tower writes is.
//
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
 * The glyph markup for a chip, or nothing at all for a name that has none.
 *
 * Decorative beside the word it repeats, so it is out of the accessibility tree
 * and is no new focus target; it takes no colour of its own, which leaves it in
 * whatever tone the chip around it is painted.
 *
 * It carries its OWN spacing, the framework's `me-1`, because the chip it sits
 * in is no flex row to gap (see below) - without it the glyph is flush against
 * the word. The Board's column header draws it too, before the status label,
 * so a lane and the chips in it say the status with one picture. The other
 * half of sitting right is vertical, and that one is the sheet's: `main.scss`
 * nudges the svg the renderer fills this `<i>` with, in a chip and in a header.
 */
export const chipGlyph = (key) => (CHIP_GLYPHS[key] ? `<i class="fa-solid ${CHIP_GLYPHS[key]} me-1" aria-hidden="true"></i>` : '');

/**
 * One chip painted in a theme token, optionally wearing a glyph.
 *
 * The framework's tone chip is the mechanism - `.omega-badge-tone` paints
 * whatever `--omega-tone` holds - and the token is set inline instead of by an
 * `.omega-tone-N` class, because status and priority are drawn from the theme's
 * semantic slots rather than from the categorical ramp. `text-uppercase` puts
 * back the case the tone chip turns off for model ids: these labels are words,
 * and they sit in a row with plain chips that are uppercase.
 *
 * The chip is an inline-BLOCK, whatever `.omega-chip` says: the theme's
 * `.omega-badge-tone` sets `display: inline-block` and comes after it at equal
 * specificity, so the chip's flex `gap` never applies and a glyph inside one is
 * laid out on the text's own line. That is why the glyph brings its own margin
 * (chipGlyph) instead of leaning on a gap that is not there - and the display
 * is the theme's to own, so nothing here tries to change it back.
 *
 * The glyph is the caller's, not looked up here: WHICH chips wear one is a
 * decision, and a chip drawn from a name no vocabulary holds wearing none is
 * that decision made rather than a name missing from the table by accident.
 */
const toneChip = (label, token, glyph = '') => `<span class="omega-chip omega-badge-tone text-uppercase" style="--omega-tone: var(${token});">${glyph}${esc(label)}</span>`;

/**
 * The chip for an issue's status - the same colour the Board's column header
 * draws that status in, so the dialog and the column agree, wearing the glyph
 * of the act it names (issue #149).
 */
export const statusChip = (status) => (status ? toneChip(status, statusToken(status), chipGlyph(status)) : '');

/** The chip for an issue's priority. The unlabelled middle draws nothing. */
export const priorityChip = (priority) => (priority === 'high' || priority === 'low' ? toneChip(priority, priorityToken(priority), chipGlyph(priority)) : '');

/**
 * The theme token a type is drawn in. A type is an identity, not a signal, so
 * it draws the orange for the enhancement and the purple for the idea from the
 * categorical ramp, and the bug wears the theme's own danger red (issue #203),
 * three hues no two of which are the same. `specced` is drawn in that same purple (issue #149): a hue is unique
 * within a vocabulary and free across them, since the type chip and the status
 * chip beside it each carry their own word and their own glyph.
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
