// An agent, drawn: the activity indicator, the age beside it, and the role
// glyph, one vocabulary for the crew cards and the Board's claims. The API
// hands over timestamps, never a verdict, so the thresholds and the arithmetic
// live here and a paint tick can age an indicator without a new read.

import { esc, badgeColor, classKey } from './format.js';

/**
 * How long an agent may stay quiet before its indicator goes muted: the
 * indicator's window, not the API's 45-minute liveness rule.
 */
export const ACTIVITY_WINDOW_MS = 60 * 1000;

/**
 * How long a muted agent stays drawn at all: long enough to cover a pause
 * between turns, short enough that a finished agent does not linger.
 */
export const QUIET_WINDOW_MS = 5 * 60 * 1000;

/**
 * The class a muted surface wears - the framework's own faint body text, so the
 * muted band costs no colour pairing of its own.
 */
export const MUTED_CLASS = 'text-body-secondary';

/**
 * How recently the transcript must have moved for the glyph to spin: two poll
 * cycles. The API's `working` flips only after its 45-minute idle window, so
 * the state word is necessary and this freshness sufficient.
 */
export const WORKING_MS = 20 * 1000;

/**
 * Which of the four states an agent's indicator is in; with no timestamp, the
 * state word alone decides.
 * - `working` - it is running and its transcript moved a poll or two ago.
 * - `idle` - it moved within the minute but has stopped, or is between turns.
 * - `quiet` - quiet longer than the minute: still drawn, muted.
 * - `none` - quiet longer than the five: no indicator at all.
 *
 * @param {{state?: string, lastActivity?: number|null}} entry a normalized node
 * @param {number} [now] ms epoch
 * @returns {'working'|'idle'|'quiet'|'none'}
 */
export const activityPhase = (entry, now = Date.now()) => {
  const working = (entry || {}).state === 'working';
  const last = Number((entry || {}).lastActivity);
  if (!Number.isFinite(last)) return working ? 'working' : 'none';
  // A clock that disagrees with the API's reads negative - treat it as this
  // instant rather than as a session from the future.
  const quiet = Math.max(0, now - last);
  if (quiet > QUIET_WINDOW_MS) return 'none';
  if (quiet > ACTIVITY_WINDOW_MS) return 'quiet';
  return working && quiet <= WORKING_MS ? 'working' : 'idle';
};

/**
 * The muted class a phase calls for, or '': the one place the faint bands are
 * named, since the paint mutes a card and the second hand un-mutes it. `none`
 * counts as muted until a paint drops the card.
 *
 * @param {'working'|'idle'|'quiet'|'none'} phase
 * @returns {string}
 */
export const mutedClass = (phase) => (phase === 'quiet' || phase === 'none' ? MUTED_CLASS : '');

/**
 * The muted class for a node - what a paint has in hand.
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
 * What an indicator should say this second, from the raw stamps alone: the
 * one home of the arithmetic, shared by the paint and the second hand
 * (clock.js), which both hand over the `data-live-*` stamps as a `dataset`.
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
 * The classes the indicator wears for a phase, written once because the clock
 * rewrites them on an element the paint drew.
 *
 * @param {'working'|'idle'|'quiet'} phase
 * @returns {string}
 */
export const activityClass = (phase) => `omega-tower-activity omega-tower-activity--${phase}`;

/**
 * The indicator itself: one gear, spinning for `working`, still and faint
 * otherwise. A gear, not a loader ring: a still loader reads as broken, and a
 * specced claim is still on purpose.
 *
 * @param {'working'|'idle'|'quiet'|'none'} phase
 * @param {string} [title] the hover text - how long it has been running
 * @param {string} [label] what a screen reader hears, when the phase is not
 *   the honest word for it: the Board's glyph means a claim, not an idle agent
 * @returns {string} markup, or '' for `none`
 */
export const activityIcon = (phase, title = '', label = '') => {
  if (phase !== 'working' && phase !== 'idle' && phase !== 'quiet') return '';
  return `<span class="${esc(activityClass(phase))}"${title ? ` title="${esc(title)}"` : ''}>
    <i class="fa-solid fa-gear${phase === 'working' ? ' fa-spin' : ''}" aria-hidden="true"></i>
    <span class="visually-hidden">${esc(label || phase)}</span>
  </span>`;
};

// The status a claim at rest sits on: anything earlier is still triage's, and
// a building card spins unconditionally.
const CLAIMABLE = ['specced'];

/**
 * The Board's version of the glyph. A `building` card spins whether or not
 * anyone is assigned, since the status says the work is in motion; a `specced`
 * card with an assignee stays still, `claimed` to a screen reader.
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
 * The stamps an indicator carries, from the node it is drawn from: one shape
 * for its two writers, the paint and the agent dialog's refresh
 * (modal/agent.js). An absent stamp stays absent rather than becoming the epoch.
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
 * agent last moved, with how long it has been up on hover. It carries its
 * `data-live-*` stamps so the second hand (clock.js) moves it between feeds.
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

// One glyph per role, each distinct at a glance; everything else Claude Code
// spawns is the plain robot. All free Font Awesome.
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
 * A card's role badge - the glyph in the colour that class is drawn in
 * everywhere else, so the icon and the chip under it agree.
 *
 * @param {string} name an agent class
 * @returns {string} markup
 */
export const roleIcon = (name) => `<span class="omega-tower-role omega-icon-chip omega-icon-chip--neutral" style="color: ${badgeColor(classKey(name))}" title="${esc(name || 'unknown')}">
  <i class="fa-solid ${esc(roleGlyph(name))}" aria-hidden="true"></i>
</span>`;
