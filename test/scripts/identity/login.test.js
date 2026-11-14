// Tests for workflow/identity/login.js: GitHub's device flow and the login store
// it writes. Real files in a scratch home; `signIn` takes a recording fake
// `fetch` and `sleep`, and the command form runs against a local GitHub stand-in.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, before, after, until, SPAWN_DEADLINE, mkTmp,
} = require('../../lib/harness');
const {
  IS_WINDOWS, skipWithoutNodeStub, stubTool, pathWith,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { caught } = require('../../lib/caught');
const {
  DEVICE_CODE, deviceFlowRoutes, readWrittenLogin, collector, json, startServer, scratchEnv, hostsOf,
} = require('../../lib/identity');

const KIT = path.join(__dirname, '..', '..', '..');
const MODULE = path.join(KIT, 'workflow', 'identity', 'login.js');
const APP = path.join(KIT, 'workflow', 'identity', 'app.js');

// Required per case, so a module not yet built fails each case by name.
const load = () => require(MODULE);

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const USAGE = 'usage: login.js [--open <opener>]';

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
const command = (home, args, extra = {}) => spawnSync(process.execPath, [MODULE, ...args],
  { env: scratchEnv(home, extra), encoding: 'utf8', timeout: SPAWN_DEADLINE });

// loginFile() resolves under ~/.workkit; this process's home is a scratch one.
const home = mkTmp('wk-login-home-');
const loginPath = path.join(home, '.workkit', 'identity', 'login.json');
const envBefore = {};
before(() => {
  for (const key of ['HOME', 'USERPROFILE', 'WORKFLOW_HOME', 'GITHUB_SERVER_URL', 'GITHUB_API_URL']) envBefore[key] = process.env[key];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.WORKFLOW_HOME;
  delete process.env.GITHUB_SERVER_URL;
  delete process.env.GITHUB_API_URL;
});
after(() => {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('identity/login: the device flow', () => {
  test('case 8: signIn posts the Client ID, prints the code and page, polls at the interval (+5 on slow_down), and writes { token, login } from /user', async () => {
    const { signIn, loginFile } = load();
    const { CLIENT_ID } = require(APP);
    expect(typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0, `app.js exports a Client ID, got: ${CLIENT_ID}`).toBeTruthy();
    expect(loginFile(), 'loginFile() is <home>/.workkit/identity/login.json').toBe(loginPath);

    const flow = fakeFlow([
      { error: 'authorization_pending' },
      { error: 'slow_down' },
      { access_token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a', token_type: 'bearer', scope: '' },
    ]);
    const { out, text } = collector();
    const entry = await signIn({ fetch: flow.fetch, sleep: flow.sleep, out });

    const device = flow.calls.filter((c) => c.url === 'https://github.com/login/device/code');
    expect(device.length, 'one device-code request').toBe(1);
    expect(device[0].method, 'the device code is a POST').toBe('POST');
    expect(fieldsOf(device[0].body).client_id, 'carrying the App\'s Client ID').toBe(CLIENT_ID);
    expect(device[0].headers.get('accept'), 'asking for JSON, since GitHub answers form-encoded without it').toBe('application/json');

    const said = text();
    expect(said.includes('WDJB-MJHT'), `out names the user code, got: ${said}`).toBeTruthy();
    expect(said.includes('https://github.com/login/device'), `out names the verification page, got: ${said}`).toBeTruthy();

    const polls = flow.calls.filter((c) => c.url === 'https://github.com/login/oauth/access_token');
    expect(polls.length, 'three polls: pending, slow_down, granted').toBe(3);
    for (const poll of polls) {
      expect(poll.method, 'a poll is a POST').toBe('POST');
      const fields = fieldsOf(poll.body);
      expect(fields.device_code, 'the poll carries the device code').toBe(DEVICE_CODE.device_code);
      expect(fields.grant_type, 'and the device-code grant type').toBe(GRANT_TYPE);
    }
    // The sleep seam takes milliseconds, as setTimeout does.
    expect(JSON.stringify(flow.sleeps), 'the server\'s interval, then five seconds more after slow_down').toBe(JSON.stringify([5000, 10000]));

    const user = flow.calls.filter((c) => c.url === 'https://api.github.com/user');
    expect(user.length, 'one /user read').toBe(1);
    expect(String(user[0].headers.get('authorization')).includes('ghu_16C7e42F292c6912E7710c838347Ae178B4a'),
      `the /user read carries the new token, got: ${user[0].headers.get('authorization')}`).toBeTruthy();

    const stored = readWrittenLogin(home);
    expect(JSON.stringify(stored), 'the file holds { token, login }').toBe(JSON.stringify({ token: 'ghu_16C7e42F292c6912E7710c838347Ae178B4a', login: 'octocat' }));
    expect(JSON.stringify(entry), 'signIn returns the entry it wrote').toBe(JSON.stringify(stored));

    // The command form signs in the same way against a local GitHub stand-in.
    const cmdHome = mkTmp('wk-login-cmd-home-');
    const server = await startServer(deviceFlowRoutes({ userCode: 'WDJB-MJHT', accessToken: 'ghu_fromcommand', login: 'hubot' }), cmdHome);
    try {
      const res = command(cmdHome, [], hostsOf(server));
      expect(res.status, `node login.js exits 0, stderr: ${res.stderr}`).toBe(0);
      expect(`${res.stdout}${res.stderr}`.includes('WDJB-MJHT'), `the command prints the user code, got: ${res.stdout}${res.stderr}`).toBeTruthy();
      expect(JSON.stringify(readWrittenLogin(cmdHome)), 'the command writes { token, login }').toBe(JSON.stringify({ token: 'ghu_fromcommand', login: 'hubot' }));
      const posted = server.requests().find((r) => r.url === '/login/device/code');
      expect(posted && fieldsOf(posted.body).client_id === CLIENT_ID, `the command posts the Client ID, got: ${JSON.stringify(server.requests())}`).toBeTruthy();
    } finally {
      await server.close();
    }
  });

  test(
    'case 8 (POSIX): the login folder is 0700 and the file 0600', { skip: IS_WINDOWS && 'Windows keeps no POSIX permission bits to read 0700 and 0600 back from' }, async () => {
      expect(fs.existsSync(loginPath), 'case 8 wrote the login file').toBeTruthy();
      expect((fs.statSync(path.dirname(loginPath)).mode & 0o777).toString(8), 'the folder: owner only').toBe('700');
      expect((fs.statSync(loginPath).mode & 0o777).toString(8), 'the file: owner read and write only').toBe('600');
    },
  );

  test('case 9: access_denied and expired_token throw naming the reason, and nothing is written', async () => {
    const { signIn } = load();
    for (const [reason, pattern] of [['access_denied', /denied/i], ['expired_token', /expired/i]]) {
      fs.rmSync(loginPath, { force: true });
      const flow = fakeFlow([{ error: reason }]);
      const err = await caught(() => signIn({ fetch: flow.fetch, sleep: flow.sleep, out: collector().out }));
      expect(err, `${reason}: signIn throws, got a return`).toBeInstanceOf(Error);
      expect(pattern.test(err.message), `${reason}: the error names the reason, got: ${err.message}`).toBeTruthy();
      expect(fs.existsSync(loginPath), `${reason}: no login file`).toBe(false);
      expect(flow.calls.filter((c) => c.url === 'https://api.github.com/user').length, `${reason}: no /user read`).toBe(0);
    }
  });
});

describe('identity/login: the browser opener', () => {
  // The device-flow stand-in for the --open runs: a code, a granted first poll, /user as hubot.
  const OPEN_ROUTES = deviceFlowRoutes({ userCode: 'WDJB-MJHT', accessToken: 'ghu_opened', login: 'hubot' });

  test(
    'case 21: --open <opener> prints the page and the code and runs the opener once with the page as its one argument; without --open nothing runs', { skip: skipWithoutNodeStub() }, async () => {
      const bin = mkTmp('wk-login-open-bin-');
      const openerLog = path.join(bin, 'opener-argv.log');
      stubTool(bin, 'wk-opener', ['#!/usr/bin/env bash', recordArgv(openerLog), 'exit 0']);
      const server = await startServer(OPEN_ROUTES, mkTmp('wk-login-open-server-'));
      try {
        const env = { ...hostsOf(server), PATH: pathWith(bin) };
        // The plain run first: the opener may run detached, so its one call is awaited after both.
        const plainHome = mkTmp('wk-login-plain-home-');
        const plain = command(plainHome, [], env);
        expect(plain.status, `node login.js with no --open exits 0, stderr: ${plain.stderr}`).toBe(0);
        expect(JSON.stringify(readWrittenLogin(plainHome)), 'the plain flow signs in').toBe(JSON.stringify({ token: 'ghu_opened', login: 'hubot' }));

        const cmdHome = mkTmp('wk-login-open-home-');
        const res = command(cmdHome, ['--open', 'wk-opener'], env);
        expect(res.status, `node login.js --open exits 0, stderr: ${res.stderr}`).toBe(0);
        const said = `${res.stdout}${res.stderr}`;
        expect(said.includes('WDJB-MJHT'), `it prints the user code, got: ${said}`).toBeTruthy();
        expect(said.includes('https://github.com/login/device'), `and the verification page, got: ${said}`).toBeTruthy();
        expect(JSON.stringify(readWrittenLogin(cmdHome)), 'the flow finished into the login file').toBe(JSON.stringify({ token: 'ghu_opened', login: 'hubot' }));

        expect(await until(() => readArgv(openerLog).length > 0), 'the opener ran').toBeTruthy();
        await until(() => readArgv(openerLog).length > 1, 500);
        expect(JSON.stringify(readArgv(openerLog)), 'one opener call across both runs, handed the verification page alone: none without --open').toBe(JSON.stringify([['https://github.com/login/device']]));
      } finally {
        await server.close();
      }
    },
  );

  test('case 21: an opener that cannot start is one could-not-open line and the flow goes on; --open with no name, with two, or with a flag for one, and --status, are the usage error, naming no node', async () => {
    const cmdHome = mkTmp('wk-login-noopen-home-');
    const server = await startServer(OPEN_ROUTES, mkTmp('wk-login-noopen-server-'));
    try {
      const res = command(cmdHome, ['--open', 'wk-no-such-opener'], hostsOf(server));
      expect(res.status, `an opener that cannot start still exits 0, stderr: ${res.stderr}`).toBe(0);
      const lines = res.stderr.split('\n').filter((l) => l.includes('could not open the browser'));
      expect(lines.length, `one could-not-open line on stderr, got: ${res.stderr}`).toBe(1);
      expect(`${res.stdout}${res.stderr}`.includes('WDJB-MJHT'), `the code is still printed, got: ${res.stdout}${res.stderr}`).toBeTruthy();
      expect(JSON.stringify(readWrittenLogin(cmdHome)), 'the flow finished into the login file').toBe(JSON.stringify({ token: 'ghu_opened', login: 'hubot' }));
    } finally {
      await server.close();
    }

    // The stand-in is GitHub: a flow started, and so an opener run, would show as a request.
    const usageHome = mkTmp('wk-login-open-usage-home-');
    const github = await startServer(OPEN_ROUTES, mkTmp('wk-login-open-usage-server-'));
    try {
      for (const args of [['--open'], ['--open', 'open', 'xdg-open'], ['--open', '--status'], ['--status']]) {
        const out = command(usageHome, args, hostsOf(github));
        expect(out.status, `${args.join(' ')}: the usage error, exit 1, stderr: ${out.stderr}`).toBe(1);
        expect(out.stderr.includes(USAGE), `${args.join(' ')}: stderr carries the usage, got: ${out.stderr}`).toBeTruthy();
        expect(!out.stderr.includes('usage: node'), `${args.join(' ')}: the usage names no node, got: ${out.stderr}`).toBeTruthy();
        expect(fs.existsSync(path.join(usageHome, '.workkit', 'identity', 'login.json')), `${args.join(' ')}: no login file`).toBe(false);
      }
      expect(github.requests().length, `no flow started, so no opener ran, got: ${JSON.stringify(github.requests())}`).toBe(0);
    } finally {
      await github.close();
    }
  });
});
