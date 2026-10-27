// Tests for workflow/identity/gh: the shim that hands the real `gh` the App's
// token for the bookkeeping verbs on a rostered repo inside a Claude session, or
// refuses with the client's code and message. Each case runs a scratch copy of
// the kit against a stub `gh` that records its argv and GH_TOKEN; the token comes
// from a cache file or a local token-service stand-in, so nothing reaches GitHub.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const {
  BASH, NO_RC, NODE_DIR, shellPath, systemPathWith, homeEnv, basePathWithout,
} = require('../../lib/platform');
const { eqArgv, fmtCalls } = require('../../lib/argv-log');
const { makeGhStub, ghCalls, ghEnvs } = require('../../lib/gh-stub');
const { mkOriginRepo } = require('../../lib/git-repo');
const { mkRosterHome } = require('../../lib/roster');
const {
  INSTALL_FIX, deviceFlowRoutes, writeLogin, readWrittenLogin, useTokenService, startServer, startService,
  scratchKit, PTY, atTerminal,
} = require('../../lib/identity');

// The client's cache, one token per repo, so a token names the repo it was read for.
const CACHED = {
  'acme--rostered': 'ghs_testtoken',
  'other--rostered': 'ghs_othertoken',
  'acme--unrostered': 'ghs_unrosteredtoken',
};

// A token URL nothing listens on, for the worlds whose cases never reach the service.
const NO_SERVICE = 'http://127.0.0.1:9/token';

/**
 * A scratch kit, three repos and a home whose roster enables two of them:
 * `rostered` (acme/rostered) and `other` (other/rostered); `unrostered`
 * (acme/unrostered) is on no roster. `signedIn: false` leaves no login file,
 * `cache: false` leaves the client nothing cached, and `tokenUrl` is the
 * service the settings name.
 */
const mkWorld = ({ signedIn = true, cache = true, tokenUrl = NO_SERVICE } = {}) => {
  const root = mkTmp('wk-gh-shim-');
  const kit = scratchKit();

  const repo = (name, slug) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    return mkOriginRepo(dir, `https://github.com/${slug}.git`);
  };
  const rostered = repo('rostered', 'acme/rostered');
  const other = repo('other', 'other/rostered');
  const unrostered = repo('unrostered', 'acme/unrostered');

  const home = mkRosterHome([[rostered, 'enabled'], [other, 'enabled']]);
  useTokenService(home, tokenUrl);
  if (signedIn) writeLogin(home, { token: 'ghu_owneruser', login: 'owner' });
  if (cache) {
    const cacheDir = path.join(home, '.workkit', 'identity');
    fs.mkdirSync(cacheDir, { recursive: true });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    for (const [name, token] of Object.entries(CACHED)) {
      fs.writeFileSync(path.join(cacheDir, `${name}.json`), JSON.stringify({ token, expiresAt }), { mode: 0o600 });
    }
  }
  return {
    root, shim: path.join(kit, 'workflow', 'identity', 'gh'), home, rostered, other, unrostered,
  };
};

/**
 * Run the shim with `args` from `cwd` (the rostered repo by default), PATH the
 * shim's folder, any `extraDirs`, the stub's, then node; `claude: false` leaves
 * CLAUDECODE unset, `env` adds variables, and `noJq` swaps the system part for
 * a mirror holding no jq. Neither token name is in the env, so null means unset.
 * `keyboard: true` runs it at script's terminal, `stderr` then all it showed.
 */
const runShim = (world, args, {
  claude = true, cwd = world.rostered, env: extra = {}, extraDirs = [], noJq = false, keyboard = false,
} = {}) => {
  // The stub holds one issue fixture, so a view of it answers the way gh does.
  const stub = makeGhStub({ env: ['GH_TOKEN'], field: 'body', issues: { 1: 'x' } });
  const dirs = [path.dirname(world.shim), ...extraDirs, stub.binDir];
  const env = homeEnv(world.home, {
    PATH: noJq
      ? [...dirs, basePathWithout(world.root, 'jq')].join(path.delimiter)
      : systemPathWith(...dirs, NODE_DIR),
    ...(claude ? { CLAUDECODE: '1' } : {}),
    ...extra,
  });
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  if (keyboard) {
    const res = atTerminal([BASH, ...NO_RC, shellPath(world.shim), ...args], { env, cwd, dir: world.root });
    return {
      code: res.status, stderr: res.terminal, calls: ghCalls(stub), envs: ghEnvs(stub),
    };
  }
  const res = spawnSync(BASH, [...NO_RC, shellPath(world.shim), ...args],
    { cwd, env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return {
    code: res.status, stderr: res.stderr || '', calls: ghCalls(stub), envs: ghEnvs(stub),
  };
};

/** The real `gh` ran once, exit 0, with `argv` whole and GH_TOKEN `token` (null: unset). */
const assertRan = (res, argv, token, what) => {
  assertEq(res.code, 0, `${what}: the exit (stderr: ${res.stderr.trim()})`);
  assertEq(res.calls.length, 1, `${what}: the real gh runs once, got ${fmtCalls(res.calls)}`);
  assert(eqArgv(res.calls[0], argv), `${what}: every argument passed through, got ${fmtCalls(res.calls)}`);
  assertEq(res.envs[0].GH_TOKEN, token, `${what}: GH_TOKEN`);
};

const cases = async () => {
  group('identity/gh: the owner\'s own calls');

  await test('case 15: outside a Claude session, gh issue list runs the real gh with no GH_TOKEN', async () => {
    const world = mkWorld();
    assertRan(runShim(world, ['issue', 'list'], { claude: false }), ['issue', 'list'], null, 'gh issue list');
  });

  group('identity/gh: the bot\'s bookkeeping');

  await test('case 15: on a rostered repo the bookkeeping verbs get the client\'s token, the rest run as the owner', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment), comment, 'ghs_testtoken', 'gh issue comment, repo from the cwd');

    const byFlag = ['issue', 'comment', '1', '--body', 'x', '--repo', 'other/rostered'];
    assertRan(runShim(world, byFlag), byFlag, 'ghs_othertoken', 'gh issue comment --repo, repo from the flag');
    const byShortFlag = ['issue', 'comment', '1', '--body', 'x', '-R', 'other/rostered'];
    assertRan(runShim(world, byShortFlag), byShortFlag, 'ghs_othertoken', 'gh issue comment -R, repo from the flag');

    const prComment = ['pr', 'comment', '3', '--body', 'x'];
    assertRan(runShim(world, prComment), prComment, 'ghs_testtoken', 'gh pr comment');

    const asOwner = [
      ['pr', 'merge', '3', '--squash'],
      ['release', 'create', 'v1.0.0'],
      ['api', 'repos/acme/rostered/issues/1/comments', '-f', 'body=x'],
      ['auth', 'token'],
    ];
    for (const argv of asOwner) assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
  });

  await test('case 15: on a repo not on the roster, a bookkeeping verb runs with no GH_TOKEN', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { cwd: world.unrostered }), comment, null, 'gh issue comment');
  });

  await test('case 15: GH_REPO names the repo when no flag does, and -R beats it', async () => {
    const world = mkWorld();
    const opts = { cwd: world.unrostered, env: { GH_REPO: 'other/rostered' } };
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, opts), comment, 'ghs_othertoken', 'GH_REPO from an unrostered cwd');
    const byFlag = ['issue', 'comment', '1', '--body', 'x', '-R', 'acme/rostered'];
    assertRan(runShim(world, byFlag, opts), byFlag, 'ghs_testtoken', '-R over GH_REPO');
  });

  await test('case 15: an issue URL argument names the repo gh acts on, over the cwd\'s origin', async () => {
    const world = mkWorld();
    const byUrl = ['issue', 'comment', 'https://github.com/other/rostered/issues/1', '--body', 'x'];
    assertRan(runShim(world, byUrl), byUrl, 'ghs_othertoken', 'gh issue comment <url> from acme/rostered');
  });

  await test('a pull request URL after a boolean flag names the repo: gh pr review --approve <url> gets that repo\'s token, from any cwd', async () => {
    const world = mkWorld();
    const review = ['pr', 'review', '--approve', 'https://github.com/other/rostered/pull/3'];
    assertRan(runShim(world, review), review, 'ghs_othertoken', 'gh pr review --approve <url> from acme/rostered');
    assertRan(runShim(world, review, { cwd: world.unrostered }), review, 'ghs_othertoken',
      'gh pr review --approve <url> from acme/unrostered');
  });

  await test('an issue URL after a boolean flag names the repo: gh issue comment --edit-last <url> --body x gets that repo\'s token', async () => {
    const world = mkWorld();
    const edit = ['issue', 'comment', '--edit-last', 'https://github.com/other/rostered/issues/7', '--body', 'x'];
    assertRan(runShim(world, edit), edit, 'ghs_othertoken', 'gh issue comment --edit-last <url> from acme/rostered');
  });

  await test('a URL with a fragment or a trailing path still names the repo: #issuecomment-<n> and /pull/<n>/files get that repo\'s token', async () => {
    const world = mkWorld();
    const calls = [
      ['issue', 'comment', 'https://github.com/other/rostered/issues/7#issuecomment-123', '--body', 'x'],
      ['pr', 'review', 'https://github.com/other/rostered/pull/3/files', '--approve'],
    ];
    for (const argv of calls) assertRan(runShim(world, argv), argv, 'ghs_othertoken', `gh ${argv.join(' ')} from acme/rostered`);
  });

  await test('a URL that is a body or title flag\'s whole value names no repo; a boolean flag\'s neighbour still does', async () => {
    const world = mkWorld();
    const values = [
      ['issue', 'comment', '5', '--body', 'https://github.com/other/rostered/issues/3'],
      ['issue', 'create', '--title', 'https://github.com/other/rostered/issues/3', '--body', 'x'],
    ];
    for (const argv of values) assertRan(runShim(world, argv), argv, 'ghs_testtoken', `gh ${argv.join(' ')} from acme/rostered`);
    const review = ['pr', 'review', '--approve', 'https://github.com/other/rostered/pull/3'];
    assertRan(runShim(world, review), review, 'ghs_othertoken', 'gh pr review --approve <url> from acme/rostered');
  });

  await test('a bare verb or a help flag runs the real gh as the owner and never asks the client, signed in or not', async () => {
    const helps = [['issue'], ['label', '-h'], ['issue', 'comment', '--help']];
    // The stand-in is the token service, so a call that asked the client would show as a request.
    const service = await startService(200, { token: 'ghs_never', expires_at: '2099-01-01T00:00:00Z' });
    try {
      const signedIn = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
      for (const argv of helps) assertRan(runShim(signedIn, argv), argv, null, `signed in, gh ${argv.join(' ')}`);
      assertEq(service.requests().length, 0, `the client never asked the service, got: ${JSON.stringify(service.requests())}`);
    } finally {
      await service.close();
    }
    // Not signed in, a call that reached the client would exit 3; the stub's own 0 means gh answered.
    const signedOut = mkWorld({ signedIn: false, cache: false });
    for (const argv of helps) assertRan(runShim(signedOut, argv), argv, null, `not signed in, gh ${argv.join(' ')}`);
  });

  await test('gh issue list and gh pr create still run as the owner on a rostered repo', async () => {
    const world = mkWorld();
    for (const argv of [['issue', 'list'], ['pr', 'create']]) assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
  });

  await test('case 15: gh pr revert and gh pr update-branch run as the owner on a rostered repo', async () => {
    const world = mkWorld();
    for (const argv of [['pr', 'revert', '3'], ['pr', 'update-branch', '3']]) {
      assertRan(runShim(world, argv), argv, null, `gh ${argv.join(' ')}`);
    }
  });

  await test('case 17a: the reads run the real gh once with no GH_TOKEN on a rostered repo, signed in or not', async () => {
    const reads = [['issue', 'list'], ['issue', 'view', '1'], ['label', 'list'], ['pr', 'checks', '3'], ['pr', 'status']];
    for (const [label, world] of [['signed in', mkWorld()], ['not signed in', mkWorld({ signedIn: false, cache: false })]]) {
      for (const argv of reads) assertRan(runShim(world, argv), argv, null, `${label}, gh ${argv.join(' ')}`);
    }
  });

  await test('case 17b: a github.com URL inside a body or title value\'s prose names no repo; the cwd\'s token is taken', async () => {
    const world = mkWorld();
    const calls = [
      ['issue', 'comment', '5', '--body', 'https://github.com/other/thing/issues/3 is related'],
      ['issue', 'comment', '5', '-b', 'https://github.com/other/thing/issues/3 is related'],
      ['issue', 'create', '--title', 'https://github.com/other/x/pull/1 follow-up', '--body', 'b'],
    ];
    for (const argv of calls) assertRan(runShim(world, argv), argv, 'ghs_testtoken', `gh ${argv.join(' ')}`);
  });

  await test('case 17c: -R and GH_REPO given as a github.com URL or host/owner/name read as owner/name', async () => {
    const world = mkWorld();
    for (const value of ['https://github.com/other/rostered', 'github.com/other/rostered']) {
      const argv = ['issue', 'comment', '1', '--body', 'x', '-R', value];
      assertRan(runShim(world, argv), argv, 'ghs_othertoken', `-R ${value} from acme/rostered`);
    }
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { env: { GH_REPO: 'github.com/other/rostered' } }), comment, 'ghs_othertoken',
      'GH_REPO=github.com/other/rostered from acme/rostered');
    for (const value of ['https://github.com/acme/rostered', 'github.com/acme/rostered']) {
      const argv = ['issue', 'comment', '1', '--body', 'x', '-R', value];
      assertRan(runShim(world, argv, { cwd: world.unrostered }), argv, 'ghs_testtoken', `-R ${value} from acme/unrostered`);
    }
    assertRan(runShim(world, comment, { cwd: world.unrostered, env: { GH_REPO: 'github.com/acme/rostered' } }), comment,
      'ghs_testtoken', 'GH_REPO=github.com/acme/rostered from acme/unrostered');
  });

  group('identity/gh: the escape hatch and the PATH');

  await test('case 15: WORKKIT_IDENTITY_OFF=1 runs the real gh with no token, even for bookkeeping on a rostered repo', async () => {
    const world = mkWorld();
    const comment = ['issue', 'comment', '1', '--body', 'x'];
    assertRan(runShim(world, comment, { env: { WORKKIT_IDENTITY_OFF: '1' } }), comment, null, 'gh issue comment');
  });

  await test('case 15: a PATH holding a second copy of the shim\'s folder still reaches the real gh in time', async () => {
    const world = mkWorld();
    const second = path.join(world.root, 'second', 'identity');
    fs.cpSync(path.dirname(world.shim), second, { recursive: true });
    const list = ['issue', 'list'];
    assertRan(runShim(world, list, { claude: false, extraDirs: [second] }), list, null, 'gh issue list past two shims');
  });

  group('identity/gh: the refusals');

  await test('case 16: not signed in, no terminal, a bookkeeping verb on a rostered repo exits 3 naming workkit setup --login, starts no sign-in, and gh never runs', async () => {
    // The stand-in is GitHub's sign-in host, so a device flow started here would show.
    const github = await startServer(deviceFlowRoutes({ userCode: 'SHIM-0016', accessToken: 'ghu_never', login: 'hubot' }),
      mkTmp('wk-gh-shim-github-'));
    try {
      const world = mkWorld({ signedIn: false, cache: false });
      const res = runShim(world, ['issue', 'comment', '1', '--body', 'x'],
        { env: { GITHUB_SERVER_URL: github.url, GITHUB_API_URL: github.url } });
      assertEq(res.code, 3, `exit 3, stderr: ${res.stderr}`);
      assert(res.stderr.includes('workkit setup --login'), `stderr names workkit setup --login, got: ${res.stderr}`);
      assert(!res.stderr.includes('workkit login'), `and no longer workkit login, got: ${res.stderr}`);
      assertEq(github.requests().length, 0, `no device-code request, got: ${JSON.stringify(github.requests())}`);
      assertEq(res.calls.length, 0, `the real gh never runs, got ${fmtCalls(res.calls)}`);
    } finally {
      await github.close();
    }
  });

  await testUnless(!PTY, 'no `script` here to hand the shim a terminal')(
    'case 16a: not signed in at a terminal, the client\'s own sign-in reaches the person, then the real gh runs once with the service\'s token', async () => {
      const stand = await startServer([
        ...deviceFlowRoutes({ userCode: 'SHIM-016A', accessToken: 'ghu_shimkeyboard', login: 'hubot' }),
        { method: 'POST', url: '/token', status: 200, body: JSON.stringify({ token: 'ghs_aftersignin', expires_at: '2099-01-01T00:00:00Z' }) },
      ], mkTmp('wk-gh-shim-stand-'));
      try {
        const world = mkWorld({ signedIn: false, cache: false, tokenUrl: `${stand.url}/token` });
        const comment = ['issue', 'comment', '1', '--body', 'x'];
        const res = runShim(world, comment, { keyboard: true, env: { GITHUB_SERVER_URL: stand.url, GITHUB_API_URL: stand.url } });
        assert(res.stderr.includes('https://github.com/login/device'), `the terminal shows the device page, got: ${res.stderr}`);
        assert(res.stderr.includes('SHIM-016A'), `and the user code, got: ${res.stderr}`);
        const written = readWrittenLogin(world.home);
        assertEq(written.login, 'hubot', 'the login file holds the stand-in\'s login');
        assertEq(written.token, 'ghu_shimkeyboard', 'and its token');
        // The stub exits 0 on a comment, so the shim's 0 is the stub's, handed on by exec.
        assertRan(res, comment, 'ghs_aftersignin', 'gh issue comment after the sign-in');
        const posts = stand.requests().filter((r) => r.method === 'POST' && r.url === '/token');
        assertEq(posts.length, 1, `one service request, got: ${JSON.stringify(stand.requests())}`);
        assertEq(posts[0].auth, 'Bearer ghu_shimkeyboard', 'carrying the new sign-in\'s bearer');
      } finally {
        await stand.close();
      }
    },
  );

  await test('case 17: the service answers 412, the verb exits 4 with the install page, and gh never runs', async () => {
    const service = await startService(412, { error: 'not installed', fix: INSTALL_FIX });
    try {
      const world = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
      const res = runShim(world, ['issue', 'comment', '1', '--body', 'x']);
      assertEq(res.code, 4, `exit 4, stderr: ${res.stderr}`);
      assert(res.stderr.includes('https://github.com/apps/workkit-agent'), `stderr carries the install page, got: ${res.stderr}`);
      assertEq(res.calls.length, 0, `the real gh never runs, got ${fmtCalls(res.calls)}`);
      const posts = service.requests().filter((r) => r.method === 'POST' && r.url === '/token');
      assert(posts.length > 0, `the client asked the stand-in, got: ${JSON.stringify(service.requests())}`);
    } finally {
      await service.close();
    }
  });

  await test('case 17d: with no jq on PATH, a bookkeeping verb on a rostered repo exits 1 naming jq, and gh never runs', async () => {
    const world = mkWorld();
    const res = runShim(world, ['issue', 'comment', '1', '--body', 'x'], { noJq: true });
    assertEq(res.code, 1, `exit 1, stderr: ${res.stderr}`);
    assert(/\bjq\b/.test(res.stderr), `stderr names jq, got: ${res.stderr}`);
    assertEq(res.calls.length, 0, `the real gh never runs, got ${fmtCalls(res.calls)}`);
  });

  await test('the shim relays the client\'s exit 1: a 403 and a 500 from the service each exit 1 with its message, and gh never runs', async () => {
    const answers = [
      [403, { error: 'no write access', fix: 'you need write access to acme/rostered to post as the bot' }, 'you need write access to acme/rostered to post as the bot'],
      [500, { error: 'github refused: Server Error from the stand-in', fix: 'try again shortly' }, 'Server Error from the stand-in'],
    ];
    for (const [status, body, message] of answers) {
      const service = await startService(status, body);
      try {
        const world = mkWorld({ cache: false, tokenUrl: `${service.url}/token` });
        const res = runShim(world, ['issue', 'comment', '1', '--body', 'x']);
        assertEq(res.code, 1, `${status}: exit 1, stderr: ${res.stderr}`);
        assert(res.stderr.includes(message), `${status}: stderr carries the service's message, got: ${res.stderr}`);
        assertEq(res.calls.length, 0, `${status}: the real gh never runs, got ${fmtCalls(res.calls)}`);
      } finally {
        await service.close();
      }
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
