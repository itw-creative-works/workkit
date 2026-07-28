//
// The crew tree: what the Crew page draws, worked out before any of it is
// markup.
//
// It reads the two rosters the API serves — a `/api/telemetry` session with its
// subagents, and a bare `/api/sessions` row, which is the same root tier
// without them — and answers one node shape for both. It lives apart from the
// page so the suite can ask it what it made of a payload without a browser.
//

import { shortPath } from './format.js';

/**
 * A moment as a ms epoch, whichever way the API said it.
 *
 * A session's file times arrive as numbers (`lastActivity`, `aliveSince`) and a
 * subagent's as the transcript's own ISO stamps (`lastAt`, `startedAt`) — one
 * scale for both, so the indicator does the same arithmetic on either.
 *
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
const stamp = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * One node of the chart, from either roster.
 *
 * A telemetry session carries `tokens` and `subagents`; a plain session row
 * carries neither, and its id is `session` rather than `id`. Those are the only
 * two shapes either endpoint sends.
 *
 * @param {object} node a session or subagent row
 * @returns {{id: string, title: string, cwd: string, model: string, effort: string, state: string, agentClass: string, tokens: number|null, usage: object|null, cost: number|null, lastActivity: number|null, aliveSince: number|null, lastTool: string, lastToolAt: number|null, transcript: string, children: object[]}}
 */
export const normalize = (node) => ({
  id: node.id || node.session || '',
  title: node.chatName || '',
  cwd: node.cwd || '',
  model: node.model || '',
  effort: node.effort || '',
  state: node.state || '',
  agentClass: node.class || '',
  tokens: node.tokens ? node.tokens.total : null,
  // The counters behind that one number, for the card's dialog — a plain
  // session row has none and says so rather than reading as zeros.
  usage: node.tokens || null,
  cost: typeof node.cost === 'number' ? node.cost : null,
  lastActivity: stamp(typeof node.lastActivity === 'number' ? node.lastActivity : node.lastAt),
  aliveSince: stamp(typeof node.aliveSince === 'number' ? node.aliveSince : node.startedAt),
  lastTool: node.lastTool || '',
  lastToolAt: stamp(node.lastToolAt),
  transcript: node.transcript || '',
  children: (node.subagents || []).map(normalize),
});

/**
 * What a ROOT node is called: the repo it is working in, a slash, then the
 * chat's name — `workkit/the tower`.
 *
 * The repo is the leaf of the cwd, which is the same short name every other
 * page shows a session's repo as (format.shortPath). Both halves can be
 * missing: an unnamed chat falls back to its session id, and a session with no
 * cwd is just its name rather than a leading slash.
 *
 * @param {object} entry a normalized root node
 * @returns {string} the title text — never markup, never empty
 */
export const rootLabel = (entry) => {
  const repo = shortPath(entry.cwd);
  const name = entry.title || entry.id || 'session';
  return repo ? `${repo}/${name}` : name;
};

/**
 * A session's subagents split by whether they are still running.
 *
 * The API stamps each one `working` or `done` from how recently its transcript
 * moved. A session's transcript holds every subagent it EVER spawned, so
 * drawing them all as cards shows dozens of finished agents as live crew — the
 * finished ones are a count, not a chart.
 *
 * @param {object[]} children normalized subagent nodes
 * @returns {{working: object[], done: object[]}}
 */
export const splitCrew = (children) => ({
  working: children.filter((child) => child.state === 'working'),
  done: children.filter((child) => child.state !== 'working'),
});

/**
 * Which way the connector into one child actually flows.
 *
 * The chart's bus runs sideways from the trunk under the root out to each card,
 * and the framework animates every segment of it in ONE direction — so half the
 * lines on a wide tree crawl back towards the parent they came from. The
 * geometry says which half: a child left of centre is reached by flowing LEFT,
 * a child right of centre by flowing right, and the one sitting on the centre
 * is reached straight down with no sideways run to have a direction.
 *
 * Pure index arithmetic, because the cards are equal width and evenly spaced —
 * child `i` of `n` sits left of centre exactly when `i < (n - 1) / 2`.
 *
 * @param {number} index the child's position in the row
 * @param {number} count how many children the row holds
 * @returns {'left'|'right'|'down'}
 */
export const connectorFlow = (index, count) => {
  const middle = (count - 1) / 2;
  if (index < middle) return 'left';
  if (index > middle) return 'right';
  return 'down';
};

/** How many subagents are working across the whole tree, and how many exist. */
export const crewCount = (tree) => ({
  working: tree.reduce((sum, entry) => sum + splitCrew(entry.children).working.length, 0),
  total: tree.reduce((sum, entry) => sum + entry.children.length, 0),
});
