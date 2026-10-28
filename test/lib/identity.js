// The shared fixtures of the identity suites: the user's sign-in as the login
// store holds and writes it, the token service's address in the settings, a local
// HTTP stand-in for GitHub or the token service, a scratch kit and its scrubbed env,
// doctor's attention count, the response and failure helpers, and a keyboard run.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  assert, mkTmp, until, start, SPAWN_DEADLINE,
} = require('./harness');
const { IS_WINDOWS, SYSTEM_PATH, which, homeEnv } = require('./platform');

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

/**
 * A GitHub stand-in's routes for a device flow that finishes at once: the code
 * carrying `userCode`, a first poll granting `accessToken`, `/user` as `login`.
 */
const deviceFlowRoutes = ({ userCode, accessToken, login }) => [
  { method: 'POST', url: '/login/device/code', status: 200, body: JSON.stringify({ ...DEVICE_CODE, user_code: userCode }) },
  { method: 'POST', url: '/login/oauth/access_token', status: 200, body: JSON.stringify({ access_token: accessToken, token_type: 'bearer', scope: '' }) },
  { method: 'GET', url: '/user', status: 200, body: JSON.stringify({ login }) },
];

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
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1 };
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
// command under test still gets its answer. A request matching a route by method
// and url gets that route's answer, the next of its `answers` when it has them
// (the last repeating); any other is a 501. Every one is recorded.
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
    const i = routes.findIndex((r) => r.method === req.method && r.url === req.url);
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
 * in order, the last repeating) and 501 to anything else: `{ url, requests(),
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

/** A scratch kit holding a copy of this checkout's `workflow/`; returns the kit folder. */
const scratchKit = () => {
  const kit = mkTmp('wk-identity-kit-');
  fs.cpSync(path.join(KIT, 'workflow'), path.join(kit, 'workflow'), { recursive: true });
  return kit;
};

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
  IDENTITY_NA, DEVICE_CODE, INSTALL_FIX, deviceFlowRoutes, writeLogin, readWrittenLogin, useTokenService, collector, json, failureOf,
  startServer, startService, scratchKit, scratchEnv, attentionCount, PTY, atTerminal,
};
