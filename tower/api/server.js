#!/usr/bin/env node
//
// The tower's API: one plain-Node process, zero dependencies.
//
// It serves JSON and nothing else: the dashboard is the OMEGA app under
// tower/app, served by its own dev server, and it reads this API cross-origin.
// Anything outside /api/* here is a 404.
//
// Every endpoint is a thin wrapper over a lib under tower/api/lib: the server
// owns routing, caching and validation, and nothing else. It is a VIEW, so the
// whole surface has exactly two write paths (`POST /api/intake`, which files an
// issue, and `POST /api/issues/status`, which moves one along the pipeline) and
// both write through the door everyone else uses, `gh`.
//
// Binding is 127.0.0.1 on purpose. The phone reaches the tower through
// `tailscale serve`, which proxies to localhost, so there is never a second
// listener to authenticate. Nothing here checks a credential because nothing
// here is reachable without one at the Tailscale layer.
//
// What the bind cannot cover is a browser: any page can resolve a name it owns
// to 127.0.0.1 and reach a localhost listener, so the Host header is checked
// against an allowlist on EVERY request, and a request that carries an Origin
// must carry one from that same allowlist. Because `tailscale serve` proxies
// under the tailnet hostname, that hostname belongs in `TOWER_ALLOW_HOST`
// (comma-separated) or `opts.allowHosts`. Otherwise the phone sees a 403.
//
// CORS falls out of that one allowlist: an allowed origin is ECHOED back in
// `Access-Control-Allow-Origin` (never `*`), and the preflight is answered for
// every POST the page makes. The dashboard on the dev server reaches the API
// exactly because `localhost` is already a name this tower answers to.
//
// Caching is in memory and time based, matching the poll rates the page uses:
// the roster and the board are expensive (a disk read, a GraphQL round trip)
// and change slowly; sessions and health are cheap and change constantly.
//
// The PIECES live beside this file in server/, one module per concern: the
// plumbing (http.js), the rules a write is judged by (validate.js), the reads
// behind their caches (feeds.js) and the two writes (writes.js). This file keeps
// the router, wires the pieces together, and re-exports their public names.
//
// Every `opts` key passes straight through to the libs, which is what lets the
// test suite run the WHOLE server against fixture directories and a fake exec.
//
// Usage:
//   node tower/api/server.js                // TOWER_PORT, default 8693
//   createServer({ root, exec }).listen(0);  // offline, against fixtures
//

const http = require('http');

const {
  defaultExec, hostnameOf, corsOrigin, allowedHosts, sendJson, urlFrom, MAX_REQUEST_BYTES,
} = require('./server/http');
const {
  validateIntake, validateMove, MOVE_STATUSES, TITLE_MAX, BODY_MAX, DEFAULT_BODY,
} = require('./server/validate');
const { createFeeds } = require('./server/feeds');
const { createWrites } = require('./server/writes');
const { createLogger } = require('./lib/log');

// One voice for everything this process prints (issue #237): the same glyph
// lines the shell half prints from workflow/lib.sh.
const log = createLogger();

// TOWER on a phone keypad is 86937; 8693 is what fits a port.
const DEFAULT_PORT = 8693;
const DEFAULT_BIND = '127.0.0.1';

// How long a browser may keep a preflight answer. The allowlist changes only
// when the process restarts, so ten minutes costs nothing and saves the page a
// round trip before every intake POST.
const CORS_MAX_AGE = 600;

/**
 * The tower server.
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.markerDir] the keep-awake marker directory
 * @param {string} [opts.stateDir] the statusline cache directory
 * @param {string} [opts.home] overrides ~ for the libs that resolve it
 * @param {number} [opts.idleMinutes] the working/idle threshold
 * @param {string[]} [opts.allowHosts] extra hostnames this tower answers to
 * @param {Function} [opts.exec] (cmd, args) => stdout: the git/gh/ps seam
 * @returns {import('http').Server}
 */
const createServer = (opts = {}) => {
  const exec = opts.exec || defaultExec;
  const seam = { exec };
  const hosts = allowedHosts(opts.allowHosts);

  const {
    roster, board, sessions, telemetry, healthPayload, brief, slugsNow,
  } = createFeeds({ opts, exec, seam, log });
  const { intake, moveStatus } = createWrites({ exec, slugsNow });

  /**
   * One request, start to finish. Separated from the listener below only so
   * that every path out of it - including a throw - passes through one place.
   */
  const handle = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const fresh = url.searchParams.get('fresh') === '1';

    // The bind keeps other machines out; this keeps other PAGES out. A site
    // that resolves its own name to 127.0.0.1 reaches this listener, and the
    // Host header it must send is the name it used.
    const host = hostnameOf(req.headers.host);
    if (!host || !hosts.has(host)) {
      sendJson(res, 403, { ok: false, reason: `host not allowed: ${req.headers.host || '(none)'}` });
      return;
    }

    // One origin gate for the whole surface. A browser sends Origin on every
    // cross-origin request and on same-origin writes; an absent Origin is a
    // non-browser client, which the Host check has already judged. A page this
    // tower does not answer to gets a 403: no header, and no data either.
    const origin = req.headers.origin;
    const allowOrigin = corsOrigin(origin, hosts);
    if (origin && !allowOrigin) {
      sendJson(res, 403, { ok: false, reason: `origin not allowed: ${origin}` });
      return;
    }
    if (allowOrigin) {
      res.setHeader('access-control-allow-origin', allowOrigin);
      // The answer differs by origin, so a shared cache must not reuse one
      // origin's response for another.
      res.setHeader('vary', 'Origin');
    }

    // The preflight the page's POSTs trigger: a cross-origin JSON body is never
    // a simple request, so the browser asks first. One answer covers both write
    // paths: it is about the method and the headers, not the path. Only a
    // request that carries an allowed Origin is answered: a preflight without
    // one is not a browser asking permission, and falls through to the method
    // check like any other unsupported verb.
    if (req.method === 'OPTIONS' && allowOrigin) {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, accept',
        'access-control-max-age': String(CORS_MAX_AGE),
      });
      res.end();
      return;
    }

    const soft = (err) => sendJson(res, 500, { ok: false, reason: err.message });
    if (req.method === 'POST' && pathname === '/api/intake') {
      intake(req, res).catch(soft);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/issues/status') {
      moveStatus(req, res).catch(soft);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, reason: `method not allowed: ${req.method}` });
      return;
    }

    if (pathname === '/api/repos') return sendJson(res, 200, roster({ fresh }));
    if (pathname === '/api/board') return sendJson(res, 200, board({ fresh }));
    if (pathname === '/api/sessions') return sendJson(res, 200, sessions());
    if (pathname === '/api/health') return sendJson(res, 200, healthPayload());
    if (pathname === '/api/telemetry') return sendJson(res, 200, telemetry());
    if (pathname === '/api/brief') return sendJson(res, 200, brief());

    const drill = pathname.match(/^\/api\/telemetry\/(.+)$/);
    if (drill) {
      // A malformed percent escape throws; it is simply not a session id.
      let id = drill[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        id = drill[1];
      }
      const found = telemetry().sessions.find((s) => s.id === id);
      if (!found) return sendJson(res, 404, { ok: false, reason: `no such session: ${id}` });
      return sendJson(res, 200, found);
    }

    return sendJson(res, 404, { ok: false, reason: `no such endpoint: ${pathname}` });
  };

  // A bug in a lib is a 500 on the request that met it, never the end of this
  // process (issue #202): the sweep hit a payload shape it did not expect, the
  // throw ended the API, and tower/start.sh took the dashboard down with it -
  // the whole site vanished the moment the board asked for data. One line on
  // the machine, one sentence to the caller, and the listener is still up.
  return http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      const reason = String((err && err.message) || err);
      log.error(`${req.method} ${req.url} failed: ${reason}`);
      if (res.headersSent) res.end();
      else sendJson(res, 500, { ok: false, reason });
    }
  });
};

module.exports = {
  createServer,
  validateIntake,
  validateMove,
  MOVE_STATUSES,
  urlFrom,
  hostnameOf,
  allowedHosts,
  DEFAULT_PORT,
  DEFAULT_BIND,
  TITLE_MAX,
  BODY_MAX,
  DEFAULT_BODY,
  MAX_REQUEST_BYTES,
};

if (require.main === module) {
  const port = Number(process.env.TOWER_PORT) || DEFAULT_PORT;
  const bind = process.env.TOWER_BIND || DEFAULT_BIND;
  createServer().listen(port, bind, () => {
    log.ok(`listening on http://${bind}:${port}`);
  });
}
