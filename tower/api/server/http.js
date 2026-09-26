// tower/api/server/http.js: the plumbing every route stands on: the exec seam,
// the cache slot, the Host and Origin allowlist, the JSON answer and the capped
// body. server.js requires it; no piece requires server.js.

const { execFileSync } = require('child_process');

// An intake payload is a title and a paragraph. Anything larger is not one, and
// reading it would let a single request hold memory the tower has no use for.
const MAX_REQUEST_BYTES = 64 * 1024;

// The names a request may arrive under before the allowlist is extended.
// The IPv6 loopback is listed BRACKETED: hostnameOf parses through new URL,
// which rejects a bare `::1` but resolves `[::1]` to the form requests carry.
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...opts,
});

/**
 * Memoize a producer for `ttl` ms. One slot, no key: every cached call here
 * asks the same whole-roster question.
 *
 * A FAILURE is never stored. `gh` being briefly unauthenticated, or a roster read
 * that threw, would otherwise pin its own error in front of every read for the
 * whole TTL: the tower would stay broken for a minute after the machine was
 * fine again. Only an answer worth keeping takes the slot; everything else is
 * returned to this one caller and asked again next time.
 *
 * `fresh` bypasses the slot and repopulates it: the page's manual refresh
 * button, which must be able to actually refresh.
 *
 * @param {number} ttl
 * @param {Function} produce
 * @param {Function} [keep] does this result deserve the slot?
 * @returns {Function}
 */
const cached = (ttl, produce, keep = (value) => !(value && value.ok === false)) => {
  let stored;
  let at = 0;
  return ({ fresh = false } = {}) => {
    const now = Date.now();
    if (!fresh && stored !== undefined && now - at < ttl) return stored;
    const value = produce();
    if (keep(value)) {
      stored = value;
      at = now;
    }
    return value;
  };
};

/**
 * The hostname in a Host header or an Origin URL, port and brackets stripped.
 *
 * A value carrying `@` is REFUSED outright rather than parsed. URL parsing
 * reads everything before an `@` as userinfo and drops it, so `evil.com@
 * localhost` would answer `localhost` and walk straight through an allowlist
 * that has never heard of evil.com. Neither header has a userinfo component to
 * begin with (RFC 7230 gives Host the grammar `host [":" port]`) so a value
 * containing one is malformed, and the only safe reading of it is none.
 *
 * @param {string|undefined} value a Host header or an Origin URL
 * @returns {string|null} the hostname, or null if there is not exactly one
 */
const hostnameOf = (value) => {
  if (!value || value.includes('@')) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
};

/**
 * The `Access-Control-Allow-Origin` value for a request, or null when the
 * request carries no Origin or one this tower does not answer to.
 *
 * The judgment is the SAME allowlist the Host and intake gates use, so the app
 * on the dev server is reachable exactly because `localhost` is already a name
 * the tower answers to. It echoes the caller's origin rather than sending `*`:
 * `*` would hand every page on the machine the tower's whole board.
 *
 * @param {string|undefined} origin the request's Origin header
 * @param {Set<string>} hosts the allowlist from allowedHosts
 * @returns {string|null} the origin to echo back
 */
const corsOrigin = (origin, hosts) => {
  if (!origin) return null;
  const name = hostnameOf(origin);
  return name && hosts.has(name) ? origin : null;
};

/** The names this tower answers to. */
const allowedHosts = (extra) => {
  const listed = []
    .concat(LOCAL_HOSTS, extra || [], (process.env.TOWER_ALLOW_HOST || '').split(','))
    .map((name) => hostnameOf(String(name).trim()))
    .filter(Boolean);
  return new Set(listed);
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

/**
 * The request body, capped. Rejects rather than buffering an unbounded upload.
 *
 * An over-cap request is PAUSED, never destroyed here: destroying the socket
 * takes the response with it, and the client learns nothing about why. The
 * caller answers first and closes the connection once that answer is on the
 * wire.
 */
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      const err = new Error(`request body is larger than ${MAX_REQUEST_BYTES} bytes`);
      err.tooLarge = true;
      req.pause();
      reject(err);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

/**
 * The JSON body of a write request, or nothing once the client has been told
 * why there is none. Both write paths read a body the same way, so the answer (
 * including the over-cap dance, where the response goes out before the socket
 * closes) is written once.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {Promise<{ok: boolean, payload?: any}>}
 */
const readPayload = async (req, res) => {
  try {
    return { ok: true, payload: JSON.parse(await readBody(req)) };
  } catch (err) {
    // The answer goes out first; an over-cap request still has bytes in flight,
    // and the connection closes only once the client has been told.
    sendJson(res, err.tooLarge ? 413 : 400, { ok: false, reason: `unreadable body: ${err.message}` });
    if (err.tooLarge) res.on('finish', () => req.destroy());
    return { ok: false };
  }
};

/** The URL `gh issue create` prints, from output that may carry other lines. */
const urlFrom = (stdout) => {
  const match = String(stdout || '').match(/https:\/\/\S+/);
  return match ? match[0] : null;
};

module.exports = {
  defaultExec,
  cached,
  hostnameOf,
  corsOrigin,
  allowedHosts,
  sendJson,
  readPayload,
  urlFrom,
  MAX_REQUEST_BYTES,
};
