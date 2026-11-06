// The shared fixtures of the identity suites: the user's sign-in as the login
// store holds and writes it, the token service's address in the settings, a local
// HTTP stand-in for GitHub or the token service, a scratch kit and its scrubbed env,
// doctor's attention count, the response and failure helpers, a keyboard run, the
// gh journal the shim appends to, and the REST suites' cloud-shim world and reads.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const {
  assert, assertEq, mkTmp, seeded, until, start, SPAWN_DEADLINE,
} = require('./harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, NO_RC, which, homeEnv, shellPath, systemPathWith, spawnBash,
} = require('./platform');
const { suiteMarkerPath } = require('./suite-record');
const { makeGhStub, ghCalls, ghRequests } = require('./gh-stub');
const { mkOriginRepo } = require('./git-repo');

/** The identity line a cloud session prints, in doctor and in setup --cloud. */
const IDENTITY_NA = 'identity: not applicable in a cloud session; the session\'s GitHub proxy signs every call as the account';

const KIT = path.join(__dirname, '..', '..');

// GitHub's device-code answer, as its docs show one.
const DEVICE_CODE = {
  device_code: 'dc_3584d83530557fdd1f46af8289938c8ef79f9dc5',
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

// The token service's not-installed fix for acme.
const INSTALL_FIX = 'install workkit-agent[bot] on acme: https://github.com/apps/workkit-agent';

// The kit's install page pre-selected on an owner, less the id; the --bot line
// after a refusal naming it; the refusal for an owner spelled Old whose id GitHub cannot give.
const PRESELECTED = 'https://github.com/apps/workkit-agent/installations/new/permissions?suggested_target_id=';
const BOT_HINT = 'or run: workkit setup --bot';
const UNREADABLE = 'install workkit-agent[bot] on Old: owner id unreadable from GitHub, retry';

/**
 * A GitHub stand-in's routes for a device flow that finishes at once: the code
 * carrying `userCode`, a first poll granting `accessToken`, `/user` as `login`.
 */
const deviceFlowRoutes = ({ userCode, accessToken, login }) => [
  { method: 'POST', url: '/login/device/code', status: 200, body: JSON.stringify({ ...DEVICE_CODE, user_code: userCode }) },
  { method: 'POST', url: '/login/oauth/access_token', status: 200, body: JSON.stringify({ access_token: accessToken, token_type: 'bearer', scope: '' }) },
  { method: 'GET', url: '/user', status: 200, body: JSON.stringify({ login }) },
];

/**
 * A GitHub stand-in's route for `GET /repos/<sent>`, answering the repo's
 * canonical `full_name` and owner `{ login, id }`, as GitHub does after a rename.
 */
const repoRoute = (sent, fullName, id) => ({
  method: 'GET',
  url: `/repos/${sent}`,
  status: 200,
  body: JSON.stringify({ full_name: fullName, owner: { login: fullName.split('/')[0], id } }),
});

/** A GitHub stand-in's route for the public `GET /users/<login>`, answering `{ login, id }`. */
const userRoute = (login, id) => ({
  method: 'GET', url: `/users/${login}`, status: 200, body: JSON.stringify({ login, id }),
});

/** Write `<home>/.workkit/identity/login.json` as `{ token, login }`, the folder made; returns its path. */
const writeLogin = (home, { token, login }) => {
  const file = path.join(home, '.workkit', 'identity', 'login.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ token, login })}\n`);
  return file;
};

/** What `<home>/.workkit/identity/login.json` holds, parsed. */
const readWrittenLogin = (home) => JSON.parse(fs.readFileSync(path.join(home, '.workkit', 'identity', 'login.json'), 'utf8'));

/** Point `<home>/.workkit/settings.json` at the token service `url`, merged into what is there. */
const useTokenService = (home, url) => {
  const file = path.join(home, '.workkit', 'settings.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...current, identity: { tokenUrl: url } }, null, 2)}\n`);
};

/**
 * An `out` that collects what it is handed, whether called or written to; a
 * write's callback, when given one, runs once the text is kept.
 */
const collector = () => {
  const lines = [];
  const out = (...args) => { lines.push(args.join(' ')); };
  out.write = (s, ...rest) => {
    lines.push(String(s));
    const done = rest.find((r) => typeof r === 'function');
    if (done) done();
    return true;
  };
  return { out, text: () => lines.join('\n') };
};

/** A real `Response` holding `body` as JSON with HTTP `status`. */
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/** The error `fn` throws or rejects with; a failure of its own when `fn` returns. */
const failureOf = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure, got a return');
};

// The server runs in its own process, so a suite blocked in spawnSync on the
// command under test still gets its answer. A request matching a route by method,
// url and `whenBody` gets that route's answer, the next of its `answers` when it
// has them (the last repeating); any other is a 501. Every one is recorded.
const SERVER = `
const http = require('http');
const fs = require('fs');
const [routesJson, log] = process.argv.slice(1);
const routes = JSON.parse(routesJson);
const hits = routes.map(() => 0);
const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization || '', body }) + '\\n');
    let sent = null;
    try { sent = JSON.parse(body); } catch {}
    const wanted = (r) => !r.whenBody || (sent !== null && Object.keys(r.whenBody).every((k) => sent[k] === r.whenBody[k]));
    const i = routes.findIndex((r) => r.method === req.method && r.url === req.url && wanted(r));
    const seq = i < 0 ? [] : (routes[i].answers || [routes[i]]);
    const hit = i < 0 ? null : seq[Math.min(hits[i], seq.length - 1)];
    if (i >= 0) hits[i] += 1;
    res.writeHead(hit ? hit.status : 501, { 'content-type': 'application/json' });
    res.end(hit ? hit.body : '{ "error": "no such route" }');
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(server.address().port + '\\n'));
`;

/**
 * A local HTTP server answering each of `routes` (`{ method, url, status, body }`,
 * body a JSON string, or `{ method, url, answers: [{ status, body }] }` answered
 * in order, the last repeating; a `whenBody` object narrows a route to requests
 * whose JSON body holds each of its keys) and 501 to anything else: `{ url, requests(),
 * close() }`, where `requests()` lists `{ method, url, auth, body }`, body as text.
 */
const startServer = async (routes, dir) => {
  const logFile = path.join(dir, `server-requests-${process.hrtime.bigint()}.log`);
  const server = start(process.execPath, ['-e', SERVER, JSON.stringify(routes), logFile]);
  await until(() => server.stdout().endsWith('\n') || server.child.exitCode !== null);
  assert(server.stdout().endsWith('\n'), `the stand-in server printed its port, stderr: ${server.stderr()}`);
  return {
    url: `http://127.0.0.1:${server.stdout().trim()}`,
    requests: () => (fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : []),
    close: () => server.end(),
  };
};

/** A stand-in token service answering `POST /token` with `status` and `body` (an object). */
const startService = (status, body) => startServer(
  [{ method: 'POST', url: '/token', status, body: JSON.stringify(body) }],
  mkTmp('wk-identity-service-'),
);

/**
 * A scratch kit holding a copy of this checkout's `workflow/` and `hooks/`, the
 * shim's gate loading the guards from the second; returns the kit folder.
 */
const scratchKit = () => {
  const kit = mkTmp('wk-identity-kit-');
  for (const dir of ['workflow', 'hooks', 'defaults']) fs.cpSync(path.join(KIT, dir), path.join(kit, dir), { recursive: true });
  return kit;
};

/** Run git in `dir` as a scratch identity under `home`; a failure throws with its stderr. */
const git = (dir, home, ...args) => {
  const res = spawnSync('git', args, { cwd: dir, env: homeEnv(home, { PATH: process.env.PATH }), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
};

/** Write `files` (root-relative path to content) into the world's repo and commit them. */
const commitFiles = (world, files) => {
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(world.repo, rel), body);
  for (const args of [['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'], ['add', '-A'], ['commit', '-q', '-m', 'init']]) {
    git(world.repo, world.home, ...args);
  }
};

// A kit, a repo whose origin is acme/rostered, and an empty home; a `{ branch }`
// shape also gives the repo one commit, checked out on that branch.
const cloudSeed = seeded((dir, shape) => {
  fs.cpSync(scratchKit(), path.join(dir, 'kit'), { recursive: true });
  const world = { repo: path.join(dir, 'repo'), home: path.join(dir, 'home') };
  fs.mkdirSync(world.repo);
  fs.mkdirSync(world.home);
  mkOriginRepo(world.repo, 'https://github.com/acme/rostered.git');
  if (!shape) return;
  commitFiles(world, { 'README.md': 'x\n' });
  git(world.repo, world.home, 'checkout', '-q', '-b', shape.branch);
});

/** The cloud session's env for `world`, the stub's gh behind the shim and `extra` added, minus any GitHub token. */
const cloudEnv = (world, stub, extra = {}) => {
  const env = homeEnv(world.home, {
    PATH: systemPathWith(path.dirname(world.shim), stub.binDir, NODE_DIR), CLAUDECODE: '1', CLAUDE_CODE_REMOTE: 'true', ...extra,
  });
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
};

/**
 * The cloud-shim world a REST suite's cases run in, its repo on `branch` when given:
 * `{ mkWorld, runCloud }`, each case getting a fresh copy of the one seed.
 */
const cloudWorld = ({ branch = null } = {}) => {
  /** A fresh world: `{ root, shim, repo, home }`, the shim the scratch kit's gh. */
  const mkWorld = () => {
    const root = mkTmp('wk-gh-rest-');
    cloudSeed(root, branch ? { branch } : null);
    return {
      root, shim: path.join(root, 'kit', 'workflow', 'identity', 'gh'), repo: path.join(root, 'repo'), home: path.join(root, 'home'),
    };
  };

  /**
   * Run the shim in a cloud session with `args` from a fresh world's repo, the real gh
   * a stub answering `api` (keyed `<METHOD> <route>`); `env` adds variables, `files`
   * (root-relative path to content) is committed first, then `prep(world)` runs, each when given.
   * Returns the exit, both streams, every call the stub saw and every `gh api` request it answered.
   */
  const runCloud = (args, {
    api = {}, env = {}, files = null, prep = null,
  } = {}) => {
    const world = mkWorld();
    if (files) commitFiles(world, files);
    if (prep) prep(world);
    const stub = makeGhStub({ api });
    const res = spawnBash([...NO_RC, shellPath(world.shim), ...args],
      { cwd: world.repo, env: cloudEnv(world, stub, env), encoding: 'utf8', timeout: SPAWN_DEADLINE });
    return {
      code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', calls: ghCalls(stub), requests: ghRequests(stub),
    };
  };

  return { mkWorld, runCloud };
};

/** A failure naming `msg` and both values as JSON, unless `actual` deep-equals `expected`. */
const assertSame = (actual, expected, msg) => {
  assert(isDeepStrictEqual(actual, expected), `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

/** Exit 0, or a failure naming what the shim said and asked. */
const assertOk = (res, what) => {
  assertEq(res.code, 0, `${what}: the exit (stderr: ${res.stderr.trim()}, requests: ${JSON.stringify(res.requests)})`);
};

/** What the shim printed, parsed as the JSON gh prints; a failure naming the text when it is not. */
const printedJson = (res, what) => {
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`${what}: stdout is not JSON, got: ${res.stdout}`);
  }
};

/** The requests a run made that change something, every method but GET. */
const writes = (res) => res.requests.filter((r) => r.method !== 'GET');

/** Each of `reqs` as its `[method, path]` pair. */
const routes = (reqs) => reqs.map((r) => [r.method, r.path]);

/**
 * The gh journal's text for <dir>'s repo under the workflow <home>, '' when the
 * file is absent. The file sits beside the suite record, keyed the same way:
 * `<home>/markers/claude-gh-journal/<sha1 of the root>`.
 */
const journalFileText = (home, dir) => {
  const record = suiteMarkerPath(home, dir);
  const file = path.join(path.dirname(path.dirname(record)), 'claude-gh-journal', path.basename(record));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

/** journalFileText's lines, each split on its tabs. */
const journalLines = (home, dir) => journalFileText(home, dir).split('\n').filter(Boolean).map((line) => line.split('\t'));

/**
 * This run's env with `home` its home and `extra` added, always minus the user
 * dir, and minus the GitHub hosts this run may carry unless `extra` names them.
 */
const scratchEnv = (home, extra = {}) => {
  const env = homeEnv(home, { ...process.env, ...extra });
  delete env.WORKFLOW_HOME;
  if (!('GITHUB_SERVER_URL' in extra)) delete env.GITHUB_SERVER_URL;
  if (!('GITHUB_API_URL' in extra)) delete env.GITHUB_API_URL;
  return env;
};

/** The env pair pointing GitHub's web and API hosts at the stand-in `server`. */
const hostsOf = (server) => ({ GITHUB_SERVER_URL: server.url, GITHUB_API_URL: server.url });

/** The count doctor's closing line gives, 0 when it reports everything current. */
const attentionCount = (said) => {
  const match = said.match(/(\d+) item\(s\) need attention/);
  if (match) return Number(match[1]);
  assert(said.includes('Everything this command can see is current'), `doctor neither counted nor cleared, got: ${said}`);
  return 0;
};

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// `script` hands a command a terminal: BSD takes the command after the file,
// util-linux takes it in -c and needs -e to return its status. Null: none here.
const PTY = (() => {
  if (IS_WINDOWS || !which('script', SYSTEM_PATH)) return null;
  const version = spawnSync('script', ['--version'], { encoding: 'utf8' });
  return /util-linux/.test(`${version.stdout}${version.stderr}`) ? 'gnu' : 'bsd';
})();

/**
 * Run `argv` at a keyboard: stdin and stderr are script's terminal, stdout a file
 * in `dir`, so the token's stream stays apart from the sign-in's. Returns
 * `{ status, stdout, terminal }`, `terminal` all the terminal showed.
 */
const atTerminal = (argv, { env, cwd, dir }) => {
  const outFile = path.join(dir, `terminal-stdout-${process.hrtime.bigint()}.txt`);
  const inner = `${argv.map(shQuote).join(' ')} > ${shQuote(outFile)}`;
  const args = PTY === 'gnu' ? ['-q', '-e', '-c', inner, '/dev/null'] : ['-q', '/dev/null', 'sh', '-c', inner];
  // A file, not a pipe: node's pipes are socketpairs on macOS and BSD script refuses one.
  const stdinFile = path.join(dir, 'terminal-stdin');
  fs.writeFileSync(stdinFile, '');
  const fd = fs.openSync(stdinFile, 'r');
  const res = spawnSync('script', args, {
    env, cwd, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  fs.closeSync(fd);
  return {
    status: res.status,
    stdout: fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '',
    terminal: `${res.stdout || ''}${res.stderr || ''}`,
  };
};

module.exports = {
  IDENTITY_NA, DEVICE_CODE, INSTALL_FIX, PRESELECTED, BOT_HINT, UNREADABLE, deviceFlowRoutes, repoRoute, userRoute, writeLogin, readWrittenLogin, useTokenService, collector, json, failureOf,
  startServer, startService, scratchKit, scratchEnv, hostsOf, attentionCount, PTY, atTerminal, journalFileText, journalLines,
  git, cloudEnv, cloudWorld, assertSame, assertOk, printedJson, writes, routes,
};
