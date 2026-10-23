// Tests for `workkit setup`'s Identity step (the sign-in, offered at a keyboard
// and named otherwise), `setup --login` (that step alone and forced), and the
// App install offer under This repo. Each setup run is a scratch kit with the
// user's dir the scratch home's ~/.workkit.
// The world has no node unless a case adds it: without it the step is a named
// skip. GitHub is never reached: its hosts point at a local stand-in or nothing.
// The shared prologue is ../workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, skip, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NO_NODE_STUB, shellPath,
} = require('../../lib/platform');
const {
  INSTALL_FIX, deviceFlowRoutes, writeLogin, readWrittenLogin, useTokenService, startServer,
} = require('../../lib/identity');
const { mkOriginRepo } = require('../../lib/git-repo');
const { until } = require('../../lib/process');
const { isCall } = require('../../lib/argv-log');
const {
  cleanup, mkWorld, runCli, signInEnv, mkRepo, rosterRepo, mkSetupKit, inCli, AT_TERMINAL,
} = require('../workkit-cli/helpers');

const hostsOf = (github) => ({ GITHUB_SERVER_URL: github.url, GITHUB_API_URL: github.url });

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
 * second. Windows names its skip: node cannot spawn the bash stub.
 */
const assertDevicePageOpened = async (world, label) => {
  if (IS_WINDOWS) {
    skip(`${label}: the world's opener records the device page`, NO_NODE_STUB);
    return;
  }
  await until(() => world.openerCalls().length > 0);
  await until(() => world.openerCalls().length > 1, 300);
  assertEq(JSON.stringify(world.openerCalls()), JSON.stringify([['https://github.com/login/device']]),
    `${label}: the opener ran once, on the device page`);
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
// The id the gh stub answers for acme, and the install page pre-selected on it.
const OWNER_ID = '4242';
const INSTALL_BARE = 'https://github.com/apps/workkit-agent/installations/new';
const INSTALL_NEW = `${INSTALL_BARE}/permissions?suggested_target_id=${OWNER_ID}`;
const INSTALLED = 'identity: workkit-agent[bot] installed on acme/rostered';
const POLL_KEYS = '(enter)=check now, (s)=skip';
const NOT_INSTALLED = { status: 412, body: JSON.stringify({ error: 'not installed', fix: INSTALL_FIX }) };
const MINTED = { status: 200, body: JSON.stringify({ token: 'ghs_probe', expires_at: '2099-01-01T00:00:00Z' }) };

/** The lines saying workkit-agent[bot] is not installed, carrying `page`, the pre-selected install page unless given. */
const installWarnings = (said, page = INSTALL_NEW) => said.split('\n').filter((l) => /not installed/.test(l) && l.includes(page));

/**
 * Run `workkit setup` in a scratch repo whose origin is acme/rostered: opted in
 * unless `optIn` is false, on the roster when `rostered`, signed in unless
 * `signedIn` is false, the token service a stand-in answering `POST /token`
 * with `answers` in order. At the terminal seam when `input` is given, else
 * with no terminal. The gh stub answers acme's id with `ownerId`, nothing when
 * empty. The install page opens in the shell, so its call is read at once.
 */
const installSetup = ({
  signedIn = true, optIn = true, rostered = false, answers, input, ownerId = OWNER_ID,
}) => withSetupScene([{ method: 'POST', url: '/token', answers }], async ({
  world, script, repo, server,
}) => {
  const env = signInEnv(world);
  if (rostered) rosterRepo(world, repo, 'acme/rostered', { script, env });
  else mkOriginRepo(repo, 'https://github.com/acme/rostered.git');
  if (!optIn) fs.rmSync(path.join(repo, W, 'settings.json'));
  if (signedIn) writeLogin(world.home, { token: 'ghu_setupuser', login: 'octocat' });
  useTokenService(world.home, `${server.url}/token`);
  const res = input === undefined
    ? runCli(world, ['setup'], { cwd: repo, script, env })
    : setupAtTerminal(world, { repo, script, input, env });
  const asked = server.requests().filter((r) => r.method === 'POST' && r.url === '/token');
  const idReads = world.ghCalls().filter((c) => isCall(c, 'api', 'users/acme'));
  return {
    ...res, asked, idReads, opened: world.openerCalls(),
  };
}, { ownerId });

const run = async () => {
  group('workkit setup: identity');

  await test('case 18: not signed in with no keyboard warns naming workkit setup --login and starts no device flow; signed in says so; no node is the named skip; no .env is made', async () => {
    const bare = await setup();
    assertEq(bare.device.length, 0, `no keyboard: no device flow started, got: ${JSON.stringify(bare.device)}`);
    assert(bare.said.includes('workkit setup --login'), `the warning names workkit setup --login, got: ${bare.said}`);
    assert(!bare.said.includes('workkit login'), `and no longer workkit login, got: ${bare.said}`);
    assert(!bare.said.includes('signed in as @'), `and names no login, got: ${bare.said}`);
    assertEq(bare.envMade, false, 'not signed in: no .env at the kit root');
    assert(!bare.said.includes(SIGN_IN_QUESTION), `no keyboard: no sign-in question, got: ${bare.said}`);
    assertEq(JSON.stringify(bare.opened), '[]', 'no keyboard: no browser opened');

    const signed = await setup({ before: (world) => writeLogin(world.home, { token: 'ghu_setupuser', login: 'octocat' }) });
    assert(signed.said.includes('identity: signed in as @octocat'), `it names the login, got: ${signed.said}`);
    assertEq(signed.envMade, false, 'signed in: no .env at the kit root');

    const noNode = await setup({ node: false });
    assert(/identity: [^\n]*needs node/.test(noNode.said), `the step is the named node skip, got: ${noNode.said}`);
    assert(!noNode.said.includes('signed in as @'), `and reads no sign-in, got: ${noNode.said}`);
    assertEq(noNode.envMade, false, 'no node: no .env at the kit root');
  });

  await test('case 22: not signed in at a keyboard, Enter, y or YES answers the sign-in question by signing in with the device page opened', async () => {
    for (const input of ['\n', 'y\n', 'YES\n']) {
      const label = JSON.stringify(input);
      await withSetupScene(SIGN_IN_ROUTES, async ({
        world, script, repo, server,
      }) => {
        const res = setupAtTerminal(world, { repo, script, input, env: signInEnv(world, { extra: hostsOf(server) }) });
        assert(res.said.includes(SIGN_IN_QUESTION), `${label}: setup puts the sign-in question, got: ${res.said}`);
        assert(res.said.includes('CLIX-0020'), `${label}: the sign-in prints the user code, got: ${res.said}`);
        assertEq(deviceRequests(server).length, 1, `${label}: one device-code request, got: ${JSON.stringify(server.requests())}`);
        assertEq(JSON.stringify(readWrittenLogin(world.home)), JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }), `${label}: the login file holds the stand-in's sign-in`);
        assert(res.said.includes('identity: signed in as @hubot'), `${label}: the step then says who is signed in, got: ${res.said}`);
        await assertDevicePageOpened(world, `case 22 ${label}`);
      });
    }
  });

  await test('case 22: not signed in at a keyboard, n, no, or stdin ending at the question (Ctrl-D) warns naming workkit setup --login and starts no device flow', async () => {
    for (const input of ['n\n', 'no\n', '']) {
      const label = JSON.stringify(input);
      await withSetupScene(SIGN_IN_ROUTES, async ({
        world, script, repo, server,
      }) => {
        const res = setupAtTerminal(world, { repo, script, input, env: signInEnv(world, { extra: hostsOf(server) }) });
        assert(res.said.includes(SIGN_IN_QUESTION), `${label}: setup puts the sign-in question, got: ${res.said}`);
        assert(/not signed in[^\n]*workkit setup --login/.test(res.said), `${label}: the warning naming workkit setup --login, got: ${res.said}`);
        assertEq(server.requests().length, 0, `${label}: no device-code request, got: ${JSON.stringify(server.requests())}`);
        assertEq(fs.existsSync(path.join(world.home, '.workkit', 'identity', 'login.json')), false, `${label}: no login file`);
        assertEq(JSON.stringify(world.openerCalls()), '[]', `${label}: no browser opened`);
      });
    }
  });

  group('workkit setup --login');

  await test('case 20, 22: setup --login at a terminal asks nothing, opens the device page and runs the device flow into the login file, replacing the sign-in already there, and nothing else of setup', async () => {
    await withSetupScene(SIGN_IN_ROUTES, async ({ world, script, server }) => {
      writeLogin(world.home, { token: 'ghu_cliuser', login: 'octocat' });
      const res = inCli(world, `${AT_TERMINAL}\ncmd_setup --login`, {
        entry: script,
        env: signInEnv(world, { extra: hostsOf(server) }),
      });
      assertEq(res.code, 0, `setup --login exits 0, got: ${res.said}`);
      assert(res.said.includes('CLIX-0020'), `it prints the user code, got: ${res.said}`);
      assertEq(deviceRequests(server).length, 1, `one device-code request although already signed in, got: ${JSON.stringify(server.requests())}`);
      assertEq(JSON.stringify(readWrittenLogin(world.home)), JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }), 'the new sign-in replaces the old');

      assert(!fs.existsSync(world.link), 'no workkit symlink written');
      assert(!world.claudeCalls().some((c) => c.includes('install')), 'no plugin install');
      for (const title of ['Home repo', 'Dashboard site', 'This repo']) {
        assert(!res.said.includes(title), `no "${title}" section, got: ${res.said}`);
      }
      assert(!res.said.includes(SIGN_IN_QUESTION), `setup --login puts no question, got: ${res.said}`);
      await assertDevicePageOpened(world, 'case 22: setup --login');
    });
  });

  await test('case 20: setup --login without a terminal runs the device flow into the login file, prints the code and opens the device page', async () => {
    await withSetupScene(SIGN_IN_ROUTES, async ({
      world, script, repo, server,
    }) => {
      writeLogin(world.home, { token: 'ghu_cliuser', login: 'octocat' });
      const res = runCli(world, ['setup', '--login'], {
        cwd: repo, script, env: signInEnv(world, { extra: hostsOf(server) }),
      });
      assertEq(res.code, 0, `exit 0, got: ${res.said}`);
      assert(res.said.includes('CLIX-0020'), `it prints the user code, got: ${res.said}`);
      assertEq(deviceRequests(server).length, 1, `one device-code request, got: ${JSON.stringify(server.requests())}`);
      assertEq(JSON.stringify(readWrittenLogin(world.home)), JSON.stringify({ token: 'ghu_fromcli', login: 'hubot' }),
        'the new sign-in replaces the old');
      assert(!/needs a terminal/.test(res.said), `it names no terminal, got: ${res.said}`);
      await assertDevicePageOpened(world, 'case 20: no terminal');
    });
  });

  await test('case 20: setup --login without a terminal whose code is declined exits 1 saying the sign-in did not finish, the sign-in already there kept', async () => {
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
      assertEq(res.code, 1, `exit 1, got: ${res.said}`);
      assert(res.said.includes('the sign-in did not finish'), `it says the sign-in did not finish, got: ${res.said}`);
      assertEq(fs.readFileSync(loginFile, 'utf8'), before, 'the sign-in already there is unchanged');
    });
  });

  group('workkit setup: the App install, This repo');

  await test('case 23: signed in in an opted-in repo off the roster, a 200 says installed with no question; not signed in, or an undecided repo on the roster, no line and no ask', async () => {
    const installed = await installSetup({ answers: [MINTED], input: '' });
    assert(installed.said.includes(INSTALLED), `the ok line names the repo, got: ${installed.said}`);
    assert(!installed.said.includes(INSTALL_QUESTION), `no install question, got: ${installed.said}`);
    assertEq(installed.asked.length, 1, `the service was asked once, got: ${JSON.stringify(installed.asked)}`);
    assert(installed.asked.every((r) => r.auth === 'Bearer ghu_setupuser' && JSON.parse(r.body).repo === 'acme/rostered'),
      `with the login's bearer, for acme/rostered, got: ${JSON.stringify(installed.asked)}`);
    assertEq(JSON.stringify(installed.opened), '[]', 'nothing opened');

    for (const [label, scene] of [
      ['not signed in', { signedIn: false }],
      ['an undecided repo on the roster', { optIn: false, rostered: true }],
    ]) {
      const res = await installSetup({ ...scene, answers: [NOT_INSTALLED] });
      assert(!/installed on acme\/rostered|not installed/.test(res.said), `${label}: no installation line, got: ${res.said}`);
      assert(!res.said.includes(INSTALL_QUESTION), `${label}: no install question, got: ${res.said}`);
      assertEq(res.asked.length, 0, `${label}: the service is never asked, got: ${JSON.stringify(res.asked)}`);
      assertEq(JSON.stringify(res.opened), '[]', `${label}: nothing opened`);
    }
  });

  await test('case 23: a 412 at a keyboard, y opens the install page once and polls; Enter checks now, and its 200 is the ok line', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED, NOT_INSTALLED, MINTED], input: 'y\n\n' });
    assert(res.said.includes(INSTALL_QUESTION), `setup puts the install question, got: ${res.said}`);
    assertEq(JSON.stringify(res.opened), JSON.stringify([[INSTALL_NEW]]), 'the opener ran once, on the install page');
    assert(res.said.includes(POLL_KEYS), `the poll names its keys, got: ${res.said}`);
    assertEq(res.asked.length, 3, `the step's lookup, the poll's first check, then the one Enter asked for, got: ${JSON.stringify(res.asked)}`);
    assert(res.said.includes(INSTALLED), `the third answer is the ok line, got: ${res.said}`);
    assertEq(installWarnings(res.said).length, 0, `and no not-installed warning, got: ${res.said}`);
    assertEq(res.idReads.length, 1, `the owner's id was read from gh once, got: ${JSON.stringify(res.idReads)}`);
  });

  await test('case 23: a 412 at a keyboard with a gh that answers nothing for the owner\'s id, y opens the bare install page once', async () => {
    const res = await installSetup({ answers: [NOT_INSTALLED, MINTED], input: 'y\n', ownerId: '' });
    assertEq(JSON.stringify(res.opened), JSON.stringify([[INSTALL_BARE]]), 'the opener ran once, on the bare install page');
    assert(res.said.includes(INSTALLED), `the poll's 200 is still the ok line, got: ${res.said}`);
    assertEq(res.idReads.length, 1, `the owner's id was asked for once, got: ${JSON.stringify(res.idReads)}`);
  });

  await test('case 23: a 412 throughout, after a yes the poll skips on s, on stdin closing, or on stdin closing after an Enter, and the warning carries the install page', async () => {
    for (const [input, asks, why] of [
      ['y\ns', 2, 'the step\'s lookup and the poll\'s first check; s skips'],
      ['y\n', 2, 'the step\'s lookup and the poll\'s first check; the closed stdin skips'],
      ['\n\n', 3, 'Enter is the default yes; the step\'s lookup, the poll\'s first check, the Enter\'s; the closed stdin skips'],
    ]) {
      const label = JSON.stringify(input);
      const res = await installSetup({ answers: [NOT_INSTALLED], input });
      assert(res.said.includes(INSTALL_QUESTION), `${label}: setup puts the install question, got: ${res.said}`);
      assertEq(JSON.stringify(res.opened), JSON.stringify([[INSTALL_NEW]]), `${label}: the opener ran once, on the install page`);
      assert(res.said.includes(POLL_KEYS), `${label}: the poll names its keys, got: ${res.said}`);
      assertEq(res.asked.length, asks, `${label}: ${why}, got: ${JSON.stringify(res.asked)}`);
      assert(!res.said.includes(INSTALLED), `${label}: no ok line, got: ${res.said}`);
      assert(installWarnings(res.said).length > 0, `${label}: the warning carries the install page, got: ${res.said}`);
    }
  });

  await test('case 23: a 412 answered n, no, or with stdin ending at the question (Ctrl-D), or with no keyboard, is the warning with the install page and nothing opened', async () => {
    for (const input of ['n\n', 'no\n', '']) {
      const label = JSON.stringify(input);
      const declined = await installSetup({ answers: [NOT_INSTALLED], input });
      assert(declined.said.includes(INSTALL_QUESTION), `${label}: setup puts the install question, got: ${declined.said}`);
      assert(installWarnings(declined.said).length > 0, `${label}: the warning carries the pre-selected install page, got: ${declined.said}`);
      assertEq(declined.idReads.length, 1, `${label}: the owner's id was read once, got: ${JSON.stringify(declined.idReads)}`);
      assertEq(JSON.stringify(declined.opened), '[]', `${label}: nothing opened`);
      assertEq(declined.asked.length, 1, `${label}: the service was asked once, got: ${JSON.stringify(declined.asked)}`);
    }

    const away = await installSetup({ answers: [NOT_INSTALLED] });
    assert(!away.said.includes(INSTALL_QUESTION), `no keyboard: no install question, got: ${away.said}`);
    assert(installWarnings(away.said).length > 0, `no keyboard: the warning carries the pre-selected install page, got: ${away.said}`);
    assertEq(away.idReads.length, 1, `no keyboard: the owner's id was read once, got: ${JSON.stringify(away.idReads)}`);
    assertEq(JSON.stringify(away.opened), '[]', 'no keyboard: nothing opened');
    assertEq(away.asked.length, 1, `no keyboard: the service was asked once, got: ${JSON.stringify(away.asked)}`);

    const bare = await installSetup({ answers: [NOT_INSTALLED], ownerId: '' });
    assert(installWarnings(bare.said, INSTALL_BARE).length > 0, `no keyboard, no id: the warning carries the bare install page, got: ${bare.said}`);
    assertEq(installWarnings(bare.said).length, 0, `no keyboard, no id: and never the pre-selected one, got: ${bare.said}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
