//
// The one door to the tower API.
//
// The API is the plain Node server in tower/api/ on 8693; this app is served by
// OMEGA's dev server on 4300, so every call is cross-origin. The origin is
// named ONCE here — no page module ever writes a URL.
//
// CORS: the API echoes an allowed origin back in `Access-Control-Allow-Origin`
// and answers the preflight the intake POST triggers, so the dev server's
// origin reaches it. A rejection is still possible — a tower reached under a
// hostname it does not answer to — and both calls here report that as a
// readable line rather than throwing: they NEVER throw and never return
// undefined data, so a page always has something to render.
//

/**
 * Where the API lives. Overridable two ways, both without a rebuild:
 * `?api=http://host:port` in the URL (wins, so a single link can point a page
 * at another machine's tower) and `window.TOWER_API` for a console override.
 */
export const API_BASE = (() => {
  const fromQuery = new URL(location.href).searchParams.get('api');
  if (fromQuery) return fromQuery.replace(/\/+$/, '');
  if (typeof window.TOWER_API === 'string' && window.TOWER_API) return window.TOWER_API.replace(/\/+$/, '');
  return 'http://127.0.0.1:8693';
})();

/**
 * Fetch one API path.
 *
 * @param {string} path - '/api/board', with its query if any
 * @returns {Promise<{ok: boolean, data: any, status: number|null, reason: string|null}>}
 *   `ok` is false for a transport failure, a non-2xx status, unparseable JSON,
 *   and for a body that says `ok: false` itself — the four ways a feed can let
 *   a page down, told apart by `status` and `reason`.
 */
export async function fetchFeed(path) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json' } });
  } catch (error) {
    // A CORS rejection lands here too, indistinguishable from the API being
    // down — the browser deliberately hides which it was. The reason names
    // both so the reader is not sent looking for a crashed server.
    return { ok: false, data: null, status: null, reason: `${API_BASE} did not answer (${error.message}) — the API is down, or it answered without the CORS header this origin needs` };
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
 * Translate one feed answer into the poller's fetcher contract — resolve with
 * the body, throw an Error carrying `.code` (`omega.request`'s shape). api.js
 * answers in the tower's own result shape instead, because the intake dialog
 * reads its `reason` sentence directly, so the translation between the two
 * happens here, once. The reason and the status survive it: the poller stores
 * them as `reason` and `status`, which is the shape the chrome and state.js
 * already read. A body that reported `ok: false` itself loses its `data` in
 * the throw — no consumer reads `.data` on a failed feed (state.js gates every
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
 * POST a JSON body to one API path — the tower's single write path.
 *
 * Same result shape as `fetchFeed` and the same promise never to throw, with
 * one difference that matters: the body is read at EVERY status. A refused
 * intake answers 400 carrying the reason it was refused ('title is required',
 * 'unknown repo: …'), and that sentence is the only thing worth showing a
 * human — the status line is not.
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
    return { ok: false, data: null, status: null, reason: `${API_BASE} did not answer (${error.message}) — the API is down, or it answered without the CORS header this origin needs` };
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
