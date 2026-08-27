//
// The one door to the tower API.
//
// The API is the plain Node server in tower/api/ on 8693; this app is served by
// OMEGA's dev server on 4300, so every call is cross-origin. The origin is
// named ONCE here - no page module ever writes a URL.
//
// CORS: the API echoes an allowed origin back in `Access-Control-Allow-Origin`
// and answers the preflight the intake POST triggers, so the dev server's
// origin reaches it. A rejection is still possible - a tower reached under a
// hostname it does not answer to - and both calls here report that as a
// readable line rather than throwing: they NEVER throw and never return
// undefined data, so a page always has something to render.
//
// The two write paths the API offers are named here as well - filing an issue
// and moving one between the board's columns - for the same reason the feeds
// are: a page decides WHEN to write, never where to.
//
// A PUBLISHED copy has no tower behind it and speaks GitHub itself instead
// (github.js), with the viewer's token. So this module answers one more
// question than it used to: not just where the tower is, but WHICH of the three
// modes this copy is in - `tower` (a machine with the API), `github` (published
// and unlocked) and `locked` (published, no token yet). The mode is decided
// once, here, and every consumer reads it off `MODE`.
//
// Both halves READ and both halves WRITE: an unlocked published copy files and
// moves issues exactly as the dashboard on the machine does, with the token it
// already holds. So each of the four doors below picks its half by the mode and
// answers in one shape, and a page module goes on knowing neither.
//

import { STATUSES } from './format.js';
import {
  readToken, readFeed, safeStorage, moveIssueStatus, createIssue,
} from './github.js';

/**
 * The API origin this page was explicitly pointed at, or '' for none. Two
 * channels, neither needing a rebuild: `?api=http://host:port` in the URL
 * (wins, so a single link can point a page at another machine's tower) and
 * `window.TOWER_API` for a console override.
 *
 * Pure, because two answers are read off it - where to call, and whether this
 * copy has a tower at all.
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
 * Live or published - the one mode question, decided from the two inputs that
 * answer it.
 *
 * `environment` is the framework's own: `omega.isDevelopment()` is
 * `config.environment === 'development'`, and that config is `window
 * .Configuration`, baked into the page by the build (`omega dev` writes
 * `development`, `omega build` writes `production`). It is read here from the
 * global rather than through `@omega.js/client` for two reasons: the singleton
 * only holds it once `omega.initialize()` has run, which is after this module
 * evaluates, and every framework import is a bundler specifier that would take
 * this module out of reach of its own suite.
 *
 * An explicitly supplied origin outranks the build: a published copy given
 * `?api=` runs fully live against whatever tower it was pointed at.
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
 * Which of the three modes this copy is in.
 *
 * A tower outranks everything: a development build, or any build pointed at an
 * origin with `?api=`, reads the machine's API and never GitHub. Otherwise this
 * is a published copy, and the token is the whole difference between a board
 * and a prompt.
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

const ENVIRONMENT = (typeof window.Configuration === 'object' && window.Configuration && window.Configuration.environment) || '';

/** This copy's mode - `tower`, `github` or `locked`. */
export const MODE = decideMode(ENVIRONMENT, OVERRIDE, Boolean(readToken(safeStorage(window))));

/**
 * Whether this copy of the dashboard has a TOWER to read. False in a published
 * build that was not pointed at one - which is not the same as having no data:
 * a published copy with a token reads GitHub directly. It is the question of
 * WHICH half answers, and nothing else.
 */
export const LIVE = MODE === 'tower';

/**
 * Whether this copy can WRITE - file an issue, move a card.
 *
 * A tower writes through its endpoints and an unlocked published copy writes
 * GitHub itself, so the only copy that cannot is the locked one: it holds no
 * token, and the token is both the credential and the auth. This, not `LIVE`,
 * is what every write path gates on.
 */
export const WRITABLE = MODE !== 'locked';

/**
 * Every feed the API offers, with its path and its re-read interval. It lives
 * beside the fetchers because this module is the one place a tower URL is
 * written.
 *
 * Cadence is the tower's old one: the board every 60 seconds (a gh sweep is
 * expensive), everything live every 10. The brief is built from the board
 * sweep and is never fresher than it, so it shares that cadence.
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
 * The feed table a PUBLISHED page arms - the feeds it asked for that GitHub can
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
 * The fetcher a published page hands the poller - the same contract
 * `feedFetcher` has, answered from GitHub instead of from a tower.
 *
 * @param {string} path - '/api/board'
 * @returns {Promise<any>} the feed's body
 */
export const githubFetcher = async (path) => unwrapFeed(await readFeed(path, githubContext()));

/**
 * One feed answer from whichever half is talking - the tower's API on a
 * machine, GitHub in a published copy.
 *
 * The poller does not need this: the runtime hands it one fetcher or the other
 * up front. What needs it is a read made OUTSIDE the loop - the intake dialog's
 * roster, read when the dialog opens - which must work in both modes without
 * the dialog knowing which it is in.
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
 * Translate one feed answer into the poller's fetcher contract - resolve with
 * the body, throw an Error carrying `.code` (`omega.request`'s shape). api.js
 * answers in the tower's own result shape instead, because the intake dialog
 * reads its `reason` sentence directly, so the translation between the two
 * happens here, once. The reason and the status survive it: the poller stores
 * them as `reason` and `status`, which is the shape the chrome and state.js
 * already read. A body that reported `ok: false` itself loses its `data` in
 * the throw - no consumer reads `.data` on a failed feed (state.js gates every
 * accessor on `ok`), so only the sentence and the status are worth carrying.
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
 * POST a JSON body to one API path - how the tower writes.
 *
 * Same result shape as `fetchFeed` and the same promise never to throw, with
 * one difference that matters: the body is read at EVERY status. A refused
 * intake answers 400 carrying the reason it was refused ('title is required',
 * 'unknown repo: …'), and that sentence is the only thing worth showing a
 * human - the status line is not.
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
 * The statuses a card may be dragged between - the pipeline's five, taken from
 * the column list rather than written a second time. A move is `from` one label
 * `to` another, so an issue triage has not reached is at neither end of one:
 * the board draws it in an alert rather than a column, and no card of it exists
 * to pick up (#118).
 */
export const MOVABLE_STATUSES = STATUSES.map((status) => status.key);

/**
 * What a drop becomes: the body the status endpoint takes, or null when the
 * drop is not a move at all.
 *
 * Pure, and the write gate is one of the things it decides - a LOCKED copy has
 * nothing to write with, so a drop there produces nothing rather than a request
 * that could never be answered. An unlocked published copy writes GitHub with
 * the viewer's token, so its drops are real moves.
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
