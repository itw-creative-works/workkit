//
// Reading the page runtime's state: which feed answered, what it said, and what
// the repo selection leaves in play.
//
// It sits apart from the runtime (page.js) on purpose. Every function here is
// pure — state in, an array or a boolean out, no DOM and no fetch — which is
// what lets the suite import it under Node and ask it the questions the browser
// used to be the only way to ask.
//
// `issueByKey` is the one that answers a question about NOW rather than about a
// paint: the Board's drop resolves the card it was handed against the feed as it
// currently stands, because every poll replaces the object graph underneath.
//

import { issueKey, LOCAL_ONLY_NOTICE } from './format.js';

/** The raw result of one feed: `{ ok, data, status, reason }`, or null before its first read. */
export const feed = (state, name) => state.feeds[name] || null;

/**
 * The slot a published copy holds for a feed only the machine can answer.
 *
 * A designed state, NOT a failure — which is the whole of its shape. The
 * poller's stale rule counts every `ok: false`, so a slot marked failed made
 * the chrome say "2 feeds unavailable" for the life of every published page;
 * this one says `ok` and carries the marker instead, and the notice rides as
 * its reason for whatever wants to draw it.
 *
 * @returns {object} a feed result in the runtime's own shape
 */
export const localOnlySlot = () => ({
  ok: true, data: null, status: null, reason: LOCAL_ONLY_NOTICE, localOnly: true,
});

/**
 * Whether a feed's slot is that stand-in rather than a read.
 *
 * What a panel keys on to say where the data lives instead of rendering the
 * zero an empty feed would produce.
 *
 * @param {object} state the runtime's feed state
 * @param {string} name the feed's name
 * @returns {boolean}
 */
export const localOnly = (state, name) => Boolean((feed(state, name) || {}).localOnly);

/** The roster, or [] when it has not answered. */
export const repos = (state) => {
  const result = feed(state, 'repos');
  return result && result.ok && Array.isArray(result.data) ? result.data : [];
};

/** The board payload, or null. */
export const board = (state) => {
  const result = feed(state, 'board');
  return result && result.ok ? result.data : null;
};

/** The live sessions, or []. */
export const sessions = (state) => {
  const result = feed(state, 'sessions');
  return result && result.ok && Array.isArray(result.data) ? result.data : [];
};

/** The per-repo health map, keyed by repo path, or {}. */
export const health = (state) => {
  const result = feed(state, 'health');
  return result && result.ok && result.data ? result.data : {};
};

/** The roster entries the selection leaves in play. */
export const reposFor = (state) => repos(state).filter((repo) => !state.selectedRepo || repo.slug === state.selectedRepo);

/** The open issues the selection leaves in play. */
export const issuesFor = (state) => {
  const payload = board(state);
  return ((payload && payload.issues) || []).filter((issue) => !state.selectedRepo || issue.repo === state.selectedRepo);
};

/**
 * The issue one `repo#number` key names, out of the board payload as it stands
 * RIGHT NOW.
 *
 * This is the whole reason it exists rather than a caller keeping its own map.
 * Every poll parses a new object graph into the feed, so an issue object a
 * paint held on to is detached the moment a read lands — and a page that
 * mutates that detached object (the Board's optimistic move) changes nothing
 * anybody draws. Asking at the moment of the interaction, never at the moment
 * of the paint, is what makes the answer the live one.
 *
 * @param {object} state the runtime's feed state
 * @param {string} key `repo#number`
 * @returns {object|null} the issue the board is holding, or null
 */
export const issueByKey = (state, key) => {
  const payload = board(state);
  return ((payload && payload.issues) || []).find((issue) => issueKey(issue) === key) || null;
};

/**
 * Whether a working directory sits in the repo the selection names — the one
 * rule that places anything with a `cwd`, so the pages that read a different
 * feed of sessions all place them the same way.
 *
 * @param {object} state the runtime's state
 * @param {string} cwd the working directory to place
 * @returns {boolean} true when nothing is selected, or when the cwd is the
 *   selected repo or sits under it
 */
export const inSelectedRepo = (state, cwd) => {
  if (!state.selectedRepo) return true;
  const paths = repos(state).filter((repo) => repo.slug === state.selectedRepo).map((repo) => repo.path);
  return paths.some((base) => cwd === base || String(cwd || '').startsWith(`${base}/`));
};

/** The live sessions the selection leaves in play — a session is placed by its cwd. */
export const sessionsFor = (state) => sessions(state).filter((session) => inSelectedRepo(state, session.cwd));
