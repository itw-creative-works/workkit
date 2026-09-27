// libs/tower/format/badges.js: which model and which crew class falls in which
// tone slot, the badges drawn in it, and the cap on a glanced list.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';

// ── Models and agent classes ───────────────────────────────────────────────
// Which name falls in which tone slot is code's (only code reads
// `claude-opus-5[1m]` as opus); the colours are the framework's categorical
// ramp, so dark mode follows and a chart bar matches the badge beside it.

// Ordered longest-lived first only for readability; the ids they match are
// disjoint, so no name can fall in two slots. `<synthetic>` - Claude Code's
// locally generated messages - matches none of them and draws as `other`.
const MODEL_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

/**
 * The badge slot a model id is drawn in.
 *
 * Ids arrive decorated the same way the API's pricing table sees them - a
 * dated build (`claude-opus-4-1-20250805`), a context variant
 * (`claude-opus-5[1m]`) - and every decoration of one family is that family.
 *
 * @param {string} model a model id, or anything at all
 * @returns {string} one of MODEL_FAMILIES, or 'other'
 */
export const modelKey = (model) => {
  const id = String(model || '').toLowerCase();
  return MODEL_FAMILIES.find((family) => id.includes(family)) || 'other';
};

// The crew, plus `manager` for the root tier - the name telemetry's byClass
// gives a main chat. Anything else Claude Code spawns (general-purpose and the
// built-ins) is drawn neutral rather than borrowing a crew colour.
const AGENT_CLASSES = ['manager', 'advisor', 'worker', 'verifier', 'scout', 'reviewer'];

/**
 * The badge slot an agent class is drawn in. `workkit:worker` and `worker` are
 * the same class - the API already strips the prefix, and this survives it
 * either way.
 *
 * @param {string} name an agent class
 * @returns {string} one of AGENT_CLASSES, or 'other'
 */
export const classKey = (name) => {
  const bare = String(name || '').split(':').pop().trim().toLowerCase();
  return AGENT_CLASSES.includes(bare) ? bare : 'other';
};

// The one mapping from a name to a tone slot, for both vocabularies (disjoint
// keys). Six slots for ten names, so each model takes the slot of a class that
// never runs it, and the chips that sit together on a crew card never match.
// `other` is absent: an unset tone paints in the muted ink.
const TONES = {
  fable: 5, sonnet: 6, opus: 2, haiku: 4,
  manager: 1, scout: 2, reviewer: 3, advisor: 4, worker: 5, verifier: 6,
};

/** The colour of a slot, as a token a chart can resolve against :root. */
export const badgeColor = (key) => (TONES[key] ? `var(--omega-chart-${TONES[key]})` : 'var(--omega-ink-muted)');

/** One coloured chip. The label is the raw name - a model id is not a word. */
export const badge = (key, label) => `<span class="omega-chip omega-badge-tone${TONES[key] ? ` omega-tone-${TONES[key]}` : ''}">${esc(label)}</span>`;

/** The badge for a model id - an unknown model still gets one, saying so. */
export const modelBadge = (model) => badge(modelKey(model), model || 'model unknown');

/** The badge for an agent class. */
export const classBadge = (name) => badge(classKey(name), name || 'unknown');

/**
 * The first `limit` of a list, and how many that left behind: an Overview
 * panel is a glance, and every caller says how many it holds back.
 *
 * @param {Array} items
 * @param {number} [limit]
 * @returns {{shown: Array, hidden: number}}
 */
export const cap = (items, limit = 5) => {
  const list = items || [];
  return { shown: list.slice(0, limit), hidden: Math.max(0, list.length - limit) };
};
