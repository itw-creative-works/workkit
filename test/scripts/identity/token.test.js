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
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { IS_WINDOWS } = require('../../lib/platform');
const { caught } = require('../../lib/caught');
const {
  INSTALL_FIX, PRESELECTED, BOT_HINT, UNREADABLE, deviceFlowRoutes, repoRoute, userRoute, writeLogin, readWrittenLogin, useTokenService, collector, json, startServer,
  startService, scratchKit, scratchEnv, hostsOf, PTY, atTerminal,
} = require('../../lib/identity');

const MODULE = path.join(__dirname, '..', '..', '..', 'workflow', 'identity', 'token.js');
const SETTINGS_LIB = path.join(__dirname, '..', '..', '..', 'workflow', 'lib', 'settings.js');
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

describe('identity/token: the cache', () => {
  test('case 11: tokenFor mints through POST <tokenUrl> with the bearer and { repo }, reuses within the hour, mints again under five minutes; no expiresAt is a miss', async () => {
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

    expect(await tokenFor(REPO, opts(NOW)), 'the minted token').toBe('ghs_first');
    expect(service.posts.length, `one mint, other calls: ${service.others.join(', ')}`).toBe(1);
    expect(service.posts[0].headers.get('authorization'), 'the login\'s bearer').toBe(`Bearer ${USER_TOKEN}`);
    expect(JSON.stringify(JSON.parse(service.posts[0].body)), 'the body names the repo').toBe(JSON.stringify({ repo: 'acme/widgets' }));
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    expect(cached.token, 'the cache holds the token').toBe('ghs_first');
    expect(cached.expiresAt, 'and its expiry').toBe('2023-11-14T23:13:20Z');

    expect(await tokenFor(REPO, opts(NOW + 30 * MINUTE)), 'the cached token').toBe('ghs_first');
    expect(service.posts.length, 'no mint while the cache has 30 minutes left').toBe(1);

    expect(await tokenFor(REPO, opts(NOW + 56 * MINUTE)), 'a fresh token').toBe('ghs_second');
    expect(service.posts.length, 'a mint with 4 minutes left').toBe(2);
    expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).token, 'the cache holds the fresh token').toBe('ghs_second');

    const staleDir = mkTmp('wk-identity-cache-');
    fs.writeFileSync(path.join(staleDir, 'acme--widgets.json'), JSON.stringify({ token: 'ghs_stale' }), { mode: 0o600 });
    const stale = fakeService([['ghs_fresh', '2023-11-14T23:13:20Z']]);
    expect(await tokenFor(REPO, {
      settings: SETTINGS, fetch: stale.fetch, now: NOW, cacheDir: staleDir, loginFile,
    }), 'no expiresAt: a fresh token').toBe('ghs_fresh');
    expect(stale.posts.length, 'one mint').toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(staleDir, 'acme--widgets.json'), 'utf8')).expiresAt, 'the cache rewritten whole').toBe('2023-11-14T23:13:20Z');
  });

  test(
    'case 11 (POSIX): tokenFor writes the cache file with mode 0600', { skip: IS_WINDOWS && 'Windows keeps no POSIX permission bits to read 0600 back from' }, async () => {
      const cacheDir = mkTmp('wk-identity-cache-');
      const { fetch } = fakeService([['ghs_first', '2023-11-14T23:13:20Z']]);
      await load().tokenFor(REPO, {
        settings: SETTINGS, fetch, now: NOW, cacheDir, loginFile: signedIn(),
      });
      const mode = fs.statSync(path.join(cacheDir, 'acme--widgets.json')).mode & 0o777;
      expect(mode.toString(8), 'owner read and write only').toBe('600');
    },
  );
});

describe('identity/token: the refusals', () => {
  test('case 12: no login file, not at a keyboard, is not_signed_in; the command exits 3 naming workkit setup --login, with no request made', async () => {
    const { tokenFor, IdentityError } = load();
    const service = fakeService([]);
    const absent = path.join(mkTmp('wk-identity-nologin-'), '.workkit', 'identity', 'login.json');
    const err = await caught(() => tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: absent,
    }));
    expect(err, 'tokenFor throws, got a return').toBeInstanceOf(Error);
    expect(err instanceof IdentityError, `an IdentityError, got: ${err.name}: ${err.message}`).toBeTruthy();
    expect(err.code, 'the code').toBe('not_signed_in');
    expect(service.posts.length + service.others.length, 'no request made').toBe(0);

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
      expect(res.status, `exit 3, stderr: ${res.stderr}`).toBe(3);
      expect(res.stderr.includes('workkit setup --login'), `stderr names workkit setup --login, got: ${res.stderr}`).toBeTruthy();
      expect(!res.stderr.includes('workkit login'), `and no longer workkit login, got: ${res.stderr}`).toBeTruthy();
      expect(res.stdout, 'no token on stdout').toBe('');
      expect(server.requests().length, `no device-code request and no service request, got: ${JSON.stringify(server.requests())}`).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('case 12: not signed in, for no login file and for the service\'s 401: exit 3 naming workkit setup --login', async () => {
    const { home, command } = tokenKit();
    useTokenService(home, TOKEN_URL);
    const bare = command([REPO]);
    expect(bare.status, `no login file: exit 3, stderr: ${bare.stderr}`).toBe(3);
    expect(bare.stderr.includes('workkit setup --login'), `no login file: stderr names workkit setup --login, got: ${bare.stderr}`).toBeTruthy();

    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await startService(401, { error: 'not signed in', fix: 'run workkit setup --login' });
    try {
      useTokenService(home, `${server.url}/token`);
      const refused = command([REPO], hostsOf(server));
      expect(refused.status, `401: exit 3, stderr: ${refused.stderr}`).toBe(3);
      expect(refused.stderr.includes('workkit setup --login'), `401: stderr names workkit setup --login, got: ${refused.stderr}`).toBeTruthy();
      expect(`${bare.stdout}${refused.stdout}`, 'no token on stdout').toBe('');
    } finally {
      await server.close();
    }
  });

  test('case 12a: no login file at a keyboard: tokenWithSignIn says why on out, signs in once and hands on the token; away from one it never signs in', async () => {
    const { tokenWithSignIn, IdentityError } = load();
    const home = mkTmp('wk-identity-signin-');
    const loginFile = path.join(home, '.workkit', 'identity', 'login.json');
    const told = collector();
    const signIn = recordingSignIn(home, 'ghu_freshsignin', told);
    const service = fakeService([['ghs_aftersignin', '2023-11-14T23:13:20Z']]);
    const token = await tokenWithSignIn(REPO, {
      atKeyboard: () => true, signIn: signIn.fn, out: told.out, settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile,
    });
    expect(token, 'the token comes back').toBe('ghs_aftersignin');
    expect(signIn.runs(), 'the sign-in ran once').toBe(1);
    const before = signIn.said();
    expect(before.includes(`not signed in to workkit (no ${loginFile}); run \`workkit setup --login\``),
      `out carries the refusal's message before the sign-in, got: ${JSON.stringify(before)}`).toBeTruthy();
    expect(before.includes('signing in now'), `and signing in now, got: ${JSON.stringify(before)}`).toBeTruthy();
    expect(before.indexOf('not signed in to workkit') < before.indexOf('signing in now'), `the reason first, got: ${JSON.stringify(before)}`).toBeTruthy();
    expect(service.posts.length, `one service call, other calls: ${service.others.join(', ')}`).toBe(1);
    expect(service.posts[0].headers.get('authorization'), 'carrying the new sign-in\'s bearer').toBe('Bearer ghu_freshsignin');

    const awayOut = collector();
    const away = recordingSignIn(mkTmp('wk-identity-signin-'), 'ghu_never');
    const quiet = fakeService([]);
    const err = await caught(() => tokenWithSignIn(REPO, {
      atKeyboard: () => false,
      signIn: away.fn,
      out: awayOut.out,
      settings: SETTINGS,
      fetch: quiet.fetch,
      now: NOW,
      cacheDir: mkTmp('wk-identity-cache-'),
      loginFile: path.join(mkTmp('wk-identity-nologin-'), '.workkit', 'identity', 'login.json'),
    }));
    expect(err, 'tokenWithSignIn throws, got a return').toBeInstanceOf(Error);
    expect(err instanceof IdentityError, `away from a keyboard: an IdentityError, got: ${err.name}: ${err.message}`).toBeTruthy();
    expect(err.code, 'away from a keyboard: not_signed_in').toBe('not_signed_in');
    expect(away.runs(), 'away from a keyboard: no sign-in').toBe(0);
    expect(quiet.posts.length + quiet.others.length, 'away from a keyboard: no request made').toBe(0);
    expect(awayOut.text(), 'away from a keyboard: out is left to the caller, which prints the refusal once').toBe('');
  });

  test(
    'case 12a: the command at a keyboard with no login file says why, runs the device flow on stderr, writes the login, and prints only the token on stdout', { skip: !PTY && 'no `script` here to hand the command a terminal' }, async () => {
      const { home, atKeyboard } = tokenKit();
      const server = await startServer([
        ...KEYBOARD_FLOW,
        { method: 'POST', url: '/token', status: 200, body: JSON.stringify({ token: 'ghs_fromkeyboard', expires_at: '2099-01-01T00:00:00Z' }) },
      ], mkTmp('wk-identity-service-'));
      try {
        useTokenService(home, `${server.url}/token`);
        const res = atKeyboard([REPO], hostsOf(server));
        expect(res.status, `exit 0, terminal: ${res.terminal}`).toBe(0);
        expect(res.stdout, 'stdout is the token alone').toBe('ghs_fromkeyboard\n');
        expect(res.terminal.includes('TERM-1NAL'), `the user code reaches the terminal, got: ${res.terminal}`).toBeTruthy();
        const reason = res.terminal.indexOf('not signed in to workkit');
        const now = res.terminal.indexOf('signing in now');
        const page = res.terminal.indexOf('Open https://github.com/login/device');
        expect(reason >= 0 && now > reason && page > now, `the not-signed-in line, then signing in now, then Open the page, got: ${res.terminal}`).toBeTruthy();
        expect(JSON.stringify(readWrittenLogin(home)), 'the login file is written').toBe(JSON.stringify({ token: 'ghu_fromkeyboard', login: 'hubot' }));
        const device = server.requests().filter((r) => r.method === 'POST' && r.url === '/login/device/code');
        expect(device.length, `one device-code request, got: ${JSON.stringify(server.requests())}`).toBe(1);
        const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        expect(posts.length, `one service request, got: ${JSON.stringify(server.requests())}`).toBe(1);
        expect(posts[0].auth, 'carrying the new sign-in\'s bearer').toBe('Bearer ghu_fromkeyboard');
      } finally {
        await server.close();
      }
    },
  );

  test('case 12b: a 401 at a keyboard is one sign-in and one retry; a second 401 is not_signed_in; away from a keyboard there is no sign-in', async () => {
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
    expect(retried.err, `401 then 200: no error, got: ${retried.err && retried.err.message}`).toBe(undefined);
    expect(retried.token, '401 then 200: the retry\'s token').toBe('ghs_onretry');
    expect(retried.runs, '401 then 200: one sign-in').toBe(1);
    expect(retried.posts.length, '401 then 200: two service calls').toBe(2);
    expect(retried.posts[0].headers.get('authorization'), 'the first call carries the old bearer').toBe(`Bearer ${USER_TOKEN}`);
    expect(retried.posts[1].headers.get('authorization'), 'the retry carries the new one').toBe('Bearer ghu_resignedin');
    expect(retried.before.includes('not signed in: run `workkit setup --login`') &&retried.before.includes('signing in now'),
      `401 then 200: out carries the refusal's message and signing in now before the sign-in, got: ${JSON.stringify(retried.before)}`).toBeTruthy();

    const twice = await attempt([REFUSED, REFUSED], true);
    expect(twice.err instanceof IdentityError, `401 then 401: an IdentityError, got: ${twice.err}`).toBeTruthy();
    expect(twice.err.code, '401 then 401: not_signed_in').toBe('not_signed_in');
    expect(twice.runs, '401 then 401: the sign-in ran once').toBe(1);
    expect(twice.posts.length, '401 then 401: two service calls, no third').toBe(2);

    const away = await attempt([REFUSED, ['ghs_never', '2023-11-14T23:13:20Z']], false);
    expect(away.err instanceof IdentityError, `away, 401: an IdentityError, got: ${away.err}`).toBeTruthy();
    expect(away.err.code, 'away, 401: not_signed_in').toBe('not_signed_in');
    expect(away.runs, 'away, 401: the sign-in never ran').toBe(0);
    expect(away.posts.length, 'away, 401: one service call').toBe(1);

    const notInstalled = await attempt([{ status: 412, body: { error: 'not installed', fix: INSTALL_FIX } }], true);
    expect(notInstalled.err instanceof IdentityError, `412 at a keyboard: an IdentityError, got: ${notInstalled.err}`).toBeTruthy();
    expect(notInstalled.err.code, '412 at a keyboard: not_installed').toBe('not_installed');
    expect(notInstalled.runs, '412 at a keyboard: a refusal other than not_signed_in never signs in').toBe(0);
  });

  test('case 13: the service\'s 401 exits 3 naming workkit setup --login, 412 exits 4 naming the owner, 403 exits 1 naming no write access, 500 exits 1 with its message', async () => {
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
        expect(res.status, `${status}: exit ${exit}, stderr: ${res.stderr}`).toBe(exit);
        expect(pattern.test(res.stderr), `${status}: stderr matches ${pattern}, got: ${res.stderr}`).toBeTruthy();
        expect(!res.stderr.includes('workkit login'), `${status}: no stderr line names workkit login, got: ${res.stderr}`).toBeTruthy();
        expect(server.requests().filter((r) => r.url === '/login/device/code').length, `${status}: no device-code request, got: ${JSON.stringify(server.requests())}`).toBe(0);
        expect(res.stdout, `${status}: no token on stdout`).toBe('');
        const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        expect(posts.length, `${status}: the one request reached the stand-in, got: ${JSON.stringify(server.requests())}`).toBe(1);
        expect(posts[0].auth, `${status}: carrying the login's bearer`).toBe(`Bearer ${USER_TOKEN}`);
      } finally {
        await server.close();
      }
    }
  });
});

describe('identity/token: a machine settings file the merge sets aside', () => {
  /**
   * tokenFor with no injected settings, signed in, the cache empty, and the machine
   * file under a scratch WORKFLOW_HOME holding `text`: `{ file, service, token, err }`.
   */
  const withMachineFile = async (text) => {
    const before = process.env.WORKFLOW_HOME;
    process.env.WORKFLOW_HOME = mkTmp('wk-identity-workflow-home-');
    const file = path.join(process.env.WORKFLOW_HOME, 'settings.json');
    fs.writeFileSync(file, text);
    const service = fakeService([['ghs_minted', '2099-01-01T00:00:00Z']]);
    try {
      const token = await load().tokenFor(REPO, {
        fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: signedIn(),
      });
      return { file, service, token, err: null };
    } catch (err) {
      return { file, service, token: null, err };
    } finally {
      if (before === undefined) delete process.env.WORKFLOW_HOME;
      else process.env.WORKFLOW_HOME = before;
    }
  };

  /** The run refused as `settings` with exactly `message`, and fetched nothing. */
  const assertSettingsRefusal = ({ service, err }, message) => {
    const { IdentityError } = load();
    expect(err instanceof IdentityError, `an IdentityError, got: ${err && `${err.name}: ${err.message}`}`).toBeTruthy();
    expect(err.code, 'the code').toBe('settings');
    expect(err.message, 'the fault line and the fix').toBe(message);
    expect(service.posts.length + service.reads.length + service.others.length, `nothing fetched, got: ${service.others.join(', ')}`).toBe(0);
  };

  test('fault case 11: a machine file that does not parse: refused as settings, naming the file, with nothing fetched', async () => {
    const run = await withMachineFile('{ not json');
    assertSettingsRefusal(run, `${run.file} is not a JSON object, so it adds nothing; fix or remove it`);
  });

  test('fault case 12: a machine identity that is a string: refused as settings, naming identity, with nothing fetched', async () => {
    const run = await withMachineFile('{"identity": "x"}');
    assertSettingsRefusal(run, `${run.file}: identity is not an object, so the value below it stands; fix or remove it`);
  });

  test('fault case 13: a machine manager that is a string is not identity\'s fault: the token is minted through the file\'s tokenUrl', async () => {
    const run = await withMachineFile(JSON.stringify({ manager: 'off', identity: { tokenUrl: TOKEN_URL } }));
    expect(run.err, `no refusal, got: ${run.err && run.err.message}`).toBe(null);
    expect(run.token, 'the minted token').toBe('ghs_minted');
    expect(run.service.posts.length, `one mint through the machine file's tokenUrl, other calls: ${run.service.others.join(', ')}`).toBe(1);
  });
});

describe('identity/token: the owner read before the ask', () => {
  test('case 1: GitHub names Old/widgets New/widgets and the service 200s New/widgets: the token prints, exit 0, nothing on stderr, one POST, for New/widgets', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await renamedService(GRANTED);
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([OLD], hostsOf(server));
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, 'stdout is the canonical repo\'s token').toBe('ghs_canonical\n');
      expect(res.stderr, 'nothing on stderr').toBe('');
      expect(JSON.stringify(postedRepos(server)), `one POST, under the canonical name, none under the old, got: ${JSON.stringify(server.requests())}`).toBe(JSON.stringify([NEW]));
      const reads = server.requests().filter((r) => r.method === 'GET' && r.url === `/repos/${OLD}`);
      expect(reads.length, `GitHub's repo read for the sent slug, got: ${JSON.stringify(server.requests())}`).toBe(1);
      expect(reads[0].auth, 'the repo read carries the user\'s sign-in').toBe(`Bearer ${USER_TOKEN}`);
    } finally {
      await server.close();
    }
  });

  test('case 2: renamed, and the service 412s New/widgets: exit 4, the refusal names New and the page pre-selected on id 7, then the --bot line, with no public user read', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await renamedService(DENIED);
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([OLD], hostsOf(server));
      expect(res.status, `exit 4, stderr: ${res.stderr}`).toBe(4);
      const lines = linesOf(res.stderr);
      const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on New: ${PRESELECTED}7`));
      expect(at >= 0, `stderr names the canonical owner and its pre-selected page, got: ${res.stderr}`).toBeTruthy();
      expect(lines[at + 1], 'the next line is the --bot command').toBe(BOT_HINT);
      expect(res.stdout, 'no token on stdout').toBe('');
      expect(JSON.stringify(postedRepos(server)), 'one POST, under the canonical name').toBe(JSON.stringify([NEW]));
      expect(userReads(server).length, `no public user read, got: ${JSON.stringify(server.requests())}`).toBe(0);
    } finally {
      await server.close();
    }
  });

  test('case 3: the repo read and the public user read both fail (connection refused, a 404, a timeout, a non-integer id) and the service 412s Old/widgets: the unreadable refusal naming Old, no page, no --bot line', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const service = await startService(412, REFUSED_412.body);
    const gone = await startServer([], mkTmp('wk-identity-github-'));
    await gone.close();
    try {
      useTokenService(home, `${service.url}/token`);
      const res = command([OLD], hostsOf(gone));
      expect(res.status, `connection refused: exit 4, stderr: ${res.stderr}`).toBe(4);
      expect(linesOf(res.stderr).some((l) => l.endsWith(UNREADABLE)), `connection refused: stderr says the id was unreadable, got: ${res.stderr}`).toBeTruthy();
      expect(!res.stderr.includes('installations/new'), `connection refused: no install page anywhere, got: ${res.stderr}`).toBeTruthy();
      expect(!res.stderr.includes(BOT_HINT), `connection refused: no --bot line, got: ${res.stderr}`).toBeTruthy();
      expect(JSON.stringify(postedRepos(service)), 'connection refused: one POST, under the slug as sent').toBe(JSON.stringify([OLD]));
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
      const err = await caught(() => tokenFor(OLD, {
        settings: SETTINGS, fetch: fake.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: signedIn(),
      }));
      expect(err, 'tokenFor throws, got a return').toBeInstanceOf(Error);
      expect(err.code, `${label}: not_installed`).toBe('not_installed');
      expect(linesOf(err.message).some((l) => l.endsWith(UNREADABLE)), `${label}: the unreadable line, got: ${err.message}`).toBeTruthy();
      expect(!err.message.includes('installations/new'), `${label}: no install page, got: ${err.message}`).toBeTruthy();
      expect(!err.message.includes(BOT_HINT), `${label}: no --bot line, got: ${err.message}`).toBeTruthy();
      const reads = fake.reads.map((r) => new URL(r.url).pathname);
      expect(JSON.stringify(reads), `${label}: the repo read, then the public user read, other calls: ${fake.others.join(', ')}`).toBe(JSON.stringify([`/repos/${OLD}`, '/users/Old']));
      expect(JSON.stringify(fake.posts.map((p) => JSON.parse(p.body).repo)), `${label}: one POST, under the slug as sent`).toBe(JSON.stringify([OLD]));
    }
  });

  test('case 4: no rename, a 412 is one POST and the refusal names the owner and the page built from the repo read\'s id, the read carrying the sign-in', async () => {
    const { tokenFor } = load();
    const service = fakeService([REFUSED_412], { [REPO]: { full_name: REPO, owner: { login: 'acme', id: 4242 } } });
    const err = await caught(() => tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir: mkTmp('wk-identity-cache-'), loginFile: signedIn(),
    }));
    expect(err, 'tokenFor throws, got a return').toBeInstanceOf(Error);
    expect(err.code, 'not_installed').toBe('not_installed');
    const lines = linesOf(err.message);
    const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on acme: ${PRESELECTED}4242`));
    expect(at >= 0, `the refusal names acme and its pre-selected page, got: ${err.message}`).toBeTruthy();
    expect(lines[at + 1], 'the next line is the --bot command').toBe(BOT_HINT);
    expect(service.posts.length, 'one POST').toBe(1);
    expect(service.reads.length, `one repo read, other calls: ${service.others.join(', ')}`).toBe(1);
    expect(service.reads[0].headers.get('authorization'), 'the read carries the user\'s sign-in').toBe(`Bearer ${USER_TOKEN}`);
  });

  test('case 5: --installation and --probe say installed off the one POST under the canonical slug, not installed otherwise; the probe prints no page and makes no public user read', async () => {
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
          expect(res.stdout.trim(), `${label}: prints ${said} (stderr: ${res.stderr})`).toBe(said);
          expect(res.status, `${label}: exits 0`).toBe(0);
          expect(JSON.stringify(postedRepos(server)), `${label}: one POST, for ${posted}`).toBe(JSON.stringify([posted]));
          if (form === '--probe') {
            expect(!res.stderr.includes('installations/new'), `${label}: prints no page, got: ${res.stderr}`).toBeTruthy();
            expect(userReads(server).length, `${label}: no public user read, got: ${JSON.stringify(server.requests())}`).toBe(0);
          } else if (scene === 'renamed, not installed') {
            expect(linesOf(res.stderr).some((l) => l.endsWith(`install workkit-agent[bot] on New: ${PRESELECTED}7`)), `${label}: names New's pre-selected page, got: ${res.stderr}`).toBeTruthy();
          } else if (scene === 'private, not installed') {
            expect(userReads(server).length, `${label}: the public user read gives the page's id, got: ${JSON.stringify(server.requests())}`).toBe(1);
          }
        } finally {
          await server.close();
        }
      }
    }
  });

  test('case 7: installPage builds the page pre-selected on the id it is given', async () => {
    const { installPage } = require(INSTALL_PAGE_JS);
    expect(installPage(7), 'the page pre-selected on id 7').toBe(`${PRESELECTED}7`);
  });

  test('case 8: the repo read is a 404 (a private repo, no install, no rename), the service 412s the slug as sent and the public user read answers id 7: one POST, exit 4, the refusal names acme and the page on id 7, then the --bot line', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const server = await privateRepoService();
    try {
      useTokenService(home, `${server.url}/token`);
      const res = command([REPO], hostsOf(server));
      expect(res.status, `exit 4, stderr: ${res.stderr}`).toBe(4);
      const lines = linesOf(res.stderr);
      const at = lines.findIndex((l) => l.endsWith(`install workkit-agent[bot] on acme: ${PRESELECTED}7`));
      expect(at >= 0, `stderr names acme and the page pre-selected on id 7, got: ${res.stderr}`).toBeTruthy();
      expect(lines[at + 1], 'the next line is the --bot command').toBe(BOT_HINT);
      expect(JSON.stringify(postedRepos(server)), 'one POST, under the slug as sent').toBe(JSON.stringify([REPO]));
      const users = userReads(server);
      expect(users.length, `the public user read was made, got: ${JSON.stringify(server.requests())}`).toBe(1);
      expect(users[0].auth, 'the public user read carries no sign-in').toBe('');
    } finally {
      await server.close();
    }
  });

  test('case 9: with GitHub refusing the connection, the service 200s the slug as sent: the token prints, exit 0, one POST', async () => {
    const { home, command } = tokenKit();
    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const service = await startService(200, { token: 'ghs_asSent', expires_at: '2099-01-01T00:00:00Z' });
    const gone = await startServer([], mkTmp('wk-identity-github-'));
    await gone.close();
    try {
      useTokenService(home, `${service.url}/token`);
      const res = command([REPO], hostsOf(gone));
      expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
      expect(res.stdout, 'stdout is the token').toBe('ghs_asSent\n');
      expect(JSON.stringify(postedRepos(service)), 'one POST, under the slug as sent').toBe(JSON.stringify([REPO]));
    } finally {
      await service.close();
    }
  });

  test('case 10: a fresh cached token for the repo is handed back with no GitHub read and no POST', async () => {
    const { tokenFor } = load();
    const cacheDir = mkTmp('wk-identity-cache-');
    fs.writeFileSync(path.join(cacheDir, 'acme--widgets.json'),
      JSON.stringify({ token: 'ghs_cached', expiresAt: '2023-11-14T23:13:20Z' }), { mode: 0o600 });
    const service = fakeService([], { [REPO]: { full_name: REPO, owner: { login: 'acme', id: 4242 } } }, { acme: { login: 'acme', id: 4242 } });
    expect(await tokenFor(REPO, {
      settings: SETTINGS, fetch: service.fetch, now: NOW, cacheDir, loginFile: signedIn(),
    }), 'the cached token').toBe('ghs_cached');
    expect(service.reads.length, `no GitHub read, got: ${JSON.stringify(service.reads.map((r) => r.url))}`).toBe(0);
    expect(service.posts.length + service.others.length, `no POST and no other call, got: ${service.others.join(', ')}`).toBe(0);
  });
});

describe('identity/token: the command form', () => {
  test('case 14: --status prints the four fields, --installation and --probe answer installed or not installed, only --installation naming the install page, and the kit defaults name the Worker\'s URL', async () => {
    const { tokenUrlOf } = load();
    const { settingsAt } = require(SETTINGS_LIB);
    const bare = settingsAt(null, path.join(mkTmp('token-defaults-'), 'settings.json'));
    expect(tokenUrlOf(bare), 'the default token URL').toBe('https://workkit.itwcreativeworks.com/token');
    expect(tokenUrlOf(SETTINGS), 'identity.tokenUrl wins').toBe(TOKEN_URL);

    const { home, command } = tokenKit();
    const loginFile = path.join(home, '.workkit', 'identity', 'login.json');
    useTokenService(home, 'http://127.0.0.1:9/token');
    const status = () => {
      const res = command(['--status']);
      expect(res.status, `--status exits 0, stderr: ${res.stderr}`).toBe(0);
      return JSON.parse(res.stdout);
    };
    const out = status();
    expect(out.loginFile, 'names the login file').toBe(loginFile);
    expect(out.signedIn, 'no login: not signed in').toBe(false);
    expect(!out.login, `no login: no login name, got: ${out.login}`).toBeTruthy();
    expect(out.tokenUrl, 'the settings\' token URL').toBe('http://127.0.0.1:9/token');

    writeLogin(home, { token: USER_TOKEN, login: 'octocat' });
    const signed = status();
    expect(signed.signedIn, 'signed in').toBe(true);
    expect(signed.login, 'as octocat').toBe('octocat');

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
          expect(res.stdout.trim(), `${code}: ${form} prints ${said} (stderr: ${res.stderr})`).toBe(said);
          expect(res.status, `${code}: ${form} exits 0`).toBe(0);
          const posts = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
          expect(posts.length, `${code}: ${form} asked the service through identity.tokenUrl, got: ${JSON.stringify(server.requests())}`).toBe(1);
          expect(JSON.stringify(JSON.parse(posts[0].body)), `${code}: ${form} for the repo`).toBe(JSON.stringify({ repo: 'acme/widgets' }));
          const paged = code === 412 && form === '--installation';
          if (code === 412) {
            expect(res.stderr.includes(`${PRESELECTED}4242`), `${code}: ${form} ${paged ? 'names' : 'never names'} the install page, got: ${res.stderr}`).toBe(paged);
            expect(res.stderr.includes(BOT_HINT), `${code}: ${form} ${paged ? 'names' : 'never names'} the --bot command, got: ${res.stderr}`).toBe(paged);
          }
        } finally {
          await server.close();
        }
      }
    }
  });
});
