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
 * How long an agent may stay quiet before its indicator goes MUTED.
 *
 * This is the INDICATOR's window and is not the liveness rule — the API's own
 * (45 minutes, sessions.js) decides whether a session is running at all. This
 * one decides how bright the light is, and a minute is the span over which "it
 * just did something" is still true.
 */
export const ACTIVITY_WINDOW_MS = 60 * 1000;

/**
 * How long a muted agent stays drawn at all.
 *
 * The minute above used to be both boundaries at once, so an agent that paused
 * for ninety seconds — between turns, waiting on a tool, thinking — left the
 * page outright and the Crew page said nobody was running while four agents
 * were (#99). Five minutes is the span over which "it is still here" is true:
 * long enough to cover a pause, short enough that a finished agent does not
 * linger as a card nobody is watching.
 */
export const QUIET_WINDOW_MS = 5 * 60 * 1000;

/**
 * The class a muted surface wears — the framework's own faint body text, so the
 * muted band costs no colour pairing of its own.
 */
export const MUTED_CLASS = 'text-body-secondary';

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
 * Which of the four states an agent's indicator is in.
 *
 * - `working` — it is running and its transcript moved a poll or two ago.
 * - `idle` — it moved within the minute but has stopped, or is between turns.
 * - `quiet` — quiet longer than the minute: still drawn, muted.
 * - `none` — quiet longer than the five: no indicator at all.
 *
 * The gray band is the whole point of the middle cases: an agent that finished
 * ten seconds ago, and a session whose assertion has lapsed but whose file is
 * fresh, are both still worth showing — still, not spinning — and one that has
 * been silent a couple of minutes is worth showing FAINTLY rather than not at
 * all, which is the difference between a page that says "nothing is running"
 * and one that says "nothing has moved lately".
 *
 * A roster with no timestamps at all (`/api/sessions` before #46, or a session
 * whose transcript could not be probed) falls back to the state word alone,
 * which is the only thing it knows.
 *
 * @param {{state?: string, lastActivity?: number|null}} entry a normalized node
 * @param {number} [now] ms epoch
 * @returns {'working'|'idle'|'quiet'|'none'}
 */
export const activityPhase = (entry, now = Date.now()) => {
  const working = (entry || {}).state === 'working';
  const last = Number((entry || {}).lastActivity);
  if (!Number.isFinite(last)) return working ? 'working' : 'none';
  // A clock that disagrees with the API's reads negative — treat it as this
  // instant rather than as a session from the future.
  const quiet = Math.max(0, now - last);
  if (quiet > QUIET_WINDOW_MS) return 'none';
  if (quiet > ACTIVITY_WINDOW_MS) return 'quiet';
  return working && quiet <= WORKING_MS ? 'working' : 'idle';
};

/**
 * The muted class a phase calls for, or '' — the ONE place the two faint bands
 * are named, because a card is muted by its page's paint and un-muted by the
 * second hand, and a copy on either side is a card that stays gray after its
 * agent came back.
 *
 * `none` counts as muted: the indicator is gone, and until a paint drops the
 * card the honest thing left to say is that this one is not moving.
 *
 * @param {'working'|'idle'|'quiet'|'none'} phase
 * @returns {string}
 */
export const mutedClass = (phase) => (phase === 'quiet' || phase === 'none' ? MUTED_CLASS : '');

/**
 * The muted class for a NODE — what a paint has in hand.
 *
 * @param {{state?: string, lastActivity?: number|null}} entry a normalized node
 * @param {number} [now] ms epoch
 * @returns {string}
 */
export const cardMuted = (entry, now = Date.now()) => mutedClass(activityPhase(entry, now));

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
 * What an indicator should say THIS second, from the raw stamps alone.
 *
 * The ONE home of the arithmetic, because there are now two callers of it: the
 * paint, which draws an indicator from a node, and the clock, which re-decides
 * an already-drawn one every second from the stamps its markup carries
 * (libs/tower/clock.js). Both hand over the same three fields under the same
 * names — the `data-live-*` attributes, read back as an element's `dataset` —
 * so neither side owns a threshold the other has to match.
 *
 * @param {{liveState?: string, liveTs?: string, liveAlive?: string}} data the
 *   stamps, as the markup carries them
 * @param {number} [now] ms epoch
 * @returns {{phase: 'working'|'idle'|'quiet'|'none', age: string, title: string}}
 */
export const activityTick = (data, now = Date.now()) => {
  const stamps = data || {};
  const last = Number(stamps.liveTs);
  const alive = Number(stamps.liveAlive);
  return {
    phase: activityPhase({ state: stamps.liveState, lastActivity: last }, now),
    age: Number.isFinite(last) ? sinceLabel(now - last) : '',
    title: Number.isFinite(alive) ? `running for ${sinceLabel(now - alive)}` : 'up for an unknown span',
  };
};

/**
 * The classes the indicator wears for a phase — its colour, and which of the
 * two states it is in.
 *
 * Written once because the clock RE-writes it: a phase crossing between polls
 * changes the class on an element the paint drew, and a second copy of the name
 * here would be a colour that only changes on one of the two paths.
 *
 * @param {'working'|'idle'|'quiet'} phase
 * @returns {string}
 */
export const activityClass = (phase) => `omega-tower-activity omega-tower-activity--${phase}`;

/**
 * The indicator itself — one glyph, wordless.
 *
 * `working` spins in the theme's ok colour; `idle` and `quiet` are the same
 * glyph, still and faint, so a card that just stopped keeps its shape instead of
 * jumping. The word is kept for a screen reader, which has no colour or motion
 * to read.
 *
 * A GEAR, not the loader's notched ring (#137). Some of the places this glyph
 * is drawn are STILL on purpose — a specced claim is work at rest — and a
 * motionless loading spinner reads as a broken one wherever it is seen. A gear
 * says machinery either way: at rest, someone holds this; turning, the work is
 * running. It is also the honest shape to rotate, eight-fold symmetric where
 * the ring's gap advertises every pixel of a bad centre.
 *
 * @param {'working'|'idle'|'quiet'|'none'} phase
 * @param {string} [title] the hover text — how long it has been running
 * @param {string} [label] what a screen reader hears, when the phase is not
 *   the honest word for it: the Board's glyph means a CLAIM, not an idle agent
 * @returns {string} markup, or '' for `none`
 */
export const activityIcon = (phase, title = '', label = '') => {
  if (phase !== 'working' && phase !== 'idle' && phase !== 'quiet') return '';
  return `<span class="${esc(activityClass(phase))}"${title ? ` title="${esc(title)}"` : ''}>
    <i class="fa-solid fa-gear${phase === 'working' ? ' fa-spin' : ''}" aria-hidden="true"></i>
    <span class="visually-hidden">${esc(label || phase)}</span>
  </span>`;
};

// The status a CLAIM at rest sits on. `building` used to sit beside it in this
// gate, but a building card now draws unconditionally (#141), so the claim
// gate's one status is `specced` — anything earlier is still triage's,
// anything later has shipped or is already spinning above.
const CLAIMABLE = ['specced'];

/**
 * The Board's version of the glyph: an issue an agent HOLDS, or work RUNNING.
 *
 * A `building` card SPINS (owner ruling, #141): the status itself says the
 * work is in motion, so the gear turns even though a board card carries no
 * activity timestamps — and whether or not anyone is assigned yet, because
 * `building` without a holder is still work in flight, not work at rest. A
 * screen reader hears `building`, the honest word for it.
 *
 * A `specced` claim stays STILL: both halves of the claim gate hold (#46) —
 * an assignee, and a status the pipeline treats as authorized to build — and
 * the still gear says someone has this one and nothing more, `claimed` to a
 * screen reader rather than the word `idle`. An issue claimed while it is
 * still in triage is not work in flight and draws nothing.
 *
 * @param {object} issue one issue from /api/board
 * @returns {string} markup, or '' when the issue is neither running nor claimed
 */
export const claimGlyph = (issue) => {
  const held = ((issue || {}).assignees || []);
  if ((issue || {}).status === 'building') {
    return activityIcon('working', held.length ? `held by @${held.join(', @')}` : 'building', 'building');
  }
  if (!CLAIMABLE.includes((issue || {}).status) || !held.length) return '';
  return activityIcon('idle', `held by @${held.join(', @')}`, 'claimed');
};

/**
 * The stamps an indicator carries, from the node it is drawn from.
 *
 * The shape `data-live-*` is written in and read back as, in ONE place because
 * there are two writers of it now: the paint below, which draws the element,
 * and the agent dialog's refresh (modal.js), which rewrites those attributes on
 * an element the paint drew rather than replacing it (#108). An absent stamp
 * stays absent rather than becoming the epoch.
 *
 * @param {object} entry a normalized node, carrying `lastActivity`/`aliveSince`
 * @returns {{liveState: string, liveTs?: string, liveAlive?: string}}
 */
export const liveStamps = (entry) => {
  const last = Number((entry || {}).lastActivity);
  const alive = Number((entry || {}).aliveSince);
  const stamps = { liveState: (entry || {}).state || '' };
  if (Number.isFinite(last)) stamps.liveTs = String(last);
  if (Number.isFinite(alive)) stamps.liveAlive = String(alive);
  return stamps;
};

/**
 * The indicator as a crew card wears it: the glyph, then how long since the
 * agent last moved.
 *
 * The hover text is the OTHER span — how long it has been up — because the one
 * on the card is already the freshness.
 *
 * It carries its own STAMPS as well as the words made from them: a feed lands
 * every ten seconds and this markup is drawn from it, but the numbers on it are
 * seconds and have to move in between. The `data-live-*` attributes are what
 * the second-by-second clock re-reads (libs/tower/clock.js) — the raw epochs
 * and the state word, never a verdict, so the tick decides exactly what this
 * paint decided and nothing on the page holds a threshold twice.
 *
 * @param {object} entry a normalized node, carrying `lastActivity`/`aliveSince`
 * @param {number} [now] ms epoch
 * @returns {string} markup, or '' when the agent has been quiet too long
 */
export const crewActivity = (entry, now = Date.now()) => {
  const stamps = liveStamps(entry);
  const { phase, age, title } = activityTick(stamps, now);
  if (phase === 'none') return '';
  return `<span class="d-inline-flex align-items-center gap-1" data-live-state="${esc(stamps.liveState)}"${stamps.liveTs ? ` data-live-ts="${esc(stamps.liveTs)}"` : ''}${stamps.liveAlive ? ` data-live-alive="${esc(stamps.liveAlive)}"` : ''}>
    ${activityIcon(phase, title)}
    ${age ? `<span class="omega-micro text-body-secondary" data-live-age>${esc(age)}</span>` : ''}
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
export const roleIcon = (name) => `<span class="omega-tower-role omega-icon-chip omega-icon-chip--neutral" style="color: ${badgeColor(classKey(name))}" title="${esc(name || 'unknown')}">
  <i class="fa-solid ${esc(roleGlyph(name))}" aria-hidden="true"></i>
</span>`;
