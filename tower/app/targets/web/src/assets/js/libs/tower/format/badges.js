// libs/tower/format/badges.js: which model and which crew class falls in which
// tone slot, the badges drawn in it, and the cap on a glanced list.
// format.js re-exports it whole; no piece imports format.js.

import { esc } from './values.js';

//
// ── Models and agent classes ───────────────────────────────────────────────
//
// A model and a crew class are said on three surfaces - the Crew cards, the
// Usage table, the Usage charts - and each is drawn in one colour on all of
// them, so a glance at the chart and a glance at a card agree.
//
// The split of homes is deliberate. What lives HERE is which name falls in
// which slot, because only code can read `claude-opus-5[1m]` as opus. The
// COLOURS are the framework's categorical ramp - `.omega-tone-1..6` sets
// `--omega-tone` from `--omega-chart-1..6` and `.omega-badge-tone` paints a
// chip with it - which is what makes dark mode follow, and makes a bar on the
// Usage chart and the badge beside it the same colour for the same thing.
//

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

//
// The one mapping from a name to a tone slot, for both vocabularies at once -
// the keys are disjoint, so one table cannot be ambiguous. The ramp has six
// slots and the two vocabularies name ten things, so sharing is forced - the
// rule is WHO shares: each model takes the slot of a class that never runs it
// (workers and verifiers run opus, scouts sonnet, managers and advisors fable
// per the manager ladder, and a reviewer inherits the session's model - so
// opus avoids reviewer's slot too), so the class chip and the model chip that
// actually sit together on a crew card never match. Within a vocabulary a tone
// never repeats. `other` is absent on purpose: with no tone set,
// `.omega-badge-tone` paints itself in the muted ink it falls back to.
//
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
 * The first `limit` of a list, and how many that left behind.
 *
 * A panel on the Overview is a glance, not an inventory: past a handful of
 * rows it stops being read and starts pushing the panels under it off the
 * fold. The remainder is never dropped silently - every caller says how many
 * it is holding back and where the rest are.
 *
 * @param {Array} items
 * @param {number} [limit]
 * @returns {{shown: Array, hidden: number}}
 */
export const cap = (items, limit = 5) => {
  const list = items || [];
  return { shown: list.slice(0, limit), hidden: Math.max(0, list.length - limit) };
};
