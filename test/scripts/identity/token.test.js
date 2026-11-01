// Tests for workflow/identity/token.js: the client that trades the user's
// sign-in for the bot's token at the hosted token service, and caches it per
// repo. Real files in scratch folders; the module's seam is `fetch`, a recording
// fake answering the service, and the command form runs against a local stand-in.
// The sign-in on its own is `tokenWithSignIn` with injected `atKeyboard` and
// `signIn`, and the command form at a keyboard runs under `script`'s terminal.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const {
  INSTALL_FIX, PRESELECTED, BOT_HINT, UNREADABLE, deviceFlowRoutes, repoRoute, userRoute, writeLogin, readWrittenLogin, useTokenService, collector, json, failureOf, startServer,
  startService, scratchKit, scratchEnv, hostsOf, PTY, atTerminal,
} = require('../../lib/identity');

const MODULE = path.join(__dirname, '..', '..', '..', 'workflow', 'identity', 'token.js');
const INSTALL_PAGE_JS = path.join(__dirname, '..', '..', '..', 'workflow', 'identity', 'install-page.js');

// Required per case, so a module not yet built fails each case by name.
const load = () => require(MODULE);

const REPO = 'acme/widgets';
// A fixed clock, in epoch milliseconds, so the cache's expiry math is exact.
const NOW = 1700000000000;
const MINUTE = 60 * 1000;
const TOKEN_URL = 'https://tokens.example.test/token';
const SETTINGS = { identity: { tokenUrl: TOKEN_URL } };
const USER_TOKEN = 'ghu_signedinuser';

// A rename: the remote spells Old/widgets, GitHub's canonical name is New/widgets.
const OLD = 'Old/widgets';
const NEW = 'New/widgets';
const REFUSED_412 = { status: 412, body: { error: 'not installed', fix: INSTALL_FIX } };
const GRANTED = { status: 200, body: JSON.stringify({ token: 'ghs_canonical', expires_at: '2099-01-01T00:00:00Z' }) };
const DENIED = { status: 412, body: JSON.stringify(REFUSED_412.body) };

/** One stand-in as service and GitHub: GitHub names Old/widgets New/widgets (owner id 7), New/widgets gets `newAnswer`, Old/widgets a 412. */
const renamedService = (newAnswer) => startServer([
  { method: 'POST', url: '/token', whenBody: { repo: OLD }, ...DENIED },
  { method: 'POST', url: '/token', whenBody: { repo: NEW }, ...newAnswer },
  repoRoute(OLD, NEW, 7),
], mkTmp('wk-identity-service-'));

/** One stand-in as service and GitHub: acme/widgets 412s, its repo read is a 404 (private, no install), the user read gives id 7. */
const privateRepoService = () => startServer([
  { method: 'POST', url: '/token', ...DENIED },
  { method: 'GET', url: `/repos/${REPO}`, status: 404, body: JSON.stringify({ message: 'Not Found' }) },
  userRoute('acme', 7),
], mkTmp('wk-identity-service-'));

/** The repos a stand-in's `POST /token` requests named, in order. */
const postedRepos = (server) => server.requests().filter((r) => r.method === 'POST' && r.url === '/token').map((r) => JSON.parse(r.body).repo);

/** The public `GET /users/<owner>` reads a stand-in got. */
const userReads = (server) => server.requests().filter((r) => r.method === 'GET' && r.url.startsWith('/users/'));

/** `text`'s lines, trimmed. */
const linesOf = (text) => text.split('\n').map((l) => l.trim());

/** A scratch home signed in as octocat; returns the login file. */
const signedIn = () => writeLogin(mkTmp('wk-identity-login-'), { token: USER_TOKEN, login: 'octocat' });

// GitHub as a stand-in, finishing a device flow at once as hubot.
const KEYBOARD_FLOW = deviceFlowRoutes({ userCode: 'TERM-1NAL', accessToken: 'ghu_fromkeyboard', login: 'hubot' });

/**
 * A `signIn` that writes `<home>`'s login file holding `token`, counting its
 * runs; `said()` is what `out`'s collector held when it first ran.
 */
const recordingSignIn = (home, token, out) => {
  let runs = 0;
  let said = null;
  const fn = async () => {
    runs += 1;
    if (said === null && out) said = out.text();
    writeLogin(home, { token, login: 'octocat' });
    return { token, login: 'octocat' };
  };
  return { fn, runs: () => runs, said: () => said };
};

/**
 * A fetch answering each `POST <TOKEN_URL>` with the next of `grants`, recording
 * each call: `[token, expiresAt]` is a grant, `{ status, body }` a refusal. A
 * `GET .../repos/<owner>/<repo>` or `GET .../users/<owner>` is GitHub's, recorded
 * in `reads` and answered from `repos[<owner>/<repo>]` or `users[<owner>]`: an
 * Error is thrown, `{ status, body }` answered as given, any other object a 200
 * holding it, none a 404.
 */
const fakeService = (grants, repos = {}, users = {}) => {
  const posts = [];
  const reads = [];
  const others = [];
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method || 'GET').toUpperCase();
    if (url === TOKEN_URL && method === 'POST') {
      posts.push({ headers: new Headers(init.headers), body: String(init.body) });
      const grant = grants[posts.length - 1] || ['ghs_unscripted', '2099-01-01T00:00:00Z'];
      if (!Array.isArray(grant)) return json(grant.status, grant.body);
      const [token, expiresAt] = grant;
      return json(200, { token, expires_at: expiresAt });
    }
    const repo = method === 'GET' ? url.match(/\/repos\/([^/]+\/[^/]+)$/) : null;
    const user = method === 'GET' ? url.match(/\/users\/([^/]+)$/) : null;
    if (repo || user) {
      reads.push({ url, headers: new Headers(init.headers) });
      const answer = repo ? repos[repo[1]] : users[user[1]];
      if (answer instanceof Error) throw answer;
      if (!answer) return json(404, { message: 'Not Found' });
      return 'status' in answer ? json(answer.status, answer.body) : json(200, answer);
    }
    others.push(`${method} ${url}`);
    return json(599, { error: `fake fetch has no route for ${method} ${url}` });
  };
  return {
    fetch, posts, reads, others,
  };
};

/**
 * A scratch kit and a scratch home for its settings, login and cache; `command`
 * runs the copy's token.js with that home.
 */
const tokenKit = () => {
  const kit = scratchKit();
  const home = mkTmp('wk-identity-kit-home-');
  const tokenJs = path.join(kit, 'workflow', 'identity', 'token.js');
  const command = (args, extra = {}) => spawnSync(process.execPath, [tokenJs, ...args],
    { env: scratchEnv(home, extra), encoding: 'utf8', timeout: SPAWN_DEADLINE });
  const atKeyboard = (args, extra = {}) => atTerminal([process.execPath, tokenJs, ...args], { env: scratchEnv(home, extra), dir: home });
  return {
    kit, home, command, atKeyboard,
  };
};

const cases = async () => {
  group('identity/token: the cache');

  await test('case 11: tokenFor mints through POST <tokenUrl> with the bearer and { repo }, reuses within the hour, mints again under five minutes; no expiresAt is a miss', async () => {
    const { tokenFor } = load();
    const cacheDir = mkTmp('wk-identity-cache-');
    const loginFile = signedIn();
    const service = fakeService([
      ['ghs_first', '2023-11-14T23:13:20Z'],
      ['ghs_second', '2023-11-15T00:09:20Z'],
    ]);
    const opts = (now) => ({
      settings: SETTINGS, fetch: service.fetch, now, cacheDir, loginFile,
    });
    const cacheFile = path.join(cacheDir, 'acme--widgets.json');

    assertEq(await tokenFor(REPO, opts(NOW)), 'ghs_first', 'the minted token');
    assertEq(service.posts.length, 1, `one mint, other calls: ${service.others.join(', ')}`);
    assertEq(service.posts[0].headers.get('authorization'), `Bearer ${USER_TOKEN}`, 'the login\'s bearer');
    assertEq(JSON.stringify(JSON.parse(service.posts[0].body)), JSON.stringify({ repo: 'acme/widgets' }), 'the body names the repo');
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    assertEq(cached.token, 'ghs_first', 'the cache holds the token');
    assertEq(cached.expiresAt, '2023-11-14T23:13:20Z', 'and its expiry');

    assertEq(await tokenFor(REPO, opts(NOW + 30 * MINUTE)), 'ghs_first', 'the cached token');
    assertEq(service.posts.length, 1, 'no mint while the cache has 30 minutes left');

    assertEq(await tokenFor(REPO, opts(NOW + 56 * MINUTE)), 'ghs_second', 'a fresh token');
    assertEq(service.posts.length, 2, 'a mint with 4 minutes left');
    assertEq(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).token, 'ghs_second', 'the cache holds the fresh token');

    const staleDir = mkTmp('wk-identity-cache-');
    fs.writeFileSync(path.join(staleDir, 'acme--widgets.json'), JSON.stringify({ token: 'ghs_stale' }), { mode: 0o600 });
    const stale = fakeService([['ghs_fresh', '2023-11-14T23:13:20Z']]);
    assertEq(await tokenFor(REPO, {
      settings: SETTINGS, fetch: stale.fetch, now: NOW, cacheDir: staleDir, loginFile,
    }), 'ghs_fresh', 'no expiresAt: a fresh token');
    assertEq(stale.posts.length, 1, 'one mint');
    assertEq(JSON.parse(fs.readFileSync(path.join(staleDir, 'acme--widgets.json'), 'utf8')).expiresAt,
      '2023-11-14T23:13:20Z', 'the cache rewritten whole');
  });

  await testUnless(IS_WINDOWS, 'Windows keeps no POSIX permission bits to read 0600 back from')(
    'case 11 (POSIX): tokenFor writes the cache file with mode 0600', async () => {
      const cacheDir = mkTmp('wk-identity-cache-');
      const { fetch } = fakeService([['ghs_first', '2023-11-14T23:13:20Z']]);
      await load().tokenFor(REPO, {
        settings: SETTINGS, fetch, now: NOW, cacheDir, loginFile: signedIn(),
      });
      const mode = fs.statSync(path.join(cacheDir, 'acme--widgets.json')).mode & 0o777;
      assertEq(mode.toString(8), '600', 'owner read and write only');
    },
  );

  group('identity/token: the refusals');

  await test('case 12: no login file, not at a keyboard, is not_signed_in; the command exits 3 naming workkit setup --login, with no request made', async () => {
    const { tokenFor, IdentityError } = load();
    const service = fakeService([]);
    const absent = path.join(mkTmp('wk-identity-nologin-'), '.workkit', 'identity', 'login.json');
    const err = await failureOf(() => tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: absent,
    }));
    assert(err instanceof IdentityError, `an IdentityError, got: ${err.name}: ${err.message}`);
    assertEq(err.code, 'not_signed_in', 'the code');
    assertEq(service.posts.length + service.others.length, 0, 'no request made');

    // One stand-in is both the service and GitHub, so a sign-in started away
    // from a keyboard would show as a device-code request.
    const { home, command } = tokenKit();
    const server = await startServer([
      { method: 'POST', url: '/token', status: 200, body: JSON.stringify({ token: 'ghs_never', expires_at: '2099-01-01T00:00:00Z' }) },
      ...KEYBOARD_FLOW,
    ], mkTmp('wk-identity-service-'));
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([REPO], hostsOf(server));
      assertEq(res.status, 3, `exit 3, stderr: ${res.stderr}`);
      assert(res.stderr.includes('workkit setup --login'), `stderr names workkit setup --login, got: ${res.stderr}`);
      assert(!res.stderr.includes('workkit login'), `and no longer workkit login, got: ${res.stderr}`);
      assertEq(res.stdout, '', 'no token on stdout');
      assertEq(server.requests().length, 0, `no device-code request and no service request, got: ${JSON.stringify(server.requests())}`);
    } finally {
      await server.close();
    }
  });

  await test('case 12: not signed in, for no login file and for the service\'s 401: exit 3 naming workkit setup --login', async () => {
    const { home, command } = tokenKit();
    useTokenService(home, TOKEN_URL);
    const bare = command([REPO]);
    assertEq(bare.status, 3, `no login file: exit 3, stderr: ${bare.stderr}`);
    assert(bare.stderr.includes('workkit setup --login'), `no login file: stderr names workkit setup --login, got: ${bare.stderr}`);

    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await startService(401, { error: 'not signed in', fix: 'run workkit setup --login' });
    try {
      useTokenService(home, `${server.url}/token`);
      const refused = command([REPO], hostsOf(server));
      assertEq(refused.status, 3, `401: exit 3, stderr: ${refused.stderr}`);
      assert(refused.stderr.includes('workkit setup --login'), `401: stderr names workkit setup --login, got: ${refused.stderr}`);
      assertEq(`${bare.stdout}${refused.stdout}`, '', 'no token on stdout');
    } finally {
      await server.close();
    }
  });

  await test('case 12a: no login file at a keyboard: tokenWithSignIn says why on out, signs in once and hands on the token; away from one it never signs in', async () => {
    const { tokenWithSignIn, IdentityError } = load();
    const home = mkTmp('wk-identity-signin-');
    const loginFile = path.join(home, '.workkit', 'identity', 'login.json');
    const told = collector();
    const signIn = recordingSignIn(home, 'ghu_freshsignin', told);
    const service = fakeService([['ghs_aftersignin', '2023-11-14T23:13:20Z']]);
    const token = await tokenWithSignIn(REPO, {
      atKeyboard: () => true, signIn: signIn.fn, out: told.out, settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile,
    });
    assertEq(token, 'ghs_aftersignin', 'the token comes back');
    assertEq(signIn.runs(), 1, 'the sign-in ran once');
    const before = signIn.said();
    assert(before.includes(`not signed in to workkit (no ${loginFile}); run \`workkit setup --login\``),
      `out carries the refusal's message before the sign-in, got: ${JSON.stringify(before)}`);
    assert(before.includes('signing in now'), `and signing in now, got: ${JSON.stringify(before)}`);
    assert(before.indexOf('not signed in to workkit') < before.indexOf('signing in now'), `the reason first, got: ${JSON.stringify(before)}`);
    assertEq(service.posts.length, 1, `one service call, other calls: ${service.others.join(', ')}`);
    assertEq(service.posts[0].headers.get('authorization'), 'Bearer ghu_freshsignin', 'carrying the new sign-in\'s bearer');

    const awayOut = collector();
    const away = recordingSignIn(mkTmp('wk-identity-signin-'), 'ghu_never');
    const quiet = fakeService([]);
    const err = await failureOf(() => tokenWithSignIn(REPO, {
      atKeyboard: () => false,
      signIn: away.fn,
      out: awayOut.out,
      settings: SETTINGS,
      fetch: quiet.fetch,
      now: NOW,
      cacheDir: mkTmp('wk-identity-cache-'),
      loginFile: path.join(mkTmp('wk-identity-nologin-'), '.workkit', 'identity', 'login.json'),
    }));
    assert(err instanceof IdentityError, `away from a keyboard: an IdentityError, got: ${err.name}: ${err.message}`);
    assertEq(err.code, 'not_signed_in', 'away from a keyboard: not_signed_in');
    assertEq(away.runs(), 0, 'away from a keyboard: no sign-in');
    assertEq(quiet.posts.length + quiet.others.length, 0, 'away from a keyboard: no request made');
    assertEq(awayOut.text(), '', 'away from a keyboard: out is left to the caller, which prints the refusal once');
  });

  await testUnless(!PTY, 'no `script` here to hand the command a terminal')(
    'case 12a: the command at a keyboard with no login file says why, runs the device flow on stderr, writes the login, and prints only the token on stdout', async () => {
      const { home, atKeyboard } = tokenKit();
      const server = await startServer([
        ...KEYBOARD_FLOW,
        { method: 'POST', url: '/token', status: 200, body: JSON.stringify({ token: 'ghs_fromkeyboard', expires_at: '2099-01-01T00:00:00Z' }) },
      ], mkTmp('wk-identity-service-'));
      try {
        useTokenService(home, `${server.url}/token`);
        const res = atKeyboard([REPO], hostsOf(server));
        assertEq(res.status, 0, `exit 0, terminal: ${res.terminal}`);
        assertEq(res.stdout, 'ghs_fromkeyboard\n', 'stdout is the token alone');
        assert(res.terminal.includes('TERM-1NAL'), `the user code reaches the terminal, got: ${res.terminal}`);
        const reason = res.terminal.indexOf('not signed in to workkit');
        const now = res.terminal.indexOf('signing in now');
        const page = res.terminal.indexOf('Open https://github.com/login/device');
        assert(reason >= 0 && now > reason && page > now, `the not-signed-in line, then signing in now, then Open the page, got: ${res.terminal}`);
        assertEq(JSON.stringify(readWrittenLogin(home)), JSON.stringify({ token: 'ghu_fromkeyboard', login: 'hubot' }), 'the login file is written');
        const device = server.requests().filter((r) => r.method === 'POST' && r.url === '/login/device/code');
        assertEq(device.length, 1, `one device-code request, got: ${JSON.stringify(server.requests())}`);
        const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        assertEq(posts.length, 1, `one service request, got: ${JSON.stringify(server.requests())}`);
        assertEq(posts[0].auth, 'Bearer ghu_fromkeyboard', 'carrying the new sign-in\'s bearer');
      } finally {
        await server.close();
      }
    },
  );

  await test('case 12b: a 401 at a keyboard is one sign-in and one retry; a second 401 is not_signed_in; away from a keyboard there is no sign-in', async () => {
    const { tokenWithSignIn, IdentityError } = load();
    const REFUSED = { status: 401, body: { error: 'not signed in', fix: 'run workkit setup --login' } };
    const attempt = async (grants, keyboard) => {
      const home = mkTmp('wk-identity-signin-');
      const loginFile = writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
      const told = collector();
      const signIn = recordingSignIn(home, 'ghu_resignedin', told);
      const service = fakeService(grants);
      let token;
      let err;
      try {
        token = await tokenWithSignIn(REPO, {
          atKeyboard: () => keyboard, signIn: signIn.fn, out: told.out, settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile,
        });
      } catch (caught) {
        err = caught;
      }
      return {
        token, err, runs: signIn.runs(), posts: service.posts, before: signIn.said(),
      };
    };

    const retried = await attempt([REFUSED, ['ghs_onretry', '2023-11-14T23:13:20Z']], true);
    assertEq(retried.err, undefined, `401 then 200: no error, got: ${retried.err && retried.err.message}`);
    assertEq(retried.token, 'ghs_onretry', '401 then 200: the retry\'s token');
    assertEq(retried.runs, 1, '401 then 200: one sign-in');
    assertEq(retried.posts.length, 2, '401 then 200: two service calls');
    assertEq(retried.posts[0].headers.get('authorization'), `Bearer ${USER_TOKEN}`, 'the first call carries the old bearer');
    assertEq(retried.posts[1].headers.get('authorization'), 'Bearer ghu_resignedin', 'the retry carries the new one');
    assert(retried.before.includes('not signed in: run `workkit setup --login`') &&retried.before.includes('signing in now'),
      `401 then 200: out carries the refusal's message and signing in now before the sign-in, got: ${JSON.stringify(retried.before)}`);

    const twice = await attempt([REFUSED, REFUSED], true);
    assert(twice.err instanceof IdentityError, `401 then 401: an IdentityError, got: ${twice.err}`);
    assertEq(twice.err.code, 'not_signed_in', '401 then 401: not_signed_in');
    assertEq(twice.runs, 1, '401 then 401: the sign-in ran once');
    assertEq(twice.posts.length, 2, '401 then 401: two service calls, no third');

    const away = await attempt([REFUSED, ['ghs_never', '2023-11-14T23:13:20Z']], false);
    assert(away.err instanceof IdentityError, `away, 401: an IdentityError, got: ${away.err}`);
    assertEq(away.err.code, 'not_signed_in', 'away, 401: not_signed_in');
    assertEq(away.runs, 0, 'away, 401: the sign-in never ran');
    assertEq(away.posts.length, 1, 'away, 401: one service call');

    const notInstalled = await attempt([{ status: 412, body: { error: 'not installed', fix: INSTALL_FIX } }], true);
    assert(notInstalled.err instanceof IdentityError, `412 at a keyboard: an IdentityError, got: ${notInstalled.err}`);
    assertEq(notInstalled.err.code, 'not_installed', '412 at a keyboard: not_installed');
    assertEq(notInstalled.runs, 0, '412 at a keyboard: a refusal other than not_signed_in never signs in');
  });

  await test('case 13: the service\'s 401 exits 3 naming workkit setup --login, 412 exits 4 naming the owner, 403 exits 1 naming no write access, 500 exits 1 with its message', async () => {
    const answers = [
      [401, { error: 'not signed in', fix: 'run workkit setup --login' }, 3, /workkit setup --login/],
      [412, { error: 'not installed', fix: INSTALL_FIX }, 4, /install workkit-agent\[bot\] on acme/],
      [403, { error: 'no write access', fix: 'ask an acme admin for write access to acme/widgets' }, 1, /no write access/i],
      [500, { error: 'github refused: Server Error from the stand-in', fix: 'try again shortly' }, 1, /Server Error from the stand-in/],
    ];
    for (const [status, body, exit, pattern] of answers) {
      const { home, command } = tokenKit();
      writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
      const server = await startService(status, body);
      try {
        useTokenService(home, `${server.url}/token`);
        // The stand-in is GitHub too: away from a keyboard, a 401 starts no sign-in.
        const res = command([REPO], hostsOf(server));
        assertEq(res.status, exit, `${status}: exit ${exit}, stderr: ${res.stderr}`);
        assert(pattern.test(res.stderr), `${status}: stderr matches ${pattern}, got: ${res.stderr}`);
        assert(!res.stderr.includes('workkit login'), `${status}: no stderr line names workkit login, got: ${res.stderr}`);
        assertEq(server.requests().filter((r) => r.url === '/login/device/code').length, 0,
          `${status}: no device-code request, got: ${JSON.stringify(server.requests())}`);
        assertEq(res.stdout, '', `${status}: no token on stdout`);
        const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        assertEq(posts.length, 1, `${status}: the one request reached the stand-in, got: ${JSON.stringify(server.requests())}`);
        assertEq(posts[0].auth, `Bearer ${USER_TOKEN}`, `${status}: carrying the login's bearer`);
      } finally {
        await server.close();
      }
    }
  });

  group('identity/token: the owner read before the ask');

  await test('case 1: GitHub names Old/widgets New/widgets and the service 200s New/widgets: the token prints, exit 0, nothing on stderr, one POST, for New/widgets', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await renamedService(GRANTED);
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([OLD], hostsOf(server));
      assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
      assertEq(res.stdout, 'ghs_canonical\n', 'stdout is the canonical repo\'s token');
      assertEq(res.stderr, '', 'nothing on stderr');
      assertEq(JSON.stringify(postedRepos(server)), JSON.stringify([NEW]), `one POST, under the canonical name, none under the old, got: ${JSON.stringify(server.requests())}`);
      const reads = server.requests().filter((r) => r.method === 'GET' && r.url === `/repos/${OLD}`);
      assertEq(reads.length, 1, `GitHub's repo read for the sent slug, got: ${JSON.stringify(server.requests())}`);
      assertEq(reads[0].auth, `Bearer ${USER_TOKEN}`, 'the repo read carries the user\'s sign-in');
    } finally {
      await server.close();
    }
  });

  await test('case 2: renamed, and the service 412s New/widgets: exit 4, the refusal names New and the page pre-selected on id 7, then the --bot line, with no public user read', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await renamedService(DENIED);
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([OLD], hostsOf(server));
      assertEq(res.status, 4, `exit 4, stderr: ${res.stderr}`);
      const lines = linesOf(res.stderr);
      const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on New: ${PRESELECTED}7`));
      assert(at >= 0, `stderr names the canonical owner and its pre-selected page, got: ${res.stderr}`);
      assertEq(lines[at + 1], BOT_HINT, 'the next line is the --bot command');
      assertEq(res.stdout, '', 'no token on stdout');
      assertEq(JSON.stringify(postedRepos(server)), JSON.stringify([NEW]), 'one POST, under the canonical name');
      assertEq(userReads(server).length, 0, `no public user read, got: ${JSON.stringify(server.requests())}`);
    } finally {
      await server.close();
    }
  });

  await test('case 3: the repo read and the public user read both fail (connection refused, a 404, a timeout, a non-integer id) and the service 412s Old/widgets: the unreadable refusal naming Old, no page, no --bot line', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const service = await startService(412, REFUSED_412.body);
    const gone = await startServer([], mkTmp('wk-identity-github-'));
    await gone.close();
    try {
      useTokenService(home, `${service.url}/token`);
      const res = command([OLD], hostsOf(gone));
      assertEq(res.status, 4, `connection refused: exit 4, stderr: ${res.stderr}`);
      assert(linesOf(res.stderr).some((l) => l.endsWith(UNREADABLE)), `connection refused: stderr says the id was unreadable, got: ${res.stderr}`);
      assert(!res.stderr.includes('installations/new'), `connection refused: no install page anywhere, got: ${res.stderr}`);
      assert(!res.stderr.includes(BOT_HINT), `connection refused: no --bot line, got: ${res.stderr}`);
      assertEq(JSON.stringify(postedRepos(service)), JSON.stringify([OLD]), 'connection refused: one POST, under the slug as sent');
    } finally {
      await service.close();
    }

    const { tokenFor } = load();
    const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    for (const [label, repoAnswer, userAnswer] of [
      ['a 404 on each', undefined, undefined],
      ['a timeout on each', timeout(), timeout()],
      ['a non-integer id on each', { full_name: NEW, owner: { login: 'New', id: '7' } }, { login: 'Old', id: '7' }],
    ]) {
      const fake = fakeService([REFUSED_412],
        repoAnswer === undefined ? {} : { [OLD]: repoAnswer },
        userAnswer === undefined ? {} : { Old: userAnswer });
      const err = await failureOf(() => tokenFor(OLD, {
        settings: SETTINGS, fetch: fake.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: signedIn(),
      }));
      assertEq(err.code, 'not_installed', `${label}: not_installed`);
      assert(linesOf(err.message).some((l) => l.endsWith(UNREADABLE)), `${label}: the unreadable line, got: ${err.message}`);
      assert(!err.message.includes('installations/new'), `${label}: no install page, got: ${err.message}`);
      assert(!err.message.includes(BOT_HINT), `${label}: no --bot line, got: ${err.message}`);
      const reads = fake.reads.map((r) => new URL(r.url).pathname);
      assertEq(JSON.stringify(reads), JSON.stringify([`/repos/${OLD}`, '/users/Old']),
        `${label}: the repo read, then the public user read, other calls: ${fake.others.join(', ')}`);
      assertEq(JSON.stringify(fake.posts.map((p) => JSON.parse(p.body).repo)), JSON.stringify([OLD]), `${label}: one POST, under the slug as sent`);
    }
  });

  await test('case 4: no rename, a 412 is one POST and the refusal names the owner and the page built from the repo read\'s id, the read carrying the sign-in', async () => {
    const { tokenFor } = load();
    const service = fakeService([REFUSED_412], { [REPO]: { full_name: REPO, owner: { login: 'acme', id: 4242 } } });
    const err = await failureOf(() => tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: signedIn(),
    }));
    assertEq(err.code, 'not_installed', 'not_installed');
    const lines = linesOf(err.message);
    const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on acme: ${PRESELECTED}4242`));
    assert(at >= 0, `the refusal names acme and its pre-selected page, got: ${err.message}`);
    assertEq(lines[at + 1], BOT_HINT, 'the next line is the --bot command');
    assertEq(service.posts.length, 1, 'one POST');
    assertEq(service.reads.length, 1, `one repo read, other calls: ${service.others.join(', ')}`);
    assertEq(service.reads[0].headers.get('authorization'), `Bearer ${USER_TOKEN}`, 'the read carries the user\'s sign-in');
  });

  await test('case 5: --installation and --probe say installed off the one POST under the canonical slug, not installed otherwise; the probe prints no page and makes no public user read', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    for (const [scene, start, slug, posted, said] of [
      ['renamed, installed', () => renamedService(GRANTED), OLD, NEW, 'installed'],
      ['renamed, not installed', () => renamedService(DENIED), OLD, NEW, 'not installed'],
      ['private, not installed', privateRepoService, REPO, REPO, 'not installed'],
    ]) {
      for (const form of ['--installation', '--probe']) {
        const label = `${scene}, ${form}`;
        const server = await start();
        try {
          useTokenService(home, `${server.url}/token`);
          const res = command([form, slug], hostsOf(server));
          assertEq(res.stdout.trim(), said, `${label}: prints ${said} (stderr: ${res.stderr})`);
          assertEq(res.status, 0, `${label}: exits 0`);
          assertEq(JSON.stringify(postedRepos(server)), JSON.stringify([posted]), `${label}: one POST, for ${posted}`);
          if (form === '--probe') {
            assert(!res.stderr.includes('installations/new'), `${label}: prints no page, got: ${res.stderr}`);
            assertEq(userReads(server).length, 0, `${label}: no public user read, got: ${JSON.stringify(server.requests())}`);
          } else if (scene === 'renamed, not installed') {
            assert(linesOf(res.stderr).some((l) => l.endsWith(`install workkit-agent[bot] on New: ${PRESELECTED}7`)), `${label}: names New's pre-selected page, got: ${res.stderr}`);
          } else if (scene === 'private, not installed') {
            assertEq(userReads(server).length, 1, `${label}: the public user read gives the page's id, got: ${JSON.stringify(server.requests())}`);
          }
        } finally {
          await server.close();
        }
      }
    }
  });

  await test('case 7: installPage builds the page pre-selected on the id it is given', async () => {
    const { installPage } = require(INSTALL_PAGE_JS);
    assertEq(installPage(7), `${PRESELECTED}7`, 'the page pre-selected on id 7');
  });

  await test('case 8: the repo read is a 404 (a private repo, no install, no rename), the service 412s the slug as sent and the public user read answers id 7: one POST, exit 4, the refusal names acme and the page on id 7, then the --bot line', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await privateRepoService();
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([REPO], hostsOf(server));
      assertEq(res.status, 4, `exit 4, stderr: ${res.stderr}`);
      const lines = linesOf(res.stderr);
      const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on acme: ${PRESELECTED}7`));
      assert(at >= 0, `stderr names acme and the page pre-selected on id 7, got: ${res.stderr}`);
      assertEq(lines[at + 1], BOT_HINT, 'the next line is the --bot command');
      assertEq(JSON.stringify(postedRepos(server)), JSON.stringify([REPO]), 'one POST, under the slug as sent');
      const users = userReads(server);
      assertEq(users.length, 1, `the public user read was made, got: ${JSON.stringify(server.requests())}`);
      assertEq(users[0].auth, '', 'the public user read carries no sign-in');
    } finally {
      await server.close();
    }
  });

  await test('case 9: with GitHub refusing the connection, the service 200s the slug as sent: the token prints, exit 0, one POST', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const service = await startService(200, { token: 'ghs_asSent', expires_at: '2099-01-01T00:00:00Z' });
    const gone = await startServer([], mkTmp('wk-identity-github-'));
    await gone.close();
    try {
      useTokenService(home, `${service.url}/token`);
      const res = command([REPO], hostsOf(gone));
      assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
      assertEq(res.stdout, 'ghs_asSent\n', 'stdout is the token');
      assertEq(JSON.stringify(postedRepos(service)), JSON.stringify([REPO]), 'one POST, under the slug as sent');
    } finally {
      await service.close();
    }
  });

  await test('case 10: a fresh cached token for the repo is handed back with no GitHub read and no POST', async () => {
    const { tokenFor } = load();
    const cacheDir = mkTmp('wk-identity-cache-');
    fs.writeFileSync(path.join(cacheDir, 'acme--widgets.json'),
      JSON.stringify({ token: 'ghs_cached', expiresAt: '2023-11-14T23:13:20Z' }), { mode: 0o600 });
    const service = fakeService([], { [REPO]: { full_name: REPO, owner: { login: 'acme', id: 4242 } } }, { acme: { login: 'acme', id: 4242 } });
    assertEq(await tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir, loginFile: signedIn(),
    }), 'ghs_cached', 'the cached token');
    assertEq(service.reads.length, 0, `no GitHub read, got: ${JSON.stringify(service.reads.map((r) => r.url))}`);
    assertEq(service.posts.length + service.others.length, 0, `no POST and no other call, got: ${service.others.join(', ')}`);
  });

  group('identity/token: the command form');

  await test('case 14: --status prints the four fields, --installation and --probe answer installed or not installed, only --installation naming the install page, and tokenUrlOf({}) is the Worker\'s URL', async () => {
    const { tokenUrlOf } = load();
    assertEq(tokenUrlOf({}), 'https://workkit.itwcreativeworks.com/token', 'the default token URL');
    assertEq(tokenUrlOf(SETTINGS), TOKEN_URL, 'identity.tokenUrl wins');

    const { home, command } = tokenKit();
    const loginFile = path.join(home, '.workkit', 'identity', 'login.json');
    useTokenService(home, 'http://127.0.0.1:9/token');
    const status = () => {
      const res = command(['--status']);
      assertEq(res.status, 0, `--status exits 0, stderr: ${res.stderr}`);
      return JSON.parse(res.stdout);
    };
    const out = status();
    assertEq(out.loginFile, loginFile, 'names the login file');
    assertEq(out.signedIn, false, 'no login: not signed in');
    assert(!out.login, `no login: no login name, got: ${out.login}`);
    assertEq(out.tokenUrl, 'http://127.0.0.1:9/token', 'the settings\' token URL');

    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const signed = status();
    assertEq(signed.signedIn, true, 'signed in');
    assertEq(signed.login, 'octocat', 'as octocat');

    for (const [code, body, said] of [
      [200, { token: 'ghs_install_probe', expires_at: '2099-01-01T00:00:00Z' }, 'installed'],
      [412, { error: 'not installed', fix: INSTALL_FIX }, 'not installed'],
    ]) {
      for (const form of ['--installation', '--probe']) {
        const server = await startServer([
          { method: 'POST', url: '/token', status: code, body: JSON.stringify(body) },
          repoRoute(REPO, REPO, 4242),
        ], mkTmp('wk-identity-service-'));
        try {
          useTokenService(home, `${server.url}/token`);
          const res = command([form, REPO], { GITHUB_API_URL: server.url });
          assertEq(res.stdout.trim(), said, `${code}: ${form} prints ${said} (stderr: ${res.stderr})`);
          assertEq(res.status, 0, `${code}: ${form} exits 0`);
          const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
          assertEq(posts.length, 1, `${code}: ${form} asked the service through identity.tokenUrl, got: ${JSON.stringify(server.requests())}`);
          assertEq(JSON.stringify(JSON.parse(posts[0].body)), JSON.stringify({ repo: 'acme/widgets' }), `${code}: ${form} for the repo`);
          const paged = code === 412 && form === '--installation';
          if (code === 412) {
            assertEq(res.stderr.includes(`${PRESELECTED}4242`), paged, `${code}: ${form} ${paged ? 'names' : 'never names'} the install page, got: ${res.stderr}`);
            assertEq(res.stderr.includes(BOT_HINT), paged, `${code}: ${form} ${paged ? 'names' : 'never names'} the --bot command, got: ${res.stderr}`);
          }
        } finally {
          await server.close();
        }
      }
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
