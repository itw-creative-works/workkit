// Tests for workflow/identity/login.js: GitHub's device flow and the login store
// it writes. Real files in a scratch home; `signIn` takes a recording fake
// `fetch` and `sleep`, and the command form runs against a local GitHub stand-in.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NO_NODE_STUB, homeEnv, stubTool, pathWith,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { until } = require('../../lib/process');
const { mkTmp } = require('../../lib/scratch');
const {
  DEVICE_CODE, deviceFlowRoutes, writeLogin, collector, json, failureOf, startServer,
} = require('../../lib/identity');

const KIT = path.join(__dirname, '..', '..', '..');
const MODULE = path.join(KIT, 'workflow', 'identity', 'login.js');
const APP = path.join(KIT, 'workflow', 'identity', 'app.js');

// Required per case, so a module not yet built fails each case by name.
const load = () => require(MODULE);

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const USAGE = 'usage: login.js [--open <opener>] | login.js --status';

/** A request body's fields, sent as JSON or form-encoded. */
const fieldsOf = (body) => {
  const text = String(body || '');
  if (text.trim().startsWith('{')) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
};

/**
 * A fetch answering GitHub's three device-flow routes at their default hosts:
 * the device code, each poll with the next of `polls`, and `/user` as octocat.
 * `calls` records each request; `sleeps` and `sleep` record the waits it is handed.
 */
const fakeFlow = (polls) => {
  const calls = [];
  const sleeps = [];
  let pollCount = 0;
  const fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url, method: (init.method || 'GET').toUpperCase(), headers: new Headers(init.headers), body: init.body,
    });
    if (url === 'https://github.com/login/device/code') return json(200, DEVICE_CODE);
    if (url === 'https://github.com/login/oauth/access_token') {
      pollCount += 1;
      return json(200, polls[pollCount - 1] || { error: 'unscripted_poll' });
    }
    if (url === 'https://api.github.com/user') return json(200, { login: 'octocat', id: 583231 });
    return json(599, { message: `fake fetch has no route for ${url}` });
  };
  const sleep = async (n) => { sleeps.push(n); };
  return {
    fetch, sleep, calls, sleeps,
  };
};

/** Run `node login.js <args>` with `home` its scratch home, `extra` added to the env. */
const command = (home, args, extra = {}) => {
  const env = homeEnv(home, { ...process.env, ...extra });
  delete env.WORKFLOW_HOME;
  if (!('GITHUB_SERVER_URL' in extra)) delete env.GITHUB_SERVER_URL;
  if (!('GITHUB_API_URL' in extra)) delete env.GITHUB_API_URL;
  return spawnSync(process.execPath, [MODULE, ...args], { env, encoding: 'utf8', timeout: 30000 });
};

const run = async () => {
  // loginFile() resolves under ~/.workkit; this process's home is a scratch one.
  const home = mkTmp('wk-login-home-');
  const loginPath = path.join(home, '.workkit', 'identity', 'login.json');
  const envBefore = {};
  for (const key of ['HOME', 'USERPROFILE', 'WORKFLOW_HOME', 'GITHUB_SERVER_URL', 'GITHUB_API_URL']) envBefore[key] = process.env[key];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.WORKFLOW_HOME;
  delete process.env.GITHUB_SERVER_URL;
  delete process.env.GITHUB_API_URL;

  group('identity/login: the device flow');

  await test('case 8: signIn posts the Client ID, prints the code and page, polls at the interval (+5 on slow_down), and writes { token, login } from /user', async () => {
    const { signIn, loginFile } = load();
    const { CLIENT_ID } = require(APP);
    assert(typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0, `app.js exports a Client ID, got: ${CLIENT_ID}`);
    assertEq(loginFile(), loginPath, 'loginFile() is <home>/.workkit/identity/login.json');

    const flow = fakeFlow([
      { error: 'authorization_pending' },
      { error: 'slow_down' },
      { access_token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a', token_type: 'bearer', scope: '' },
    ]);
    const { out, text } = collector();
    const entry = await signIn({ fetch: flow.fetch, sleep: flow.sleep, out });

    const device = flow.calls.filter((c) => c.url === 'https://github.com/login/device/code');
    assertEq(device.length, 1, 'one device-code request');
    assertEq(device[0].method, 'POST', 'the device code is a POST');
    assertEq(fieldsOf(device[0].body).client_id, CLIENT_ID, 'carrying the App\'s Client ID');
    assertEq(device[0].headers.get('accept'), 'application/json', 'asking for JSON, since GitHub answers form-encoded without it');

    const said = text();
    assert(said.includes('WDJB-MJHT'), `out names the user code, got: ${said}`);
    assert(said.includes('https://github.com/login/device'), `out names the verification page, got: ${said}`);

    const polls = flow.calls.filter((c) => c.url === 'https://github.com/login/oauth/access_token');
    assertEq(polls.length, 3, 'three polls: pending, slow_down, granted');
    for (const poll of polls) {
      assertEq(poll.method, 'POST', 'a poll is a POST');
      const fields = fieldsOf(poll.body);
      assertEq(fields.device_code, DEVICE_CODE.device_code, 'the poll carries the device code');
      assertEq(fields.grant_type, GRANT_TYPE, 'and the device-code grant type');
    }
    // The sleep seam takes milliseconds, as setTimeout does.
    assertEq(JSON.stringify(flow.sleeps), JSON.stringify([5000, 10000]), 'the server\'s interval, then five seconds more after slow_down');

    const user = flow.calls.filter((c) => c.url === 'https://api.github.com/user');
    assertEq(user.length, 1, 'one /user read');
    assert(String(user[0].headers.get('authorization')).includes('ghu_16C7e42F292c6912E7710c838347Ae178B4a'),
      `the /user read carries the new token, got: ${user[0].headers.get('authorization')}`);

    const stored = JSON.parse(fs.readFileSync(loginPath, 'utf8'));
    assertEq(JSON.stringify(stored), JSON.stringify({ token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a', login: 'octocat' }), 'the file holds { token, login }');
    assertEq(JSON.stringify(entry), JSON.stringify(stored), 'signIn returns the entry it wrote');

    // The command form signs in the same way against a local GitHub stand-in.
    const cmdHome = mkTmp('wk-login-cmd-home-');
    const server = await startServer(deviceFlowRoutes({ userCode: 'WDJB-MJHT', accessToken: 'ghu_fromcommand', login: 'hubot' }), cmdHome);
    try {
      const res = command(cmdHome, [], { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
      assertEq(res.status, 0, `node login.js exits 0, stderr: ${res.stderr}`);
      assert(`${res.stdout}${res.stderr}`.includes('WDJB-MJHT'), `the command prints the user code, got: ${res.stdout}${res.stderr}`);
      const written = JSON.parse(fs.readFileSync(path.join(cmdHome, '.workkit', 'identity', 'login.json'), 'utf8'));
      assertEq(JSON.stringify(written), JSON.stringify({ token: 'ghu_fromcommand', login: 'hubot' }), 'the command writes { token, login }');
      const posted = server.requests().find((r) => r.url === '/login/device/code');
      assert(posted && fieldsOf(posted.body).client_id === CLIENT_ID, `the command posts the Client ID, got: ${JSON.stringify(server.requests())}`);
    } finally {
      await server.close();
    }
  });

  await testUnless(IS_WINDOWS, 'Windows keeps no POSIX permission bits to read 0700 and 0600 back from')(
    'case 8 (POSIX): the login folder is 0700 and the file 0600', async () => {
      assert(fs.existsSync(loginPath), 'case 8 wrote the login file');
      assertEq((fs.statSync(path.dirname(loginPath)).mode & 0o777).toString(8), '700', 'the folder: owner only');
      assertEq((fs.statSync(loginPath).mode & 0o777).toString(8), '600', 'the file: owner read and write only');
    },
  );

  await test('case 9: access_denied and expired_token throw naming the reason, and nothing is written', async () => {
    const { signIn } = load();
    for (const [reason, pattern] of [['access_denied', /denied/i], ['expired_token', /expired/i]]) {
      fs.rmSync(loginPath, { force: true });
      const flow = fakeFlow([{ error: reason }]);
      const err = await failureOf(() => signIn({ fetch: flow.fetch, sleep: flow.sleep, out: collector().out }));
      assert(pattern.test(err.message), `${reason}: the error names the reason, got: ${err.message}`);
      assertEq(fs.existsSync(loginPath), false, `${reason}: no login file`);
      assertEq(flow.calls.filter((c) => c.url === 'https://api.github.com/user').length, 0, `${reason}: no /user read`);
    }
  });

  group('identity/login: the command form');

  await test('case 10: --logout is the usage error, exit 1, and leaves the file; --status prints signedIn true only for a file holding a token', () => {
    const cmdHome = mkTmp('wk-login-status-home-');
    const file = path.join(cmdHome, '.workkit', 'identity', 'login.json');
    const status = () => {
      const res = command(cmdHome, ['--status']);
      assertEq(res.status, 0, `--status exits 0, stderr: ${res.stderr}`);
      return JSON.parse(res.stdout);
    };

    const none = status();
    assertEq(none.loginFile, file, 'names the login file');
    assertEq(none.signedIn, false, 'no file: not signed in');
    assert(!none.login, `no file: no login, got: ${none.login}`);

    assertEq(writeLogin(cmdHome, { token: 'ghu_status', login: 'octocat' }), file, 'the fixture writes where the store reads');
    const signed = status();
    assertEq(signed.signedIn, true, 'a file holding a token: signed in');
    assertEq(signed.login, 'octocat', 'and the login it holds');

    fs.writeFileSync(file, `${JSON.stringify({ login: 'octocat' })}\n`);
    assertEq(status().signedIn, false, 'a file holding no token: not signed in');
    writeLogin(cmdHome, { token: '', login: 'octocat' });
    assertEq(status().signedIn, false, 'an empty token: not signed in');

    // No logout form: removing the file is how one signs out.
    writeLogin(cmdHome, { token: 'ghu_status', login: 'octocat' });
    const out = command(cmdHome, ['--logout']);
    assertEq(out.status, 1, `--logout is the usage error, exit 1, stderr: ${out.stderr}`);
    assert(/usage/i.test(out.stderr), `stderr carries the usage, got: ${out.stderr}`);
    assertEq(out.stdout, '', `nothing on stdout, got: ${out.stdout}`);
    assertEq(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))), JSON.stringify({ token: 'ghu_status', login: 'octocat' }),
      'the login file is left as it was');
    assertEq(status().signedIn, true, 'still signed in');
  });

  group('identity/login: the browser opener');

  // The device-flow stand-in for the --open runs: a code, a granted first poll, /user as hubot.
  const OPEN_ROUTES = deviceFlowRoutes({ userCode: 'WDJB-MJHT', accessToken: 'ghu_opened', login: 'hubot' });
  const openedLogin = (h) => JSON.parse(fs.readFileSync(path.join(h, '.workkit', 'identity', 'login.json'), 'utf8'));

  await testUnless(IS_WINDOWS, NO_NODE_STUB)(
    'case 21: --open <opener> prints the page and the code and runs the opener once with the page as its one argument; without --open nothing runs', async () => {
      const bin = mkTmp('wk-login-open-bin-');
      const openerLog = path.join(bin, 'opener-argv.log');
      stubTool(bin, 'wk-opener', ['#!/usr/bin/env bash', recordArgv(openerLog), 'exit 0']);
      const server = await startServer(OPEN_ROUTES, mkTmp('wk-login-open-server-'));
      try {
        const env = { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url, PATH: pathWith(bin) };
        // The plain run first: the opener may run detached, so its one call is awaited after both.
        const plainHome = mkTmp('wk-login-plain-home-');
        const plain = command(plainHome, [], env);
        assertEq(plain.status, 0, `node login.js with no --open exits 0, stderr: ${plain.stderr}`);
        assertEq(JSON.stringify(openedLogin(plainHome)), JSON.stringify({ token: 'ghu_opened', login: 'hubot' }), 'the plain flow signs in');

        const cmdHome = mkTmp('wk-login-open-home-');
        const res = command(cmdHome, ['--open', 'wk-opener'], env);
        assertEq(res.status, 0, `node login.js --open exits 0, stderr: ${res.stderr}`);
        const said = `${res.stdout}${res.stderr}`;
        assert(said.includes('WDJB-MJHT'), `it prints the user code, got: ${said}`);
        assert(said.includes('https://github.com/login/device'), `and the verification page, got: ${said}`);
        assertEq(JSON.stringify(openedLogin(cmdHome)), JSON.stringify({ token: 'ghu_opened', login: 'hubot' }), 'the flow finished into the login file');

        assert(await until(() => readArgv(openerLog).length > 0), 'the opener ran');
        await until(() => readArgv(openerLog).length > 1, 500);
        assertEq(JSON.stringify(readArgv(openerLog)), JSON.stringify([['https://github.com/login/device']]),
          'one opener call across both runs, handed the verification page alone: none without --open');
      } finally {
        await server.close();
      }
    },
  );

  await test('case 21: an opener that cannot start is one could-not-open line and the flow goes on; --open with no name, with two, or with a flag for one is the usage error, naming no node', async () => {
    const cmdHome = mkTmp('wk-login-noopen-home-');
    const server = await startServer(OPEN_ROUTES, mkTmp('wk-login-noopen-server-'));
    try {
      const res = command(cmdHome, ['--open', 'wk-no-such-opener'], { GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });
      assertEq(res.status, 0, `an opener that cannot start still exits 0, stderr: ${res.stderr}`);
      const lines = res.stderr.split('\n').filter((l) => l.includes('could not open the browser'));
      assertEq(lines.length, 1, `one could-not-open line on stderr, got: ${res.stderr}`);
      assert(`${res.stdout}${res.stderr}`.includes('WDJB-MJHT'), `the code is still printed, got: ${res.stdout}${res.stderr}`);
      assertEq(JSON.stringify(openedLogin(cmdHome)), JSON.stringify({ token: 'ghu_opened', login: 'hubot' }), 'the flow finished into the login file');
    } finally {
      await server.close();
    }

    // The stand-in is GitHub: a flow started, and so an opener run, would show as a request.
    const usageHome = mkTmp('wk-login-open-usage-home-');
    const github = await startServer(OPEN_ROUTES, mkTmp('wk-login-open-usage-server-'));
    try {
      for (const args of [['--open'], ['--open', 'open', 'xdg-open'], ['--open', '--status']]) {
        const out = command(usageHome, args, { GITHUB_SERVER_URL: github.url, GITHUB_API_URL: github.url });
        assertEq(out.status, 1, `${args.join(' ')}: the usage error, exit 1, stderr: ${out.stderr}`);
        assert(out.stderr.includes(USAGE), `${args.join(' ')}: stderr carries the usage, got: ${out.stderr}`);
        assert(!out.stderr.includes('usage: node'), `${args.join(' ')}: the usage names no node, got: ${out.stderr}`);
        assertEq(fs.existsSync(path.join(usageHome, '.workkit', 'identity', 'login.json')), false, `${args.join(' ')}: no login file`);
      }
      assertEq(github.requests().length, 0, `no flow started, so no opener ran, got: ${JSON.stringify(github.requests())}`);
    } finally {
      await github.close();
    }
  });

  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
