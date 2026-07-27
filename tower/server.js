#!/usr/bin/env node
//
// The tower's server — one plain-Node process, zero dependencies.
//
// Every endpoint is a thin wrapper over a lib under tower/lib: the server owns
// routing, caching and validation, and nothing else. It is a VIEW, so the only
// write path in the whole surface is `POST /api/intake`, and that writes
// through the same door everyone else uses — `gh issue create`.
//
// Binding is 127.0.0.1 on purpose. The phone reaches the tower through
// `tailscale serve`, which proxies to localhost, so there is never a second
// listener to authenticate. Nothing here checks a credential because nothing
// here is reachable without one at the Tailscale layer.
//
// What the bind cannot cover is a browser: any page can resolve a name it owns
// to 127.0.0.1 and reach a localhost listener, so the Host header is checked
// against an allowlist on EVERY request, and the intake POST additionally
// checks Origin when the browser sends one. Because `tailscale serve` proxies
// under the tailnet hostname, that hostname belongs in `TOWER_ALLOW_HOST`
// (comma-separated) or `opts.allowHosts` — otherwise the phone sees a 403.
//
// Caching is in memory and time based, matching the poll rates the page uses:
// the roster and the board are expensive (a disk walk, a GraphQL round trip)
// and change slowly; sessions and health are cheap and change constantly.
//
// Every `opts` key passes straight through to the libs, which is what lets the
// test suite run the WHOLE server against fixture directories and a fake exec.
//
// Usage:
//   node tower/server.js                    // TOWER_PORT, default 8693
//   createServer({ root, exec }).listen(0);  // offline, against fixtures
//

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { discoverRepos } = require('./lib/repos');
const { fetchBoard } = require('./lib/board');
const { listSessions } = require('./lib/sessions');
const { repoHealth } = require('./lib/health');

// TOWER on a phone keypad is 86937; 8693 is what fits a port.
const DEFAULT_PORT = 8693;
const DEFAULT_BIND = '127.0.0.1';

const PAGE = path.join(__dirname, 'public', 'index.html');

// The roster is a disk walk and the board a network round trip; both change on
// a human timescale. Sessions and health are local reads the page polls at 10s.
const ROSTER_TTL = 60 * 1000;
const BOARD_TTL = 60 * 1000;
const LIVE_TTL = 5 * 1000;

const TITLE_MAX = 256;
const BODY_MAX = 4000;
const DEFAULT_BODY = 'Filed from the tower.';

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
 * A FAILURE is never stored. `gh` being briefly unauthenticated, or a disk walk
 * that threw, would otherwise pin its own error in front of every read for the
 * whole TTL — the tower would stay broken for a minute after the machine was
 * fine again. Only an answer worth keeping takes the slot; everything else is
 * returned to this one caller and asked again next time.
 *
 * `fresh` bypasses the slot and repopulates it — the page's manual refresh
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

/** The hostname in a Host header or an Origin URL, port and brackets stripped. */
const hostnameOf = (value) => {
  if (!value) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
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
 * What the intake endpoint may do, or why it may not.
 *
 * `repo` is checked against the CURRENT roster rather than pattern matched. The
 * endpoint hands its argument to `gh`, and the roster is the only list of names
 * this machine has agreed to file against; a shape test would accept every
 * other well-formed slug on GitHub.
 *
 * @param {object} payload
 * @param {string[]} slugs the roster's slugs
 * @returns {{ok: boolean, reason?: string, repo?: string, title?: string, body?: string}}
 */
const validateIntake = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };
  const repo = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!slugs.includes(repo)) return { ok: false, reason: `unknown repo: ${repo || '(none)'}` };
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > TITLE_MAX) return { ok: false, reason: `title is longer than ${TITLE_MAX} characters` };
  if (body.length > BODY_MAX) return { ok: false, reason: `body is longer than ${BODY_MAX} characters` };
  return { ok: true, repo, title, body: body || DEFAULT_BODY };
};

/** The URL `gh issue create` prints, from output that may carry other lines. */
const urlFrom = (stdout) => {
  const match = String(stdout || '').match(/https:\/\/\S+/);
  return match ? match[0] : null;
};

/**
 * The tower server.
 * @param {object} [opts]
 * @param {string} [opts.root] the Repositories root to walk
 * @param {string} [opts.workflowHome] the user's ~/.workkit
 * @param {string} [opts.markerDir] the keep-awake marker directory
 * @param {string} [opts.stateDir] the statusline cache directory
 * @param {string} [opts.home] overrides ~ for the libs that resolve it
 * @param {number} [opts.idleMinutes] the working/idle threshold
 * @param {string[]} [opts.allowHosts] extra hostnames this tower answers to
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git/gh/ps seam
 * @returns {import('http').Server}
 */
const createServer = (opts = {}) => {
  const exec = opts.exec || defaultExec;
  const seam = { exec };
  const hosts = allowedHosts(opts.allowHosts);

  // A failed walk answers null, which the cache refuses to store — distinct
  // from a walk that ran and found nothing, which is a real empty roster and
  // caches like any other answer. Callers see [] either way.
  const rosterOrNull = cached(ROSTER_TTL, () => {
    try {
      return discoverRepos({
        root: opts.root,
        workflowHome: opts.workflowHome,
        home: opts.home,
        exec,
      });
    } catch {
      return null;
    }
  }, (value) => value !== null);
  const roster = (o) => rosterOrNull(o) || [];

  const board = cached(BOARD_TTL, () => fetchBoard(roster(), seam));
  const sessions = cached(LIVE_TTL, () => listSessions({
    markerDir: opts.markerDir,
    home: opts.home,
    stateDir: opts.stateDir,
    idleMinutes: opts.idleMinutes,
    exec,
  }));
  const health = cached(LIVE_TTL, () => {
    const out = {};
    for (const repo of roster()) out[repo.path] = repoHealth(repo.path, seam);
    return out;
  });

  const intake = async (req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      // Browsers send Origin on a same-origin POST, so the page's own origin is
      // covered by the same allowlist. An absent Origin is a non-browser client
      // (curl), which the Host check has already judged.
      const name = hostnameOf(origin);
      if (!name || !hosts.has(name)) {
        sendJson(res, 403, { ok: false, reason: `origin not allowed: ${origin}` });
        return;
      }
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      // The answer goes out first; an over-cap request still has bytes in
      // flight, and the connection closes only once the client has been told.
      sendJson(res, err.tooLarge ? 413 : 400, { ok: false, reason: `unreadable body: ${err.message}` });
      if (err.tooLarge) res.on('finish', () => req.destroy());
      return;
    }

    const slugs = roster().map((r) => r.slug).filter(Boolean);
    const checked = validateIntake(payload, slugs);
    if (!checked.ok) {
      sendJson(res, 400, checked);
      return;
    }

    let stdout;
    try {
      stdout = exec('gh', [
        'issue', 'create',
        '--repo', checked.repo,
        '--title', checked.title,
        '--body', checked.body,
        '--label', 'status:inbox',
        '--label', 'type:idea',
      ]);
    } catch (err) {
      // gh being absent, unauthenticated, or offline is an expected condition
      // for a tower on a phone — the page renders the reason, not an error page.
      const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
      sendJson(res, 200, { ok: false, reason: `gh issue create failed: ${detail}` });
      return;
    }

    const url = urlFrom(stdout);
    if (!url) {
      sendJson(res, 200, { ok: false, reason: 'gh issue create printed no issue URL' });
      return;
    }
    sendJson(res, 200, { ok: true, url });
  };

  return http.createServer((req, res) => {
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

    if (req.method === 'POST' && pathname === '/api/intake') {
      intake(req, res).catch((err) => sendJson(res, 500, { ok: false, reason: err.message }));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, reason: `method not allowed: ${req.method}` });
      return;
    }

    if (pathname === '/') {
      let page;
      try {
        page = fs.readFileSync(PAGE);
      } catch (err) {
        // The page ships with the server. Missing means a broken checkout, not
        // a condition the tower is meant to degrade around.
        sendJson(res, 500, { ok: false, reason: `page unavailable: ${err.message}` });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': page.length,
        'cache-control': 'no-store',
      });
      res.end(page);
      return;
    }

    if (pathname === '/api/repos') return sendJson(res, 200, roster({ fresh }));
    if (pathname === '/api/board') return sendJson(res, 200, board({ fresh }));
    if (pathname === '/api/sessions') return sendJson(res, 200, sessions());
    if (pathname === '/api/health') return sendJson(res, 200, health());

    return sendJson(res, 404, { ok: false, reason: `no such endpoint: ${pathname}` });
  });
};

module.exports = {
  createServer,
  validateIntake,
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
    // eslint-disable-next-line no-console
    console.log(`tower listening on http://${bind}:${port}`);
  });
}
