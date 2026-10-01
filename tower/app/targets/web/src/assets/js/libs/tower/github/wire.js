// libs/tower/github/wire.js: GraphQL and the REST call the roster and writes
// share, the limit mark, the token refusal, and helpers its siblings import.
// github.js re-exports it by name; no piece imports github.js.

// ── The wire ───────────────────────────────────────────────────────────────

import { rateLimitReason } from './sweep.js';

const GRAPHQL_URL = 'https://api.github.com/graphql';

/** What the caller must be told when there is no token at all. */
export const NO_TOKEN = 'no GitHub token in this browser - add one to unlock the board';

/**
 * The rate-limit mark, carried only when there is one: a failure travels
 * graphql, fetchBoard, readFeed before the runtime reads it, and the status
 * alone cannot say which kind of 403 it was.
 *
 * @param {{rateLimited?: boolean}} result - the answer it is read off
 * @returns {{rateLimited?: boolean}}
 */
export const limitMark = (result) => ((result || {}).rateLimited ? { rateLimited: true } : {});

/**
 * The headers a rate limit speaks in, lifted off a `Response` into the plain
 * object the shared reading takes - which is the shape the machine's half hands
 * it after splitting them off `gh --include`.
 *
 * @param {{headers?: {get: Function}}} response - what `fetch` answered
 * @returns {Object<string, string|null>}
 */
const limitHeaders = (response) => {
  const read = (name) => (response.headers && typeof response.headers.get === 'function' ? response.headers.get(name) : null);
  return {
    'x-ratelimit-remaining': read('x-ratelimit-remaining'),
    'x-ratelimit-reset': read('x-ratelimit-reset'),
    'retry-after': read('retry-after'),
  };
};

/**
 * One GraphQL request. Never throws, and tells its four failures apart: no
 * token, transport, a refusing status (a spent limit told apart from a bad
 * token), and a body that is not JSON. Data and errors together is a success:
 * the caller hangs each error on the repo it names.
 *
 * @param {string} query - the document
 * @param {object} ctx
 * @param {string} ctx.token
 * @param {Function} ctx.fetch - the fetch implementation
 * @returns {Promise<{ok: boolean, data: any, errors: any[], status: number|null, reason: string|null}>}
 */
export const graphql = async (query, ctx = {}) => {
  const token = ctx.token || '';
  if (!token) return { ok: false, data: null, errors: [], status: null, reason: NO_TOKEN };

  let response;
  try {
    response = await ctx.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    return { ok: false, data: null, errors: [], status: null, reason: `GitHub did not answer (${error.message})` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  // The limit is read before the refusal: it wears the same status, and on
  // GraphQL the primary limit is a 200 told only by the error type. A partial
  // answer is still an answer, so the errors speak only when no data came back.
  const limited = rateLimitReason(response.status, limitHeaders(response), Date.now(), {
    message: payload && payload.message,
    errors: payload && payload.data ? null : payload && payload.errors,
  });
  if (limited) return { ok: false, data: null, errors: [], status: response.status, reason: limited, rateLimited: true };

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      data: null,
      errors: [],
      status: response.status,
      reason: `GitHub refused the token (${response.status}) - it may be expired, or it may not cover these repositories. Hand over one that does.`,
    };
  }
  if (!response.ok) {
    return { ok: false, data: null, errors: [], status: response.status, reason: `GitHub answered ${response.status}` };
  }
  if (!payload || !payload.data) {
    const said = payload && Array.isArray(payload.errors) && payload.errors[0] && payload.errors[0].message;
    return { ok: false, data: null, errors: (payload && payload.errors) || [], status: response.status, reason: said || 'GitHub answered without data' };
  }
  return { ok: true, data: payload.data, errors: payload.errors || [], status: response.status, reason: null };
};

/** The two statuses that mean the token is the problem, not the read. */
const REFUSED = [401, 403];

/**
 * Whether a feed result is GitHub refusing the token itself: asked by the
 * fetchers and by the runtime, which answers it with the Settings pointer. A
 * spent rate limit wears the same 403 and is not this: no token fixes it.
 *
 * @param {{ok: boolean, status: number|null, rateLimited?: boolean}} result - a feed result
 * @returns {boolean}
 */
export const isTokenRefusal = (result) => Boolean(result) && result.ok === false && !result.rateLimited && REFUSED.includes(result.status);

const REST_URL = 'https://api.github.com';

/**
 * What a refused write means: a token that reads but cannot change these
 * repositories answers 403 on the write alone, so the sentence names the
 * missing permission.
 *
 * @param {number} status - 401 or 403
 * @returns {string}
 */
const writeRefusal = (status) => (status === 403
  ? 'GitHub refused the write (403) - this token can read these repositories but not change them. Make one with Issues: Read and write, and hand that one over.'
  : 'GitHub refused the token (401) - it is expired, or it is not a token any more. Hand over a fresh one.');

/**
 * What a refused read means: a 403 on a write's first call says the token
 * cannot see the repository, which is a different permission to ask for.
 *
 * @param {number} status - 401 or 403
 * @returns {string}
 */
const readRefusal = (status) => (status === 403
  ? 'GitHub refused the read (403) - this token does not cover that repository. Hand over one that does.'
  : 'GitHub refused the token (401) - it is expired, or it is not a token any more. Hand over a fresh one.');

/**
 * One REST request.
 *
 * @param {string} path - the path under api.github.com
 * @param {object} ctx - `{ token, fetch }`
 * @param {object} [init] - `{ method, body, accept }`; a body is sent as JSON
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 */
export const rest = async (path, ctx = {}, init = {}) => {
  const token = ctx.token || '';
  if (!token) return { ok: false, data: null, status: null, reason: NO_TOKEN };

  const method = init.method || 'GET';
  let response;
  try {
    response = await ctx.fetch(`${REST_URL}${path}`, {
      method,
      // GitHub lets a browser reuse a GET for a minute; every read here wants what GitHub holds now.
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
      headers: {
        authorization: `Bearer ${token}`,
        accept: init.accept || 'application/vnd.github+json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
  } catch (error) {
    return { ok: false, data: null, status: null, reason: `GitHub did not answer (${error.message})` };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  // Read before the refusal, as the sweep reads it. The roster is read on this
  // path, so a limit hit here is the one the viewer meets first.
  const limited = rateLimitReason(response.status, limitHeaders(response), Date.now(), { message: payload && payload.message });
  if (limited) return { ok: false, data: null, status: response.status, reason: limited, rateLimited: true };

  if (REFUSED.includes(response.status)) {
    const refusal = method === 'GET' ? readRefusal : writeRefusal;
    return { ok: false, data: null, status: response.status, reason: refusal(response.status) };
  }
  if (!response.ok) {
    // GitHub's own sentence is the useful half of a refusal that is not the
    // token's fault - a deleted issue, a label the repo does not carry.
    const said = payload && payload.message;
    return { ok: false, data: null, status: response.status, reason: said ? `GitHub answered ${response.status}: ${said}` : `GitHub answered ${response.status}` };
  }
  return { ok: true, data: payload, status: response.status, reason: null };
};
