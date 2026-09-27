// The crew tree the Crew page draws, worked out before any of it is markup:
// one node shape from a `/api/telemetry` session or a bare `/api/sessions` row,
// kept apart from the page so the suite can read it without a browser.

import { shortPath } from './format.js';

/**
 * A moment as a ms epoch, whichever way the API said it: a session's file
 * times are numbers, a subagent's are the transcript's ISO stamps.
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
  // The counters behind that one number, for the card's dialog - a plain
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
 * What a root node is called: the cwd's leaf, a slash, then the chat's name
 * (`workkit/the tower`). An unnamed chat falls back to its session id, and no
 * cwd drops the repo and the slash.
 *
 * @param {object} entry a normalized root node
 * @returns {string} the title text - never markup, never empty
 */
export const rootLabel = (entry) => {
  const repo = shortPath(entry.cwd);
  const name = entry.title || entry.id || 'session';
  return repo ? `${repo}/${name}` : name;
};

/**
 * A session's subagents split by whether they are still running: its
 * transcript holds every subagent it ever spawned, and the finished ones are a
 * count, not a chart.
 *
 * @param {object[]} children normalized subagent nodes
 * @returns {{working: object[], done: object[]}}
 */
export const splitCrew = (children) => ({
  working: children.filter((child) => child.state === 'working'),
  done: children.filter((child) => child.state !== 'working'),
});

/**
 * Which way the connector into one child flows: the framework animates every
 * bus segment one way, so a child left of centre is reached flowing left, one
 * right of centre flowing right, and the centre one straight down. The cards
 * are equal width and evenly spaced, so the index says which.
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
