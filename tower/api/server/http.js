// tower/api/server/http.js: the plumbing every route stands on: the exec seam,
// the cache slot, the Host and Origin allowlist, the JSON answer and the capped
// body. server.js requires it; no piece requires server.js.

const { execFileSync } = require('child_process');

// An intake payload is a title and a paragraph. Anything larger is not one, and
// reading it would let a single request hold memory the tower has no use for.
const MAX_REQUEST_BYTES = 64 * 1024;

// The names a request may arrive under before the allowlist is extended.
// The IPv6 loopback is listed bracketed: hostnameOf parses through new URL,
// which rejects a bare `::1` but resolves `[::1]` to the form requests carry.
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...opts,
});

/**
 * Memoize a producer for `ttl` ms in one slot, no key. A failure is never
 * stored, so a briefly broken read cannot pin its error for the whole TTL;
 * `fresh` bypasses the slot and repopulates it.
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
 * A value carrying `@` is refused: URL parsing drops userinfo, so
 * `evil.com@localhost` would read as `localhost`, and neither header has one.
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
 * request carries no Origin or one this tower does not answer to. The origin
 * is echoed, never `*`, which would hand every local page the whole board.
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
 * The request body, capped. An over-cap request is paused, never destroyed:
 * destroying the socket takes the response with it, so the caller answers first.
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
 * why there is none: the one body read both write paths share.
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
