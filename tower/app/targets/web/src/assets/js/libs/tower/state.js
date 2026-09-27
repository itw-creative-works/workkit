// Reading the page runtime's state: which feed answered, what it said, and what
// the repo selection leaves in play. Pure and apart from the runtime (page.js),
// so the suite asks it under Node.

import { issueKey, LOCAL_ONLY_NOTICE } from './format.js';
import { inScope, selectedSlugs } from './scope.js';

/** The raw result of one feed: `{ ok, data, status, reason }`, or null before its first read. */
export const feed = (state, name) => state.feeds[name] || null;

/**
 * The slot a published copy holds for a feed only the machine can answer: a
 * designed state, not a failure, so it is `ok` and marked, since the poller's
 * stale rule counts every `ok: false`. The notice rides as its reason.
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

/**
 * The brief payload, or null: the feed the history rides on. The Brief page
 * reads the feed itself, since an unanswered read and a failed one are two
 * different pages there and this getter makes both null.
 */
export const brief = (state) => {
  const result = feed(state, 'brief');
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
export const reposFor = (state) => {
  const slugs = selectedSlugs(state);
  return repos(state).filter((repo) => inScope(slugs, repo.slug));
};

/** The open issues the selection leaves in play. */
export const issuesFor = (state) => {
  const payload = board(state);
  const slugs = selectedSlugs(state);
  return ((payload && payload.issues) || []).filter((issue) => inScope(slugs, issue.repo));
};

/**
 * The issue one `repo#number` key names, out of the board payload as it stands
 * now: every poll parses a new object graph, so an issue a paint held on to is
 * detached, and mutating it (the Board's optimistic move) changes nothing drawn.
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
 * Whether a working directory sits in the repo the selection names - the one
 * rule that places anything with a `cwd`, so the pages that read a different
 * feed of sessions all place them the same way.
 *
 * @param {object} state the runtime's state
 * @param {string} cwd the working directory to place
 * @returns {boolean} true when nothing is selected, or when the cwd is one of
 *   the selected repos or sits under one
 */
export const inSelectedRepo = (state, cwd) => {
  const slugs = selectedSlugs(state);
  if (!slugs.length) return true;
  const paths = repos(state).filter((repo) => inScope(slugs, repo.slug)).map((repo) => repo.path);
  return paths.some((base) => cwd === base || String(cwd || '').startsWith(`${base}/`));
};

/** The live sessions the selection leaves in play - a session is placed by its cwd. */
export const sessionsFor = (state) => sessions(state).filter((session) => inSelectedRepo(state, session.cwd));
