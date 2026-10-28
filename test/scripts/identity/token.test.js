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
  INSTALL_FIX, deviceFlowRoutes, writeLogin, readWrittenLogin, useTokenService, collector, json, failureOf, startServer,
  startService, scratchKit, scratchEnv, PTY, atTerminal,
} = require('../../lib/identity');

const MODULE = path.join(__dirname, '..', '..', '..', 'workflow', 'identity', 'token.js');

// Required per case, so a module not yet built fails each case by name.
const load = () => require(MODULE);

const REPO = 'acme/widgets';
// A fixed clock, in epoch milliseconds, so the cache's expiry math is exact.
const NOW = 1700000000000;
const MINUTE = 60 * 1000;
const TOKEN_URL = 'https://tokens.example.test/token';
const SETTINGS = { version: 1, identity: { tokenUrl: TOKEN_URL } };
const USER_TOKEN = 'ghu_signedinuser';

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
 * each call: `[token, expiresAt]` is a grant, `{ status, body }` a refusal.
 */
const fakeService = (grants) => {
  const posts = [];
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
    others.push(`${method} ${url}`);
    return json(599, { error: `fake fetch has no route for ${method} ${url}` });
  };
  return { fetch, posts, others };
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
      const res = command([REPO], { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
      assertEq(res.status, 3, `exit 3, stderr: ${res.stderr}`);
      assert(res.stderr.includes('workkit setup --login'), `stderr names workkit setup --login, got: ${res.stderr}`);
      assert(!res.stderr.includes('workkit login'), `and no longer workkit login, got: ${res.stderr}`);
      assertEq(res.stdout, '', 'no token on stdout');
      assertEq(server.requests().length, 0, `no device-code request and no service request, got: ${JSON.stringify(server.requests())}`);
    } finally {
      await server.close();
    }
  });

  await test('case 12 (cloud): no login file in a cloud session exits 3 naming WORKKIT_LOGIN and workkit setup --cloud, never the device flow', async () => {
    const { home, command } = tokenKit();
    useTokenService(home, TOKEN_URL);
    const res = command([REPO], { CLAUDE_CODE_REMOTE: 'true' });
    assertEq(res.status, 3, `exit 3, stderr: ${res.stderr}`);
    assert(res.stderr.includes('WORKKIT_LOGIN'), `stderr names WORKKIT_LOGIN, got: ${res.stderr}`);
    assert(res.stderr.includes('workkit setup --cloud'), `stderr names workkit setup --cloud, got: ${res.stderr}`);
    assert(!res.stderr.includes('setup --login'), `and never setup --login, got: ${res.stderr}`);
    assertEq(res.stdout, '', 'no token on stdout');
  });

  await test('case 12 (cloud): the service\'s 401 in a cloud session exits 3 with the client\'s fix alone, never the service\'s setup --login', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await startService(401, { error: 'not signed in', fix: 'run workkit setup --login' });
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([REPO], { CLAUDE_CODE_REMOTE: 'true', GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
      assertEq(res.status, 3, `exit 3, stderr: ${res.stderr}`);
      assert(res.stderr.includes('WORKKIT_LOGIN'), `stderr names WORKKIT_LOGIN, got: ${res.stderr}`);
      assert(res.stderr.includes('workkit setup --cloud'), `stderr names workkit setup --cloud, got: ${res.stderr}`);
      assert(!res.stderr.includes('setup --login'), `and never setup --login, got: ${res.stderr}`);
      assertEq(res.stdout, '', 'no token on stdout');
      const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
      assertEq(posts.length, 1, `the one request reached the stand-in, got: ${JSON.stringify(server.requests())}`);
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
        const res = atKeyboard([REPO], { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
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

  await test('case 13: the service\'s 401 exits 3 naming workkit setup --login, 412 exits 4 with its fix, 403 exits 1 naming no write access, 500 exits 1 with its message', async () => {
    const answers = [
      [401, { error: 'not signed in', fix: 'run workkit setup --login' }, 3, /workkit setup --login/],
      [412, { error: 'not installed', fix: INSTALL_FIX }, 4, /https:\/\/github\.com\/apps\/workkit-agent/],
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
        const res = command([REPO], { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
        assertEq(res.status, exit, `${status}: exit ${exit}, stderr: ${res.stderr}`);
        assert(pattern.test(res.stderr), `${status}: stderr matches ${pattern}, got: ${res.stderr}`);
        assert(!res.stderr.includes('workkit login'), `${status}: no stderr line names workkit login, got: ${res.stderr}`);
        assertEq(server.requests().filter((r) => r.url !== '/token').length, 0,
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

  group('identity/token: the command form');

  await test('case 14: --status prints the four fields, --installation answers installed or not installed, and tokenUrlOf({}) is the Worker\'s URL', async () => {
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
      const server = await startService(code, body);
      try {
        useTokenService(home, `${server.url}/token`);
        const res = command(['--installation', REPO]);
        assertEq(res.stdout.trim(), said, `${code}: --installation prints ${said} (stderr: ${res.stderr})`);
        if (code === 200) assertEq(res.status, 0, 'installed exits 0');
        const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        assertEq(posts.length, 1, `${code}: asked the service through identity.tokenUrl, got: ${JSON.stringify(server.requests())}`);
        assertEq(JSON.stringify(JSON.parse(posts[0].body)), JSON.stringify({ repo: 'acme/widgets' }), `${code}: for the repo`);
      } finally {
        await server.close();
      }
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
