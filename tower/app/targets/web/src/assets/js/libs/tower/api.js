// The one door to the tower API, and the copy's mode (`tower/README.md` § The
// three modes). Every tower URL is written here, and each read and write picks
// its half by the mode, so a page module knows neither. The fetchers never
// throw and never return undefined data, so a page always has a line to draw.

import { STATUSES } from './format.js';
import {
  readToken, readFeed, safeStorage, takeTokenFromHash, moveIssueStatus, createIssue,
} from './github.js';

/**
 * The API origin this page was explicitly pointed at, or '' for none:
 * `?api=http://host:port` wins over `window.TOWER_API`.
 *
 * @param {string} href - the page URL
 * @param {object} scope - the global object carrying `TOWER_API`, if any
 * @returns {string} the origin, without a trailing slash, or ''
 */
export function apiOverride(href, scope) {
  const fromQuery = new URL(href).searchParams.get('api');
  if (fromQuery) return fromQuery.replace(/\/+$/, '');
  const fromGlobal = scope && scope.TOWER_API;
  if (typeof fromGlobal === 'string' && fromGlobal) return fromGlobal.replace(/\/+$/, '');
  return '';
}

/**
 * Whether this copy has a tower; an explicit origin outranks the build.
 * `environment` is read off `window.OMEGA_BUILD_JSON`, not `@omega.js/client`:
 * the singleton holds it only after `omega.initialize()`, and a framework
 * import would put this module out of its suite's reach.
 *
 * @param {string} environment - `config.environment` for this build
 * @param {string} override - the origin the page was pointed at, or ''
 * @returns {boolean} whether this copy has a tower to read
 */
export function decideLive(environment, override) {
  return Boolean(override) || environment === 'development';
}

const OVERRIDE = apiOverride(location.href, window);

/** Where the API lives. */
export const API_BASE = OVERRIDE || 'http://127.0.0.1:8693';

/**
 * Which of the three modes this copy is in: a tower outranks everything, and
 * otherwise the token decides.
 *
 * @param {string} environment - `config.environment` for this build
 * @param {string} override - the origin the page was pointed at, or ''
 * @param {boolean} hasToken - whether this browser holds a GitHub token
 * @returns {'tower'|'github'|'locked'}
 */
export function decideMode(environment, override, hasToken) {
  if (decideLive(environment, override)) return 'tower';
  return hasToken ? 'github' : 'locked';
}

const ENVIRONMENT = (window.OMEGA_BUILD_JSON && window.OMEGA_BUILD_JSON.config && window.OMEGA_BUILD_JSON.config.environment) || '';

// A setup handover is banked before the mode is read off the storage it lands
// in, so a copy arriving with the fragment is a copy holding a token.
takeTokenFromHash(window);

/** This copy's mode - `tower`, `github` or `locked`. */
export const MODE = decideMode(ENVIRONMENT, OVERRIDE, Boolean(readToken(safeStorage(window))));

/**
 * Whether this copy reads a tower: which half answers, never whether there is
 * data (a published copy with a token reads GitHub).
 */
export const LIVE = MODE === 'tower';

/**
 * Whether this copy can write. Only a locked copy cannot, having no token;
 * every write path gates on this, not `LIVE`.
 */
export const WRITABLE = MODE !== 'locked';

/**
 * Every feed the API offers, with its path and re-read interval: the board
 * every minute (a gh sweep is expensive) and the brief with it, since it is
 * built from that sweep; everything live every ten seconds.
 */
export const FEEDS = {
  repos: { path: '/api/repos', every: 10000, fresh: '/api/repos?fresh=1' },
  board: { path: '/api/board', every: 60000, fresh: '/api/board?fresh=1' },
  brief: { path: '/api/brief', every: 60000 },
  sessions: { path: '/api/sessions', every: 10000 },
  health: { path: '/api/health', every: 10000 },
  telemetry: { path: '/api/telemetry', every: 10000 },
};

/**
 * The feed table a page arms - the feeds it asked for, and in published mode
 * none at all, so a copy with no tower behind it makes zero doomed requests.
 *
 * @param {string[]} names - the feeds the page reads
 * @param {boolean} [live] - the mode, injectable for the suite
 * @returns {object} the poller's feed table
 */
export const pageFeeds = (names, live = LIVE) => (
  live ? Object.fromEntries(names.map((name) => [name, FEEDS[name]])) : {}
);

/**
 * The three feeds a published copy can answer for itself, and the cadence it
 * answers them at. Every one is a live GitHub call made by the browser, so the
 * board's minute is the ceiling for all of them: the roster is a static file
 * beside the pages, and the brief is that same sweep plus one Discussions read.
 */
export const GITHUB_FEEDS = {
  repos: { path: '/api/repos', every: 300000 },
  board: { path: '/api/board', every: 60000 },
  brief: { path: '/api/brief', every: 60000 },
};

/**
 * The feed table a published page arms - the feeds it asked for that GitHub can
 * answer. A machine-bound feed (sessions, health, telemetry) is simply absent,
 * and the runtime fills its slot with the local-only sentence rather than
 * leaving the page waiting on a read that will never come.
 *
 * @param {string[]} names - the feeds the page reads
 * @returns {object} the poller's feed table
 */
export const githubPageFeeds = (names) => Object.fromEntries(
  names.filter((name) => GITHUB_FEEDS[name]).map((name) => [name, GITHUB_FEEDS[name]]),
);

/** The seams github.js needs, read fresh so a token stored mid-session is used at once. */
const githubContext = () => ({
  token: readToken(safeStorage(window)),
  fetch: (url, options) => fetch(url, options),
});

/**
 * The fetcher a published page hands the poller: `feedFetcher`'s contract,
 * answered from GitHub. `onPage` lets the page draw the board as each sweep
 * round lands (page.js).
 *
 * @param {string} path - '/api/board'
 * @param {Function} [onPage] - handed the board so far, once per round
 * @returns {Promise<any>} the feed's body
 */
export const githubFetcher = async (path, onPage) => unwrapFeed(await readFeed(path, { ...githubContext(), onPage }));

/**
 * One feed answer from whichever half is talking, for a read made outside the
 * poll loop (the intake dialog's roster) that must work in both modes.
 *
 * @param {string} path - '/api/repos'
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const readAnyFeed = (path) => (MODE === 'github' ? readFeed(path, githubContext()) : fetchFeed(path));

/**
 * Fetch one API path.
 *
 * @param {string} path - '/api/board', with its query if any
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `ok` is false for a transport failure, a non-2xx status, unparseable JSON,
 *   and for a body that says `ok: false` itself - the four ways a feed can let
 *   a page down, told apart by `status` and `reason`.
 */
export async function fetchFeed(path) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
  } catch (error) {
    // A CORS rejection lands here too, indistinguishable from the API being
    // down - the browser deliberately hides which it was. The reason names
    // both so the reader is not sent looking for a crashed server.
    return { ok: false, data: null, status: null, reason: `${API_BASE} did not answer (${error.message}) - the API is down, or it answered without the CORS header this origin needs` };
  }

  if (!response.ok) {
    return { ok: false, data: null, status: response.status, reason: `${path} answered ${response.status}` };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, data: null, status: response.status, reason: `${path} did not answer with JSON (${error.message})` };
  }

  if (data && data.ok === false) {
    return { ok: false, data, status: response.status, reason: data.reason || `${path} reported a failure` };
  }
  return { ok: true, data, status: response.status, reason: null };
}

/**
 * Translate one feed answer into the poller's fetcher contract: resolve with
 * the body, or throw an Error carrying `.code` (`omega.request`'s shape). A
 * failed body's `data` is dropped in the throw: state.js gates every accessor
 * on `ok`, so only the reason and the status are carried.
 *
 * @param {{ok: boolean, data: any, status: number|null, reason: string|null}} answer
 * @returns {any} the feed's body when `ok`
 * @throws {Error} carrying the reason as its message and the status as `.code`
 */
export function unwrapFeed(answer) {
  if (answer.ok) return answer.data;
  const error = new Error(answer.reason);
  error.code = answer.status;
  throw error;
}

/**
 * The fetcher the page runtime hands to the framework's feed poller.
 *
 * @param {string} path - '/api/board', with its query if any
 * @returns {Promise<any>} the feed's body
 */
export const feedFetcher = async (path) => unwrapFeed(await fetchFeed(path));

/**
 * POST a JSON body to one API path: `fetchFeed`'s shape and promise, except
 * the body is read at every status, since a refused write's 400 carries the
 * only sentence worth showing ('title is required').
 *
 * @param {string} path - '/api/intake'
 * @param {object} payload - the JSON body to send
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export async function postJson(path, payload) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { ok: false, data: null, status: null, reason: `${API_BASE} did not answer (${error.message}) - the API is down, or it answered without the CORS header this origin needs` };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    return { ok: false, data: null, status: response.status, reason: `${path} did not answer with JSON (${error.message})` };
  }

  if (!response.ok || (data && data.ok === false)) {
    return { ok: false, data, status: response.status, reason: (data && data.reason) || `${path} answered ${response.status}` };
  }
  return { ok: true, data, status: response.status, reason: null };
}

/**
 * The statuses a card may be dragged between, taken from the column list. An
 * issue with no status is at neither end of a move: the board draws it in an
 * alert, never as a card.
 */
export const MOVABLE_STATUSES = STATUSES.map((status) => status.key);

/**
 * What a drop becomes: the body the status endpoint takes, or null when the
 * drop is not a move. A locked copy has nothing to write with, so its drops
 * produce nothing.
 *
 * @param {object} issue - the issue that was dragged
 * @param {string} to - the status of the column it was dropped on
 * @param {boolean} [writable] - the mode, injectable for the suite
 * @returns {{repo: string, number: number, from: string, to: string}|null}
 */
export function moveRequest(issue, to, writable = WRITABLE) {
  if (!writable || !issue) return null;
  if (!MOVABLE_STATUSES.includes(issue.status) || !MOVABLE_STATUSES.includes(to)) return null;
  if (issue.status === to) return null;
  return {
    repo: issue.repo, number: issue.number, from: issue.status, to,
  };
}

/**
 * Move one issue along the pipeline - the second write path, and the only one
 * that changes an issue that already exists.
 *
 * @param {{repo: string, number: number, from: string, to: string}} move
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const postIssueStatus = (move) => (MODE === 'github'
  ? moveIssueStatus(move, githubContext())
  : postJson('/api/issues/status', move));

/**
 * File one issue - the first write path, and the dialog's whole job.
 *
 * @param {{repo: string, title: string, body: string}} payload
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const submitIntake = (payload) => (MODE === 'github'
  ? createIssue(payload, githubContext())
  : postJson('/api/intake', payload));
