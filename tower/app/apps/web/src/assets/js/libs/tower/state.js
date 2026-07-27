//
// Reading the page runtime's state: which feed answered, what it said, and what
// the repo selection leaves in play.
//
// It sits apart from the runtime (page.js) on purpose. Every function here is
// pure — state in, an array or a boolean out, no DOM and no fetch — which is
// what lets the suite import it under Node and ask it the questions the browser
// used to be the only way to ask.
//

/** The raw result of one feed: `{ ok, data, status, reason }`, or null before its first read. */
export const feed = (state, name) => state.feeds[name] || null;

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
