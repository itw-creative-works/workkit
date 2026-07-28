//
// An agent, drawn: is it moving, how long ago did it move, and what role is it
// playing.
//
// Three surfaces say those things about the same thing — a crew card, a
// subagent card, a claimed issue on the Board — and each had its own answer
// before this file, which is how the Crew page ended up with a green "working"
// badge nowhere else on the tower could reproduce. One vocabulary now: the
// indicator, the age beside it, and the role glyph.
//
// The CUTOFF and the arithmetic are deliberately on this side. The API hands
// over timestamps (`lastActivity`, `aliveSince` — ms epochs), never a verdict,
// so a paint tick can age an indicator to gray and then to nothing without the
// page reading the API again.
//
// The glyphs are plain Font Awesome markup, which the framework's shared
// renderer draws for elements inserted long after boot — the same bet
// modal.js's external link already makes. Nothing here needs Pro.
//

import { esc, badgeColor, classKey } from './format.js';

/**
 * How long an agent may stay quiet before its indicator goes away entirely.
 *
 * This is the INDICATOR's window and is not the liveness rule — the API's own
 * (45 minutes, sessions.js) decides whether a session is running at all. This
 * one decides whether the light is still worth showing, and a minute is the
 * span over which "it just did something" is still true.
 */
export const ACTIVITY_WINDOW_MS = 60 * 1000;

/**
 * How recently the transcript must have moved for the glyph to SPIN.
 *
 * The API's `working` cannot carry this on its own. Its state flips off
 * `working` only after the idle window (45 minutes) and is decided from the
 * same file time this side reads — so "the API stopped calling it working"
 * always means "quiet far longer than a minute", which is already `none`. Take
 * the state word as necessary and the freshness as sufficient: two poll cycles
 * (the live feeds run every 10 seconds) is a transcript that moved between the
 * last read and this one, which is what motion is meant to say.
 */
export const WORKING_MS = 20 * 1000;

/**
 * Which of the three states an agent's indicator is in.
 *
 * - `working` — it is running and its transcript moved a poll or two ago.
 * - `idle` — it moved within the minute but has stopped, or is between turns.
 * - `none` — quiet longer than the minute: no indicator at all.
 *
 * The gray band is the whole point of the middle case: an agent that finished
 * ten seconds ago, and a session whose assertion has lapsed but whose file is
 * fresh, are both still worth showing — still, not spinning.
 *
 * A roster with no timestamps at all (`/api/sessions` before #46, or a session
 * whose transcript could not be probed) falls back to the state word alone,
 * which is the only thing it knows.
 *
 * @param {{state?: string, lastActivity?: number|null}} entry a normalized node
 * @param {number} [now] ms epoch
 * @returns {'working'|'idle'|'none'}
 */
export const activityPhase = (entry, now = Date.now()) => {
  const working = (entry || {}).state === 'working';
  const last = Number((entry || {}).lastActivity);
  if (!Number.isFinite(last)) return working ? 'working' : 'none';
  // A clock that disagrees with the API's reads negative — treat it as this
  // instant rather than as a session from the future.
  const quiet = Math.max(0, now - last);
  if (quiet > ACTIVITY_WINDOW_MS) return 'none';
  return working && quiet <= WORKING_MS ? 'working' : 'idle';
};

/**
 * A span as the shortest true thing to say about it: `12s`, `3m`, `2h`, `4d`.
 *
 * @param {number} ms
 * @returns {string} the label, or '' when there is no span to name
 */
export const sinceLabel = (ms) => {
  const span = Number(ms);
  if (!Number.isFinite(span)) return '';
  const seconds = Math.max(0, Math.floor(span / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

/**
 * The indicator itself — one glyph, wordless.
 *
 * `working` spins in the theme's ok colour; `idle` is the same glyph, still and
 * muted, so a card that just stopped keeps its shape instead of jumping. The
 * word is kept for a screen reader, which has no colour or motion to read.
 *
 * @param {'working'|'idle'|'none'} phase
 * @param {string} [title] the hover text — how long it has been running
 * @param {string} [label] what a screen reader hears, when the phase is not
 *   the honest word for it: the Board's glyph means a CLAIM, not an idle agent
 * @returns {string} markup, or '' for `none`
 */
export const activityIcon = (phase, title = '', label = '') => {
  if (phase !== 'working' && phase !== 'idle') return '';
  return `<span class="omega-tower-activity omega-tower-activity--${esc(phase)}"${title ? ` title="${esc(title)}"` : ''}>
    <i class="fa-solid fa-circle-notch${phase === 'working' ? ' fa-spin' : ''}" aria-hidden="true"></i>
    <span class="visually-hidden">${esc(label || phase)}</span>
  </span>`;
};

/**
 * The Board's version of the glyph: an issue an agent HOLDS.
 *
 * Drawn still, always: a board card carries no activity timestamps — nothing
 * here can know whether the agent holding it moved a second ago — so it says
 * someone has this one and nothing more, and says exactly that to a screen
 * reader rather than the word `idle`.
 *
 * The gate is both halves of the claim: an assignee, and `specced` — the state
 * the pipeline treats as authorized to build (#46). An issue claimed while it
 * is still in triage is not work in flight.
 *
 * @param {object} issue one issue from /api/board
 * @returns {string} markup, or '' when the issue is not claimed work
 */
export const claimGlyph = (issue) => {
  const held = ((issue || {}).assignees || []);
  if ((issue || {}).status !== 'specced' || !held.length) return '';
  return activityIcon('idle', `held by @${held.join(', @')}`, 'claimed');
};

/**
 * The indicator as a crew card wears it: the glyph, then how long since the
 * agent last moved.
 *
 * The hover text is the OTHER span — how long it has been up — because the one
 * on the card is already the freshness.
 *
 * @param {object} entry a normalized node, carrying `lastActivity`/`aliveSince`
 * @param {number} [now] ms epoch
 * @returns {string} markup, or '' when the agent has been quiet too long
 */
export const crewActivity = (entry, now = Date.now()) => {
  const phase = activityPhase(entry, now);
  if (phase === 'none') return '';
  const alive = Number((entry || {}).aliveSince);
  const title = Number.isFinite(alive) ? `running for ${sinceLabel(now - alive)}` : 'up for an unknown span';
  const last = Number((entry || {}).lastActivity);
  const age = Number.isFinite(last) ? sinceLabel(now - last) : '';
  return `<span class="d-inline-flex align-items-center gap-1">
    ${activityIcon(phase, title)}
    ${age ? `<span class="classy-micro text-body-secondary">${esc(age)}</span>` : ''}
  </span>`;
};

// One glyph per role, each distinct at a glance: the manager wears the suit,
// the worker the hammer, the scout the binoculars, the verifier the checked
// clipboard, the advisor the lamp, the reviewer the lens. Everything else
// Claude Code spawns — general-purpose and the built-ins — is the plain robot,
// which is honest about being nobody in particular. Free Font Awesome, every
// one of them.
const ROLE_ICONS = {
  manager: 'fa-user-tie',
  worker: 'fa-hammer',
  scout: 'fa-binoculars',
  verifier: 'fa-clipboard-check',
  advisor: 'fa-lightbulb',
  reviewer: 'fa-magnifying-glass',
  other: 'fa-robot',
};

/** The glyph name for a class, prefixed (`workkit:worker`) or not. */
export const roleGlyph = (name) => ROLE_ICONS[classKey(name)] || ROLE_ICONS.other;

/**
 * A card's role badge — the glyph in the colour that class is drawn in
 * everywhere else, so the icon and the chip under it agree.
 *
 * @param {string} name an agent class
 * @returns {string} markup
 */
export const roleIcon = (name) => `<span class="omega-tower-role" style="color: ${badgeColor(classKey(name))}" title="${esc(name || 'unknown')}">
  <i class="fa-solid ${esc(roleGlyph(name))}" aria-hidden="true"></i>
</span>`;
