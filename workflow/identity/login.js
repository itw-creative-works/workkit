// workflow/identity/login.js: the user's sign-in. GitHub's device flow with
// the App's Client ID gives a user token, kept in `identity/login.json`; the
// token service trades it for the bot's per-repo token.
// Usage: node login.js [--open <opener>] | --status

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { CLIENT_ID } = require('./app');
const { userDir } = require('../user-dir');

const DEFAULT_SERVER = 'https://github.com';
const DEFAULT_API = 'https://api.github.com';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
// The device flow's own rule: a slow_down answer adds five seconds to the interval.
const SLOW_DOWN_S = 5;
const DEFAULT_INTERVAL_S = 5;
const USAGE = 'usage: login.js [--open <opener>] | login.js --status';
// The command every not-signed-in message names.
const LOGIN_FIX = 'workkit setup --login';

/**
 * The login file: `<userDir>/identity/login.json`.
 * @returns {string}
 */
const loginFile = () => path.join(userDir(), 'identity', 'login.json');

/**
 * The stored login, or null when there is none or it holds no token. A torn
 * or hand-mangled file reads as no login: `workkit setup --login` writes it again.
 * @param {string} file
 * @returns {{token: string, login: string}|null}
 */
const readLogin = (file) => {
  if (!fs.existsSync(file)) return null;
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!entry || typeof entry.token !== 'string' || !entry.token) return null;
  return { token: entry.token, login: entry.login };
};

/**
 * A JSON file written owner-only: the folder 0700, the file 0600, renamed into
 * place so a reader racing the write never sees half a file. The login and the
 * client's token cache both write through it.
 * @param {string} file
 * @param {object} entry
 */
const writeOwnerOnly = (file, entry) => {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
};

/**
 * The login written owner-only. An entry without a token and a login is a
 * caller's bug, refused before anything lands on disk.
 * @param {string} file
 * @param {{token: string, login: string}} entry
 */
const writeLogin = (file, entry) => {
  if (!entry || typeof entry.token !== 'string' || !entry.token || typeof entry.login !== 'string' || !entry.login) {
    throw new TypeError('a login needs a token and a login');
  }
  writeOwnerOnly(file, { token: entry.token, login: entry.login });
};

/**
 * What `--status` reports, here and in the client's own status.
 * @param {string} file
 * @returns {{loginFile: string, signedIn: boolean, login: string|null}}
 */
const loginStatus = (file) => {
  const entry = readLogin(file);
  return { loginFile: file, signedIn: entry !== null, login: entry ? entry.login || null : null };
};

/**
 * A host from its variable, the default when unset, with no trailing slash.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
const hostOf = (name, fallback) => (process.env[name] || fallback).replace(/\/+$/, '');

/**
 * One JSON POST to the device flow's host, its answer parsed. A failing status
 * still returns a body that carries an `error`, the flow's own vocabulary;
 * any other refusal, or a body that is not JSON, throws naming the endpoint.
 * @param {Function} fetch
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>}
 */
const postJson = async (fetch, url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'workkit' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the status below, or the shape check, names the refusal.
  }
  if (res.ok && parsed) return parsed;
  if (parsed && typeof parsed.error === 'string') return parsed;
  throw new Error(`sign-in failed: ${url} answered ${res.status}${parsed ? '' : ', not JSON'}`);
};

/**
 * The GitHub login the user token belongs to, from `GET /user`.
 * @param {Function} fetch
 * @param {string} token
 * @returns {Promise<string>}
 */
const userLogin = async (fetch, token) => {
  const url = `${hostOf('GITHUB_API_URL', DEFAULT_API)}/user`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'workkit',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`sign-in failed: ${url} answered ${res.status}`);
  const body = await res.json();
  if (!body || typeof body.login !== 'string' || !body.login) {
    throw new Error(`sign-in failed: ${url} carried no login`);
  }
  return body.login;
};

/**
 * GitHub's own words for a device-flow refusal: its `error`, and its
 * `error_description` when it sent one.
 * @param {{error: string, error_description?: string}} answer
 * @returns {string}
 */
const flowReason = (answer) => `${answer.error}${answer.error_description ? ` (${answer.error_description})` : ''}`;

/**
 * Polls the token endpoint until the user approves the code, sleeping the
 * server's interval between polls. A declined or expired code throws naming
 * the reason.
 * @param {object} args
 * @returns {Promise<string>} the user token
 */
const pollForToken = async ({ fetch, sleep, url, deviceCode, interval }) => {
  let wait = interval;
  for (;;) {
    const answer = await postJson(fetch, url, { client_id: CLIENT_ID, device_code: deviceCode, grant_type: DEVICE_GRANT });
    if (typeof answer.access_token === 'string' && answer.access_token) return answer.access_token;
    switch (answer.error) {
      case 'authorization_pending': break;
      case 'slow_down': wait += SLOW_DOWN_S; break;
      case 'access_denied': throw new Error('sign-in failed: access_denied, the code was declined on GitHub');
      case 'expired_token': throw new Error(`sign-in failed: expired_token, the code expired before it was entered; run \`${LOGIN_FIX}\` again`);
      default: throw new Error(`sign-in failed: ${answer.error ? flowReason(answer) : 'no token and no error'}`);
    }
    await sleep(wait * 1000);
  }
};

/**
 * Hands the verification page to the browser opener, detached so the flow
 * never waits on it. The page carries no secret, so argv is fine. An opener
 * that fails to start is one stderr line; the printed page still stands.
 * @param {string} opener
 * @param {string} page
 */
const openPage = (opener, page) => {
  const child = spawn(opener, [page], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => process.stderr.write(`could not open the browser: ${err.message}\n`));
  child.unref();
};

/**
 * The device flow, whole: asks for a code, prints it and its page, opens the
 * page when given an opener, waits for the approval, reads the login and
 * writes `{ token, login }` at loginFile().
 * @param {object} [opts]
 * @param {Function} [opts.fetch] defaults to the global fetch
 * @param {Function} [opts.sleep] milliseconds to a promise, defaults to a timer
 * @param {{write: Function}} [opts.out] defaults to process.stdout
 * @param {string} [opts.open] the browser opener's name; none runs nothing
 * @returns {Promise<{token: string, login: string}>} the entry written
 */
const signIn = async ({
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  out = process.stdout,
  open,
} = {}) => {
  const server = hostOf('GITHUB_SERVER_URL', DEFAULT_SERVER);
  const code = await postJson(fetch, `${server}/login/device/code`, { client_id: CLIENT_ID });
  if (code.error) throw new Error(`sign-in failed: ${server}/login/device/code refused: ${flowReason(code)}`);
  if (!code.device_code || !code.user_code || !code.verification_uri) {
    throw new Error(`sign-in failed: ${server}/login/device/code carried no device code`);
  }
  out.write(`Open ${code.verification_uri} and enter the code ${code.user_code}\n`);
  if (open) openPage(open, code.verification_uri);

  const token = await pollForToken({
    fetch,
    sleep,
    url: `${server}/login/oauth/access_token`,
    deviceCode: code.device_code,
    interval: Number(code.interval) || DEFAULT_INTERVAL_S,
  });
  const entry = { token, login: await userLogin(fetch, token) };
  writeLogin(loginFile(), entry);
  out.write(`Signed in as @${entry.login}\n`);
  return entry;
};

/**
 * The command forms: sign in (opening the page with `--open <opener>`), or the
 * status as JSON.
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  if (argv.length === 0) {
    await signIn();
    return 0;
  }
  if (argv.length === 2 && argv[0] === '--open' && !argv[1].startsWith('-')) {
    await signIn({ open: argv[1] });
    return 0;
  }
  if (argv.length === 1 && argv[0] === '--status') {
    process.stdout.write(`${JSON.stringify(loginStatus(loginFile()))}\n`);
    return 0;
  }
  throw new Error(USAGE);
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (err) => {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { loginFile, readLogin, writeLogin, signIn, loginStatus, writeOwnerOnly, LOGIN_FIX };
