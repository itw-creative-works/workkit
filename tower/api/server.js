#!/usr/bin/env node
//
// The tower's API — one plain-Node process, zero dependencies.
//
// It serves JSON and nothing else: the dashboard is the OMEGA app under
// tower/app, served by its own dev server, and it reads this API cross-origin.
// Anything outside /api/* here is a 404.
//
// Every endpoint is a thin wrapper over a lib under tower/api/lib: the server
// owns routing, caching and validation, and nothing else. It is a VIEW, so the
// whole surface has exactly two write paths — `POST /api/intake`, which files an
// issue, and `POST /api/issues/status`, which moves one along the pipeline — and
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
// (comma-separated) or `opts.allowHosts` — otherwise the phone sees a 403.
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
// Every `opts` key passes straight through to the libs, which is what lets the
// test suite run the WHOLE server against fixture directories and a fake exec.
//
// Usage:
//   node tower/api/server.js                // TOWER_PORT, default 8693
//   createServer({ root, exec }).listen(0);  // offline, against fixtures
//

const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const { discoverRepos } = require('./lib/repos');
const { fetchBoard, LABELS_FILE } = require('./lib/board');
const { listSessions } = require('./lib/sessions');
const { repoHealth } = require('./lib/health');
const { collectTelemetry } = require('./lib/telemetry');
const { buildBrief } = require('./lib/brief');
const { briefSummaries } = require('./lib/summaries');
const { briefHistory } = require('./lib/history');

// TOWER on a phone keypad is 86937; 8693 is what fits a port.
const DEFAULT_PORT = 8693;
const DEFAULT_BIND = '127.0.0.1';

// How long a browser may keep a preflight answer. The allowlist changes only
// when the process restarts, so ten minutes costs nothing and saves the page a
// round trip before every intake POST.
const CORS_MAX_AGE = 600;

// The roster is a disk read and the board a network round trip; both change on
// a human timescale. Sessions and health are local reads the page polls at 10s.
const ROSTER_TTL = 60 * 1000;
const BOARD_TTL = 60 * 1000;
const LIVE_TTL = 5 * 1000;

const TITLE_MAX = 256;
const BODY_MAX = 4000;
const DEFAULT_BODY = 'Filed from the tower.';

// The statuses an issue may be moved between, read from the label SSOT rather
// than restated — the same file the sweep parses its vocabulary from. A require,
// so a tower whose vocabulary file is unreadable says so at start instead of
// refusing every move at runtime for a reason nobody can see.
const MOVE_STATUSES = Object.keys(require(LABELS_FILE).groups.status.values);

// `owner/name` and nothing else. It is only the first gate — the slug still has
// to be one the roster holds — but it is what keeps a value that is not even
// shaped like a repository from reaching the roster comparison at all.
const SLUG_SHAPE = /^[\w.-]+\/[\w.-]+$/;

// An intake payload is a title and a paragraph. Anything larger is not one, and
// reading it would let a single request hold memory the tower has no use for.
const MAX_REQUEST_BYTES = 64 * 1024;

// The names a request may arrive under before the allowlist is extended.
// The IPv6 loopback is listed BRACKETED: hostnameOf parses through new URL,
// which rejects a bare `::1` but resolves `[::1]` to the form requests carry.
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

// The checkout this process is RUNNING FROM — two levels up from tower/api.
// A node process holds the code it started with, so a tower left running past
// a pull serves endpoints that no longer match the repo (issue #64 was exactly
// that). Comparing this checkout's HEAD against the one captured at boot is
// what lets the page say so.
const CHECKOUT = path.join(__dirname, '..', '..');

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

/**
 * The hostname in a Host header or an Origin URL, port and brackets stripped.
 *
 * A value carrying `@` is REFUSED outright rather than parsed. URL parsing
 * reads everything before an `@` as userinfo and drops it, so `evil.com@
 * localhost` would answer `localhost` and walk straight through an allowlist
 * that has never heard of evil.com. Neither header has a userinfo component to
 * begin with — RFC 7230 gives Host the grammar `host [":" port]` — so a value
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
 * why there is none. Both write paths read a body the same way, so the answer —
 * including the over-cap dance, where the response goes out before the socket
 * closes — is written once.
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
  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  // GitHub owner and repo names are case-insensitive, and a roster slug is
  // whatever case the git remote was written in. The ROSTER's spelling is what
  // gets filed, so `gh` always receives a name this machine actually holds.
  const repo = slugs.find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked || '(none)'}` };
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > TITLE_MAX) return { ok: false, reason: `title is longer than ${TITLE_MAX} characters` };
  if (body.length > BODY_MAX) return { ok: false, reason: `body is longer than ${BODY_MAX} characters` };
  return { ok: true, repo, title, body: body || DEFAULT_BODY };
};

/**
 * What the status endpoint may do, or why it may not.
 *
 * Every field is judged before `gh` is reached, and none of them is trusted for
 * being well formed: the number has to be a positive integer, the slug has to
 * be shaped like one AND be a name the roster holds, and both statuses have to
 * be words the label vocabulary defines. A drag on a page is where these values
 * come from today, which is exactly why none of that is assumed here.
 *
 * The move is `from` → `to` rather than `to` alone because the one-status
 * invariant is what makes it a move: the old label is removed in the same call
 * that adds the new one, so an issue never carries two.
 *
 * @param {object} payload
 * @param {string[]} slugs the roster's slugs
 * @returns {{ok: boolean, reason?: string, repo?: string, number?: number, from?: string, to?: string}}
 */
const validateMove = (payload, slugs) => {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'body must be a JSON object' };

  const number = payload.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return { ok: false, reason: 'issue number must be a positive integer' };
  }

  const asked = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  if (!SLUG_SHAPE.test(asked)) return { ok: false, reason: `not a repository slug: ${asked || '(none)'}` };
  // The ROSTER's spelling is what gets edited, for the reason intake files
  // under it: GitHub names are case-insensitive and a slug is whatever case the
  // git remote was written in.
  const repo = slugs.find((slug) => slug.toLowerCase() === asked.toLowerCase()) || '';
  if (!repo) return { ok: false, reason: `unknown repo: ${asked}` };

  const from = typeof payload.from === 'string' ? payload.from.trim() : '';
  const to = typeof payload.to === 'string' ? payload.to.trim() : '';
  for (const [field, value] of [['from', from], ['to', to]]) {
    if (!MOVE_STATUSES.includes(value)) return { ok: false, reason: `${field} is not a status: ${value || '(none)'}` };
  }
  if (from === to) return { ok: false, reason: `the issue is already status:${to}` };

  return { ok: true, repo, number, from, to };
};

/** The URL `gh issue create` prints, from output that may carry other lines. */
const urlFrom = (stdout) => {
  const match = String(stdout || '').match(/https:\/\/\S+/);
  return match ? match[0] : null;
};

/**
 * The tower server.
 * @param {object} [opts]
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

  // A failed read answers null, which the cache refuses to store — distinct
  // from a read that ran and found nothing, which is a real empty roster and
  // caches like any other answer. Callers see [] either way.
  const rosterOrNull = cached(ROSTER_TTL, () => {
    try {
      return discoverRepos({
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
  // The drill-down reads this same slot rather than sweeping again: one session
  // is a row of the whole answer, and the whole answer was just computed.
  const telemetry = cached(LIVE_TTL, () => collectTelemetry({
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

  // What this PROCESS is, as against what the checkout is now. The boot commit
  // and the start time are captured once, here, because that is the only moment
  // that can honestly answer them; the live head is read like every other live
  // reading. Git being absent, or the checkout not being a repository, answers
  // null on both sides — absence of proof is not staleness.
  const startedAt = new Date().toISOString();
  const headNow = () => {
    try {
      return exec('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD']).trim() || null;
    } catch {
      return null;
    }
  };
  const bootCommit = headNow();
  const currentHead = cached(LIVE_TTL, headNow, (value) => value !== null);

  // The per-repo map with one `meta` block beside it. FLAT rather than nested
  // because every consumer of this endpoint reads a reading by repo path — an
  // absolute path, so it can never be the string `meta` — and nesting would
  // move every one of them. The brief is built from `health()` itself, which
  // stays the map alone.
  const healthPayload = () => ({
    ...health(),
    meta: { bootCommit, startedAt, currentHead: currentHead() },
  });

  // The published summaries the brief names — a GraphQL round trip like the
  // board's, and cached on the board's minute rather than on the live slots'
  // five seconds: a page polling every ten would otherwise ask GitHub for
  // yesterday's summary six times a minute to hear the same answer all day.
  const summaries = cached(BOARD_TTL, () => briefSummaries({
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec,
  }));

  // The brief is assembled from the two slots above rather than from reads of
  // its own, so the morning notification and the Brief page cannot disagree:
  // they are the same board and the same health, one derivation. The summaries
  // attach onto it exactly as the 9am job attaches them (jobs/brief-payload.js),
  // which is what keeps the two payloads one shape.
  // The board over time, read back off the published briefs (issue #55) — a
  // second GraphQL round trip on the same board the summaries come from, and
  // cached on the same minute for the same reason. It is attached rather than
  // built: the history is the mornings BEFORE this one, which no sweep of the
  // live board can answer.
  //
  // A read that failed is null and says nothing on stderr, unlike the 9am job's
  // named skip: this one runs every minute the tower is up, and a line per poll
  // would bury the log it was meant to be visible in. The page draws the null as
  // the sentence it means.
  const history = cached(BOARD_TTL, () => briefHistory({
    workflowHome: opts.workflowHome,
    home: opts.home,
    exec,
  }));

  const brief = () => Object.assign(
    buildBrief(board(), health(), roster()),
    summaries(),
    { history: history() },
  );

  /** The roster's slugs — what both write paths judge a repo against. */
  const slugsNow = () => roster().map((r) => r.slug).filter(Boolean);

  const intake = async (req, res) => {
    const read = await readPayload(req, res);
    if (!read.ok) return;

    const slugs = slugsNow();
    const checked = validateIntake(read.payload, slugs);
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

  // The board's drag, arriving as a write. One `gh issue edit` carries both
  // halves of the move, so the issue is never momentarily unlabelled or
  // momentarily carrying two statuses.
  const moveStatus = async (req, res) => {
    const read = await readPayload(req, res);
    if (!read.ok) return;

    const checked = validateMove(read.payload, slugsNow());
    if (!checked.ok) {
      sendJson(res, 400, checked);
      return;
    }

    try {
      exec('gh', [
        'issue', 'edit', String(checked.number),
        '--repo', checked.repo,
        '--remove-label', `status:${checked.from}`,
        '--add-label', `status:${checked.to}`,
      ]);
    } catch (err) {
      // Soft, like intake's: the page reverts the card and shows this sentence.
      const detail = String(err.stderr || err.message || '').trim().split('\n').pop();
      sendJson(res, 200, { ok: false, reason: `gh issue edit failed: ${detail}` });
      return;
    }

    sendJson(res, 200, {
      ok: true, repo: checked.repo, number: checked.number, status: checked.to,
    });
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

    // One origin gate for the whole surface. A browser sends Origin on every
    // cross-origin request and on same-origin writes; an absent Origin is a
    // non-browser client, which the Host check has already judged. A page this
    // tower does not answer to gets a 403 — no header, and no data either.
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
    // paths — it is about the method and the headers, not the path. Only a
    // request that carries an allowed Origin is answered — a preflight without
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
    // eslint-disable-next-line no-console
    console.log(`tower listening on http://${bind}:${port}`);
  });
}
