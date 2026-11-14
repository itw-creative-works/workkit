// Tests for `workkit setup`'s Identity step (the sign-in, offered at a keyboard
// and named otherwise), `setup --login` (that step alone and forced), the App
// install offer under This repo, and `setup --bot` (that offer alone and forced).
// Each setup run is a scratch kit with the user's dir the scratch home's ~/.workkit.
// The world has no node unless a case adds it: without it the step is a named
// skip. GitHub is never reached: its hosts point at a local stand-in or nothing.
// The shared prologue is ../workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, WORKKIT_DIR: W, until,
} = require('../../lib/harness');
const {
  skipWithoutNodeStub, shellPath,
} = require('../../lib/platform');
const {
  INSTALL_FIX, PRESELECTED, UNREADABLE, hostsOf, deviceFlowRoutes, repoRoute, writeLogin, readWrittenLogin, useTokenService, startServer,
} = require('../../lib/identity');
const { mkOriginRepo } = require('../../lib/git-repo');
const {
  cleanup, mkWorld, runCli, signInEnv, mkRepo, rosterRepo, mkSetupKit, inCli, AT_TERMINAL,
} = require('../workkit-cli/helpers');

/**
 * Runs `fn({ world, kit, script, repo, server })` in a fresh scratch world (made
 * with `worldOpts`), setup kit and opted-in repo, `server` a local stand-in
 * answering `routes`, then closes and removes them all; resolves to what `fn` does.
 */
const withSetupScene = async (routes, fn, worldOpts = {}) => {
  const world = mkWorld(worldOpts);
  const { kit, script } = mkSetupKit();
  const repo = mkRepo({ optIn: true });
  const server = await startServer(routes, world.root);
  try {
    return await fn({
      world, kit, script, repo, server,
    });
  } finally {
    await server.close();
    cleanup(world.root); cleanup(kit); cleanup(repo);
  }
};

/**
 * Asserts login.js opened the device page once with the world's opener. It
 * runs the opener detached, so a first call is awaited for until's own default,
 * the budget the login suite gives the same opener, then a moment more for a
 * second. Written before the stub launcher, it still skips on Windows, as a
 * skipped subcase of the case `t` runs.
 */
const assertDevicePageOpened = async (t, world, label) => {
  const skip = skipWithoutNodeStub();
  if (skip) {
    await t.test(`${label}: the world's opener records the device page`, { skip });
    return;
  }
  await until(() => world.openerCalls().length > 0);
  await until(() => world.openerCalls().length > 1, 300);
  expect(JSON.stringify(world.openerCalls()), `${label}: the opener ran once, on the device page`).toBe(JSON.stringify([['https://github.com/login/device']]));
};

/** `cmd_setup <args>` at the terminal seam from `repo`, the answers on stdin. */
const setupAtTerminal = (world, { repo, script, input = '', env, args = '' }) => inCli(
  world, `${AT_TERMINAL}\ncd ${JSON.stringify(shellPath(repo))}\ncmd_setup${args ? ` ${args}` : ''}`,
  { entry: script, input, env },
);

// A GitHub stand-in that finishes a device flow at once, signing in as hubot.
const SIGN_IN_ROUTES = deviceFlowRoutes({ userCode: 'CLIX-0020', accessToken: 'ghu_fromcli', login: 'hubot' });

/** The device-code requests a GitHub stand-in got. */
const deviceRequests = (github) => github.requests().filter((r) => r.method === 'POST' && r.url === '/login/device/code');

/**
 * Run `workkit setup` with no terminal in a fresh scene whose GitHub is the
 * sign-in stand-in; `before` prepares the world, `node: false` leaves node off PATH.
 */
const setup = ({ node = true, before = () => {} } = {}) => withSetupScene(SIGN_IN_ROUTES, async ({
  world, kit, script, repo, server,
}) => {
  before(world);
  const res = runCli(world, ['setup'], { cwd: repo, script, env: signInEnv(world, { node, extra: hostsOf(server) }) });
  return {
    ...res, envMade: fs.existsSync(path.join(kit, '.env')), opened: world.openerCalls(), device: deviceRequests(server),
  };
});

const SIGN_IN_QUESTION = 'Sign in to GitHub now, so the agent\'s issue bookkeeping posts as workkit-agent[bot]? [Y/n]';
const INSTALL_QUESTION = 'Install workkit-agent[bot] on acme now? [Y/n]';
// The id GitHub's stand-in answers for acme, and the install page pre-selected on it.
const OWNER_ID = 4242;
const INSTALL_NEW = `${PRESELECTED}${OWNER_ID}`;
// After a rename the remote still spells Old; GitHub's canonical owner is New, id 7.
const RENAMED = { remote: 'Old/rostered', github: ['New/rostered', 7] };
const INSTALLED = 'identity: workkit-agent[bot] installed on acme/rostered';
const POLL_KEYS = '(enter)=check now, (s)=skip';
const NOT_INSTALLED = { status: 412, body: JSON.stringify({ error: 'not installed', fix: INSTALL_FIX }) };
const MINTED = { status: 200, body: JSON.stringify({ token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' }) };

/** The lines saying workkit-agent[bot] is not installed, carrying `page`, the pre-selected install page unless given. */
const installWarnings = (said, page = INSTALL_NEW) => said.split('\n').filter((l) => /not installed/.test(l) && l.includes(page));

/**
 * Run `workkit setup` (`setup --bot` when `bot`) in a scratch repo whose origin
 * is `remote` (none when `origin` is false): opted in unless `optIn` is
 * false, on the roster when `rostered`, signed in unless `signedIn` is false,
 * the token service a stand-in answering `POST /token` with `answers` in
 * order. At the terminal seam when
 * `input` is given, else with no terminal. The same stand-in is GitHub's API,
 * answering `GET /repos/<remote>` with `github`'s `[full name, owner id]`, a 501
 * when null; `idReads` are its reads of that repo. The install page opens in the
 * shell, so its call is read at once.
 */
const installSetup = ({
  signedIn = true, optIn = true, rostered = false, answers, input, bot = false, origin = true,
  remote = 'acme/rostered', github = ['acme/rostered', OWNER_ID],
}) => withSetupScene([
  { method: 'POST', url: '/token', answers },
  ...(github ? [repoRoute(remote, ...github)] : []),
], async ({
  world, script, repo, server,
}) => {
  const env = signInEnv(world, { extra: { GITHUB_API_URL: server.url } });
  if (rostered) rosterRepo(world, repo, remote, { script, env });
  else if (origin) mkOriginRepo(repo, `https://github.com/${remote}.git`);
  if (!optIn) fs.rmSync(path.join(repo, W, 'settings.json'));
  if (signedIn) writeLogin(world.home, { token: 'ghu_setupuser', login: 'octocat' });
  useTokenService(world.home, `${server.url}/token`);
  const res = input === undefined
    ? runCli(world, ['setup', ...(bot ? ['--bot'] : [])], { cwd: repo, script, env })
    : setupAtTerminal(world, {
      repo, script, input, env, args: bot ? '--bot' : '',
    });
  const asked = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
  const idReads = server.requests().filter((r) => r.method === 'GET' && r.url === `/repos/${remote}`);
  return {
    ...res, asked, idReads, opened: world.openerCalls(), claudeCalls: world.claudeCalls(),
  };
});

describe('workkit setup: identity', () => {
  test('case 18: not signed in with no keyboard warns naming workkit setup --login and starts no device flow; signed in says so; no node is the named skip; no .env is made', async () => {
    const bare = await setup();
    expect(bare.device.length, `no keyboard: no device flow started, got: ${JSON.stringify(bare.device)}`).toBe(0);
    expect(bare.said.includes('workkit setup --login'), `the warning names workkit setup --login, got: ${bare.said}`).toBeTruthy();
    expect(!bare.said.includes('workkit login'), `and no longer workkit login, got: ${bare.said}`).toBeTruthy();
    expect(!bare.said.includes('signed in as @'), `and names no login, got: ${bare.said}`).toBeTruthy();
    expect(bare.envMade, 'not signed in: no .env at the kit root').toBe(false);
    expect(!bare.said.includes(SIGN_IN_QUESTION), `no keyboard: no sign-in question, got: ${bare.said}`).toBeTruthy();
    expect(JSON.stringify(bare.opened), 'no keyboard: no browser opened').toBe('[]');

    const signed = await setup({ before: (world) => writeLogin(world.home, { token: 'ghu_setupuser', login: 'octocat' }) });
    expect(signed.said.includes('identity: signed in as @octocat'), `it names the login, got: ${signed.said}`).toBeTruthy();
    expect(signed.envMade, 'signed in: no .env at the kit root').toBe(false);

    const noNode = await setup({ node: false });
    expect(/identity: [^\n]*needs node/.test(noNode.said), `the step is the named node skip, got: ${noNode.said}`).toBeTruthy();
    expect(!noNode.said.includes('signed in as @'), `and reads no sign-in, got: ${noNode.said}`).toBeTruthy();
    expect(noNode.envMade, 'no node: no .env at the kit root').toBe(false);
  });

  test('case 22: not signed in at a keyboard, Enter, y or YES answers the sign-in question by signing in with the device page opened', async (t) => {
    for (const input of ['\n', 'y\n', 'YES\n']) {
      const label = JSON.stringify(input);
      await withSetupScene(SIGN_IN_ROUTES, async ({
        world, script, repo, server,
      }) => {
        const res = setupAtTerminal(world, { repo, script, input, env: signInEnv(world, { extra: hostsOf(server) }) });
        expect(res.said.includes(SIGN_IN_QUESTION), `${label}: setup puts the sign-in question, got: ${res.said}`).toBeTruthy();
        expect(res.said.includes('CLIX-0020'), `${label}: the sign-in prints the user code, got: ${res.said}`).toBeTruthy();
        expect(deviceRequests(server).length, `${label}: one device-code request, got: ${JSON.stringify(server.requests())}`).toBe(1);
        expect(JSON.stringify(readWrittenLogin(world.home)), `${label}: the login file holds the stand-in's sign-in`).toBe(JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }));
        expect(res.said.includes('identity: signed in as @hubot'), `${label}: the step then says who is signed in, got: ${res.said}`).toBeTruthy();
        await assertDevicePageOpened(t, world, `case 22 ${label}`);
      });
    }
  });

  test('case 22: not signed in at a keyboard, n, no, or stdin ending at the question (Ctrl-D) warns naming workkit setup --login and starts no device flow', async () => {
    for (const input of ['n\n', 'no\n', '']) {
      const label = JSON.stringify(input);
      await withSetupScene(SIGN_IN_ROUTES, async ({
        world, script, repo, server,
      }) => {
        const res = setupAtTerminal(world, { repo, script, input, env: signInEnv(world, { extra: hostsOf(server) }) });
        expect(res.said.includes(SIGN_IN_QUESTION), `${label}: setup puts the sign-in question, got: ${res.said}`).toBeTruthy();
        expect(/not signed in[^\n]*workkit setup --login/.test(res.said), `${label}: the warning naming workkit setup --login, got: ${res.said}`).toBeTruthy();
        expect(server.requests().length, `${label}: no device-code request, got: ${JSON.stringify(server.requests())}`).toBe(0);
        expect(fs.existsSync(path.join(world.home, '.workkit', 'identity', 'login.json')), `${label}: no login file`).toBe(false);
        expect(JSON.stringify(world.openerCalls()), `${label}: no browser opened`).toBe('[]');
      });
    }
  });
});

describe('workkit setup --login', () => {
  test('case 20, 22: setup --login at a terminal asks nothing, opens the device page and runs the device flow into the login file, replacing the sign-in already there, and nothing else of setup', async (t) => {
    await withSetupScene(SIGN_IN_ROUTES, async ({ world, script, server }) => {
      writeLogin(world.home, { token: 'ghu_cliuser', login: 'octocat' });
      const res = inCli(world, `${AT_TERMINAL}\ncmd_setup --login`, {
        entry: script,
        env: signInEnv(world, { extra: hostsOf(server) }),
      });
      expect(res.code, `setup --login exits 0, got: ${res.said}`).toBe(0);
      expect(res.said.includes('CLIX-0020'), `it prints the user code, got: ${res.said}`).toBeTruthy();
      expect(deviceRequests(server).length, `one device-code request although already signed in, got: ${JSON.stringify(server.requests())}`).toBe(1);
      expect(JSON.stringify(readWrittenLogin(world.home)), 'the new sign-in replaces the old').toBe(JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }));

      expect(!fs.existsSync(world.link), 'no workkit symlink written').toBeTruthy();
      expect(!world.claudeCalls().some((c) => c.includes('install')), 'no plugin install').toBeTruthy();
      for (const title of ['Home repo', 'Dashboard site', 'This repo']) {
        expect(!res.said.includes(title), `no "${title}" section, got: ${res.said}`).toBeTruthy();
      }
      expect(!res.said.includes(SIGN_IN_QUESTION), `setup --login puts no question, got: ${res.said}`).toBeTruthy();
      await assertDevicePageOpened(t, world, 'case 22: setup --login');
    });
  });

  test('case 20: setup --login without a terminal runs the device flow into the login file, prints the code and opens the device page', async (t) => {
    await withSetupScene(SIGN_IN_ROUTES, async ({
      world, script, repo, server,
    }) => {
      writeLogin(world.home, { token: 'ghu_cliuser', login: 'octocat' });
      const res = runCli(world, ['setup', '--login'], {
        cwd: repo, script, env: signInEnv(world, { extra: hostsOf(server) }),
      });
      expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
      expect(res.said.includes('CLIX-0020'), `it prints the user code, got: ${res.said}`).toBeTruthy();
      expect(deviceRequests(server).length, `one device-code request, got: ${JSON.stringify(server.requests())}`).toBe(1);
      expect(JSON.stringify(readWrittenLogin(world.home)), 'the new sign-in replaces the old').toBe(JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }));
      expect(!/needs a terminal/.test(res.said), `it names no terminal, got: ${res.said}`).toBeTruthy();
      await assertDevicePageOpened(t, world, 'case 20: no terminal');
    });
  });

  test('case 20: setup --login without a terminal whose code is declined exits 1 saying the sign-in did not finish, the sign-in already there kept', async () => {
    const declined = SIGN_IN_ROUTES.map((r) => (r.url === '/login/oauth/access_token'
      ? { ...r, body: JSON.stringify({ error: 'access_denied' }) }
      : r));
    await withSetupScene(declined, async ({
      world, script, repo, server,
    }) => {
      const loginFile = writeLogin(world.home, { token: 'ghu_cliuser', login: 'octocat' });
      const before = fs.readFileSync(loginFile, 'utf8');
      const res = runCli(world, ['setup', '--login'], {
        cwd: repo, script, env: signInEnv(world, { extra: hostsOf(server) }),
      });
      expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
      expect(res.said.includes('the sign-in did not finish'), `it says the sign-in did not finish, got: ${res.said}`).toBeTruthy();
      expect(fs.readFileSync(loginFile, 'utf8'), 'the sign-in already there is unchanged').toBe(before);
    });
  });
});

describe('workkit setup: the App install, This repo', () => {
  test('case 23: signed in in an opted-in repo off the roster, a 200 says installed with no question; not signed in, or an undecided repo on the roster, no line and no ask', async () => {
    const installed = await installSetup({ answers: [MINTED], input: '' });
    expect(installed.said.includes(INSTALLED), `the ok line names the repo, got: ${installed.said}`).toBeTruthy();
    expect(!installed.said.includes(INSTALL_QUESTION), `no install question, got: ${installed.said}`).toBeTruthy();
    expect(installed.asked.length, `the service was asked once, got: ${JSON.stringify(installed.asked)}`).toBe(1);
    expect(installed.asked.every((r) => r.auth === 'Bearer ghu_setupuser' && JSON.parse(r.body).repo === 'acme/rostered'),
      `with the login's bearer, for acme/rostered, got: ${JSON.stringify(installed.asked)}`).toBeTruthy();
    expect(JSON.stringify(installed.opened), 'nothing opened').toBe('[]');

    for (const [label, scene] of [
      ['not signed in', { signedIn: false }],
      ['an undecided repo on the roster', { optIn: false, rostered: true }],
    ]) {
      const res = await installSetup({ ...scene, answers: [NOT_INSTALLED] });
      expect(!/installed on acme\/rostered|not installed/.test(res.said), `${label}: no installation line, got: ${res.said}`).toBeTruthy();
      expect(!res.said.includes(INSTALL_QUESTION), `${label}: no install question, got: ${res.said}`).toBeTruthy();
      expect(res.asked.length, `${label}: the service is never asked, got: ${JSON.stringify(res.asked)}`).toBe(0);
      expect(JSON.stringify(res.opened), `${label}: nothing opened`).toBe('[]');
    }
  });

  test('case 23: a 412 at a keyboard, y opens the install page once and polls; Enter checks now, and its 200 is the ok line', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED, NOT_INSTALLED, MINTED], input: 'y\n\n' });
    expect(res.said.includes(INSTALL_QUESTION), `setup puts the install question, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'the opener ran once, on the install page').toBe(JSON.stringify([[INSTALL_NEW]]));
    expect(res.said.includes(POLL_KEYS), `the poll names its keys, got: ${res.said}`).toBeTruthy();
    expect(res.asked.length, `the step's lookup, the poll's first check, then the one Enter asked for, got: ${JSON.stringify(res.asked)}`).toBe(3);
    expect(res.said.includes(INSTALLED), `the third answer is the ok line, got: ${res.said}`).toBeTruthy();
    expect(installWarnings(res.said).length, `and no not-installed warning, got: ${res.said}`).toBe(0);
  });

  test('a 412 at a keyboard whose owner id GitHub cannot give, answered y, warns with the unreadable line, opens nothing and never polls', async () => {
    const res = await installSetup({
      answers: [NOT_INSTALLED, MINTED], input: 'y\n', remote: RENAMED.remote, github: null,
    });
    expect(res.said.includes(UNREADABLE), `the warning carries the line as said, got: ${res.said}`).toBeTruthy();
    expect(!res.said.includes('installations/new'), `no install page anywhere, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'nothing opened').toBe('[]');
    expect(!res.said.includes(POLL_KEYS), `no poll, got: ${res.said}`).toBeTruthy();
  });

  test('case 23: a 412 throughout, after a yes the poll skips on s, on stdin closing, or on stdin closing after an Enter, and the warning carries the install page', async () => {
    for (const [input, asks, why] of [
      ['y\ns', 2, 'the step\'s lookup and the poll\'s first check; s skips'],
      ['y\n', 2, 'the step\'s lookup and the poll\'s first check; the closed stdin skips'],
      ['\n\n', 3, 'Enter is the default yes; the step\'s lookup, the poll\'s first check, the Enter\'s; the closed stdin skips'],
    ]) {
      const label = JSON.stringify(input);
      const res = await installSetup({ answers: [NOT_INSTALLED], input });
      expect(res.said.includes(INSTALL_QUESTION), `${label}: setup puts the install question, got: ${res.said}`).toBeTruthy();
      expect(JSON.stringify(res.opened), `${label}: the opener ran once, on the install page`).toBe(JSON.stringify([[INSTALL_NEW]]));
      expect(res.said.includes(POLL_KEYS), `${label}: the poll names its keys, got: ${res.said}`).toBeTruthy();
      expect(res.asked.length, `${label}: ${why}, got: ${JSON.stringify(res.asked)}`).toBe(asks);
      expect(!res.said.includes(INSTALLED), `${label}: no ok line, got: ${res.said}`).toBeTruthy();
      expect(installWarnings(res.said).length > 0, `${label}: the warning carries the install page, got: ${res.said}`).toBeTruthy();
    }
  });

  test('case 23: a 412 answered n, no, or with stdin ending at the question (Ctrl-D), or with no keyboard, is the warning with the install page and nothing opened', async () => {
    for (const input of ['n\n', 'no\n', '']) {
      const label = JSON.stringify(input);
      const declined = await installSetup({ answers: [NOT_INSTALLED], input });
      expect(declined.said.includes(INSTALL_QUESTION), `${label}: setup puts the install question, got: ${declined.said}`).toBeTruthy();
      expect(installWarnings(declined.said).length > 0, `${label}: the warning carries the pre-selected install page, got: ${declined.said}`).toBeTruthy();
      expect(declined.idReads.length, `${label}: the owner's id was read once, got: ${JSON.stringify(declined.idReads)}`).toBe(1);
      expect(JSON.stringify(declined.opened), `${label}: nothing opened`).toBe('[]');
      expect(declined.asked.length, `${label}: the service was asked once, got: ${JSON.stringify(declined.asked)}`).toBe(1);
    }

    const away = await installSetup({ answers: [NOT_INSTALLED] });
    expect(!away.said.includes(INSTALL_QUESTION), `no keyboard: no install question, got: ${away.said}`).toBeTruthy();
    expect(installWarnings(away.said).length > 0, `no keyboard: the warning carries the pre-selected install page, got: ${away.said}`).toBeTruthy();
    expect(away.idReads.length, `no keyboard: the owner's id was read once, got: ${JSON.stringify(away.idReads)}`).toBe(1);
    expect(JSON.stringify(away.opened), 'no keyboard: nothing opened').toBe('[]');
    expect(away.asked.length, `no keyboard: the service was asked once, got: ${JSON.stringify(away.asked)}`).toBe(1);
  });
});

describe('workkit setup --bot', () => {
  test('setup --bot in an enabled repo whose owner lacks the App asks, opens the pre-selected page and polls; the 200 is the ok line, exit 0, and nothing else of setup runs', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED, NOT_INSTALLED, MINTED], input: 'y\n\n', bot: true });
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(res.said.includes(INSTALL_QUESTION), `it puts the install question, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'the opener ran once, on the pre-selected install page').toBe(JSON.stringify([[INSTALL_NEW]]));
    expect(res.said.includes(POLL_KEYS), `it polls, got: ${res.said}`).toBeTruthy();
    expect(res.said.includes(INSTALLED), `the poll's 200 is the ok line, got: ${res.said}`).toBeTruthy();
    expect(!res.claudeCalls.some((c) => c.includes('install')), 'no plugin install').toBeTruthy();
    for (const title of ['This machine', 'Home repo', 'Dashboard site']) {
      expect(!res.said.includes(title), `no "${title}" section, got: ${res.said}`).toBeTruthy();
    }
  });

  test('setup --bot when not signed in exits 1 naming workkit setup --login, asks the service nothing and opens nothing', async () => {
    const res = await installSetup({ signedIn: false, answers: [NOT_INSTALLED], bot: true });
    expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
    expect(/not signed in[^\n]*workkit setup --login/.test(res.said), `it says to run workkit setup --login first, got: ${res.said}`).toBeTruthy();
    expect(res.asked.length, `the service is never asked, got: ${JSON.stringify(res.asked)}`).toBe(0);
    expect(JSON.stringify(res.opened), 'nothing opened').toBe('[]');
  });

  test('setup --bot with the App not installed and no keyboard exits 1, its warning naming the pre-selected install page, nothing opened', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED], bot: true });
    expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
    expect(installWarnings(res.said).length > 0, `the warning names the pre-selected install page, got: ${res.said}`).toBeTruthy();
    expect(res.idReads.length, `the owner's id was read once, got: ${JSON.stringify(res.idReads)}`).toBe(1);
    expect(JSON.stringify(res.opened), 'nothing opened').toBe('[]');
  });

  test('case 6: setup --bot in a clone whose remote spells the old owner offers and warns on New with New\'s pre-selected page, and the opener gets that page', async () => {
    const page = `${PRESELECTED}7`;
    const res = await installSetup({
      answers: [NOT_INSTALLED], input: 'y\n', bot: true, ...RENAMED,
    });
    expect(res.said.includes('Install workkit-agent[bot] on New now? [Y/n]'), `the offer names New, got: ${res.said}`).toBeTruthy();
    expect(!res.said.includes('workkit-agent[bot] on Old'), `the old spelling is never the owner named, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'the opener ran once, on New\'s pre-selected page').toBe(JSON.stringify([[page]]));
    expect(res.said.split('\n').some((l) => l.includes('is not installed on') && l.includes('on New') && l.includes(page)),
      `the not-installed warning names New and its pre-selected page, got: ${res.said}`).toBeTruthy();
    expect(res.asked.length > 0 && res.asked.every((r) => JSON.parse(r.body).repo === 'New/rostered'),
      `the service was asked only under the canonical name, got: ${JSON.stringify(res.asked)}`).toBeTruthy();
  });

  test('case 6: setup --bot in a clone whose remote spells the old owner, with the repo unreadable from GitHub: the warning carries the unreadable line and nothing opens', async () => {
    const res = await installSetup({
      answers: [NOT_INSTALLED], bot: true, remote: RENAMED.remote, github: null,
    });
    expect(res.said.includes(UNREADABLE), `the warning carries the line as said, got: ${res.said}`).toBeTruthy();
    expect(!res.said.includes('installations/new'), `no install page anywhere, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'nothing opened').toBe('[]');
  });

  test('setup --bot in a repo with no GitHub origin exits 1 saying so, and asks the service nothing', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED], bot: true, origin: false });
    expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
    expect(res.said.includes('has no GitHub origin to install workkit-agent[bot] for'), `the warning says there is no origin, got: ${res.said}`).toBeTruthy();
    expect(res.asked.length, `the service is never asked, got: ${JSON.stringify(res.asked)}`).toBe(0);
  });

  test('setup --bot where the App is already installed prints the installed line, exit 0, and asks nothing', async () => {
    const res = await installSetup({ answers: [MINTED], input: '', bot: true });
    expect(res.code, `exit 0, got: ${res.said}`).toBe(0);
    expect(res.said.includes(INSTALLED), `the ok line names the repo, got: ${res.said}`).toBeTruthy();
    expect(!res.said.includes(INSTALL_QUESTION), `no install question, got: ${res.said}`).toBeTruthy();
    expect(JSON.stringify(res.opened), 'nothing opened').toBe('[]');
  });
});
