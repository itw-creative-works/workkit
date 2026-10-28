// workflow/identity/token.js: the client. `tokenFor` hands back the repo's App
// token, cached under `identity/` while five minutes remain, else asked of the
// token service with the user's sign-in. Usage: node token.js <owner/repo> |
// --installation <owner/repo> | --status (the token form exits 0, 3, 4 or 1).

const fs = require('fs');
const path = require('path');
const { TOKEN_URL, INSTALL_URL } = require('./app');
const {
  loginFile, readLogin, loginStatus, writeOwnerOnly, signIn, LOGIN_FIX, LOGIN_HINT,
} = require('./login');
const { splitRepo } = require('../slug');
const { userDir } = require('../user-dir');

const RENEW_MARGIN_MS = 5 * 60 * 1000;
// A hung service fails loudly at this bound instead of stalling every gh call.
const FETCH_TIMEOUT_MS = 15000;
const USAGE = 'usage: token.js <owner/repo> | token.js --installation <owner/repo> | token.js --status\n'
  + '  <owner/repo> exits 3 when not signed in, 4 when the App is not installed on the repo, 1 on any other failure';
// The token form's exit codes, read by the gh shim.
const EXIT_CODES = { not_signed_in: 3, not_installed: 4 };

/**
 * A refusal with its reason, `code` one of `not_signed_in`, `not_installed`,
 * `no_write_access` or `service_refused`.
 */
class IdentityError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
  }
}

/**
 * `now` as epoch milliseconds: a number or a Date, the clock when absent.
 * @param {number|Date} [now]
 * @returns {number}
 */
const nowMs = (now) => (now === undefined ? Date.now() : Number(now));

/**
 * The machine's settings.json, an empty object when there is none.
 * @returns {object}
 */
const readSettings = () => {
  const file = path.join(userDir(), 'settings.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be parsed: ${err.message}`);
  }
};

/**
 * The token service's URL: `identity.tokenUrl` from settings, else TOKEN_URL.
 * @param {object} settings
 * @returns {string}
 */
const tokenUrlOf = (settings) => settings?.identity?.tokenUrl || TOKEN_URL;

/**
 * The cache file for a repo: `<cacheDir>/<owner>--<repo>.json`.
 * @param {string} cacheDir
 * @param {string} repo
 * @returns {string}
 */
const cacheFile = (cacheDir, repo) => {
  const { owner, name } = splitRepo(repo);
  return path.join(cacheDir, `${owner}--${name}.json`);
};

/**
 * The cached entry while more than five minutes remain on it, else null. An
 * entry with no token or no parseable expiry is a miss, never fresh.
 * @param {string} file
 * @param {number} now epoch milliseconds
 * @returns {{token: string, expiresAt: string}|null}
 */
const freshCache = (file, now) => {
  if (!fs.existsSync(file)) return null;
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // A torn or hand-mangled entry is a miss: the request below overwrites it.
    return null;
  }
  if (!entry || typeof entry.token !== 'string' || !entry.token) return null;
  const expires = Date.parse(entry.expiresAt);
  if (Number.isNaN(expires) || expires - now <= RENEW_MARGIN_MS) return null;
  return entry;
};

/**
 * What a refusing status means: its code, and the words the message must
 * carry whatever the service said, appended when its own words lack them.
 * @param {number} status
 * @param {string} repo
 * @returns {{code: string, mustName: string, hint: string}}
 */
const refusalOf = (status, repo) => {
  if (status === 401) return { code: 'not_signed_in', mustName: LOGIN_FIX, hint: LOGIN_HINT };
  if (status === 412) return { code: 'not_installed', mustName: INSTALL_URL, hint: `install workkit-agent[bot] on ${repo}: ${INSTALL_URL}` };
  if (status === 403) return { code: 'no_write_access', mustName: 'no write access', hint: `no write access to ${repo}` };
  return { code: 'service_refused', mustName: '', hint: '' };
};

/**
 * The service's refusal as an IdentityError: its `error` and `fix` when the
 * body is JSON (a 401's fix the client's own hint), else the HTTP status.
 * @param {number} status
 * @param {string} text the response body
 * @param {string} repo
 * @returns {IdentityError}
 */
const refusal = (status, text, repo) => {
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the status alone names the refusal.
  }
  const said = body && typeof body === 'object' ? body : {};
  const { code, mustName, hint } = refusalOf(status, repo);
  // The service cannot see which session asked, so a sign-in's fix is the
  // client's own hint in place of the service's.
  const ownFix = code === 'not_signed_in';
  const words = [said.error, ownFix ? '' : said.fix].filter((w) => typeof w === 'string' && w).join(': ');
  let message = words || `the token service answered HTTP ${status} for ${repo}`;
  if (ownFix) message = `${message}: ${hint}`;
  else if (mustName && !message.includes(mustName)) message = `${message}; ${hint}`;
  return new IdentityError(code, message);
};

/**
 * The stored sign-in, or `not_signed_in` thrown before any request is made.
 * @param {string} file
 * @returns {{token: string, login: string}}
 */
const signedIn = (file) => {
  const login = readLogin(file);
  if (!login) throw new IdentityError('not_signed_in', `not signed in to workkit (no ${file}); ${LOGIN_HINT}`);
  return login;
};

/**
 * One request to the token service for the repo's App token, with the user's
 * bearer.
 * @param {string} repo owner/name
 * @param {object} opts
 * @param {object} opts.settings
 * @param {Function} opts.fetch
 * @param {{token: string}} opts.login
 * @returns {Promise<{token: string, expiresAt: string}>}
 */
const requestToken = async (repo, { settings, fetch, login }) => {
  splitRepo(repo);
  const url = tokenUrlOf(settings);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
      signal,
    });
  } catch (err) {
    const why = signal.aborted ? `did not answer within ${FETCH_TIMEOUT_MS / 1000}s` : `could not be reached: ${err.message}`;
    throw new IdentityError('service_refused', `the token service at ${url} ${why}`);
  }
  const text = await res.text();
  if (res.status !== 200) throw refusal(res.status, text, repo);

  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Handled below with every other reply that carries no token.
  }
  if (!body || typeof body.token !== 'string' || !body.token || Number.isNaN(Date.parse(body.expires_at))) {
    throw new IdentityError('service_refused', `the token service's reply for ${repo} carried no token and expires_at`);
  }
  return { token: body.token, expiresAt: body.expires_at };
};

/**
 * The repo's App token, cached or freshly asked for. Every failure throws an
 * IdentityError with its reason; there is no fall back to the owner's token.
 * @param {string} repo owner/repo
 * @param {object} [opts]
 * @param {object} [opts.settings] defaults to the machine's settings.json
 * @param {Function} [opts.fetch] defaults to the global fetch
 * @param {number|Date} [opts.now] defaults to the clock
 * @param {string} [opts.cacheDir] defaults to the machine folder's identity/
 * @param {string} [opts.loginFile] defaults to the login store's file
 * @returns {Promise<string>}
 */
const tokenFor = async (repo, opts = {}) => {
  const file = cacheFile(opts.cacheDir || path.join(userDir(), 'identity'), repo);
  // Signed out is signed out: a cached token outliving the login is never handed on.
  const login = signedIn(opts.loginFile || loginFile());
  const cached = freshCache(file, nowMs(opts.now));
  if (cached) return cached.token;

  const entry = await requestToken(repo, {
    settings: opts.settings || readSettings(),
    fetch: opts.fetch || globalThis.fetch,
    login,
  });
  writeOwnerOnly(file, entry);
  return entry.token;
};

/**
 * tokenFor, with one sign-in and one retry when the refusal is `not_signed_in`
 * (no login, or the service's 401) and someone is at the keyboard, the refusal
 * said first on `out`. The retry's answer or refusal is the result; every other
 * error passes through.
 * @param {string} repo owner/repo
 * @param {object} opts tokenFor's options, plus:
 * @param {Function} opts.atKeyboard whether a sign-in can be asked for
 * @param {Function} opts.signIn runs the sign-in, resolving once the login is written
 * @param {{write: Function}} [opts.out] the sign-in's stream, defaults to process.stderr
 * @returns {Promise<string>}
 */
const tokenWithSignIn = async (repo, {
  atKeyboard, signIn: runSignIn, out = process.stderr, ...opts
}) => {
  try {
    return await tokenFor(repo, opts);
  } catch (err) {
    if (!(err instanceof IdentityError) || err.code !== 'not_signed_in' || !atKeyboard()) throw err;
    out.write(`${err.message}\nsigning in now\n`);
  }
  await runSignIn();
  return tokenFor(repo, opts);
};

/**
 * Writes to a stream and resolves once the bytes are handed on, so a stderr
 * line after it lands after it in a merged capture.
 * @param {NodeJS.WritableStream} stream
 * @param {string} text
 * @returns {Promise<void>}
 */
const say = (stream, text) => new Promise((resolve) => { stream.write(text, () => resolve()); });

/**
 * The token form: the token on stdout, or the refusal's message on stderr and
 * its exit code. A sign-in it runs speaks on stderr, so stdout stays the token's.
 * @param {string} repo
 * @returns {Promise<number>}
 */
const printToken = async (repo) => {
  const out = process.stderr;
  try {
    const token = await tokenWithSignIn(repo, {
      atKeyboard: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
      signIn: () => signIn({ out }),
      out,
    });
    await say(process.stdout, `${token}\n`);
    return 0;
  } catch (err) {
    if (!(err instanceof IdentityError)) throw err;
    process.stderr.write(`${err.message}\n`);
    return EXIT_CODES[err.code] || 1;
  }
};

/**
 * The installation form, the same request as a token: `installed`, or
 * `not installed` with the service's message (the install page) on stderr.
 * @param {string} repo
 * @returns {Promise<number>}
 */
const printInstallation = async (repo) => {
  const login = signedIn(loginFile());
  try {
    await requestToken(repo, { settings: readSettings(), fetch: globalThis.fetch, login });
  } catch (err) {
    if (!(err instanceof IdentityError) || err.code !== 'not_installed') throw err;
    await say(process.stdout, 'not installed\n');
    process.stderr.write(`${err.message}\n`);
    return 0;
  }
  await say(process.stdout, 'installed\n');
  return 0;
};

/**
 * The command forms: a token, `installed` / `not installed`, or the status
 * object as JSON. Any failure not given its own code throws, which exits 1.
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  if (argv.length === 1 && !argv[0].startsWith('-')) return printToken(argv[0]);
  if (argv.length === 2 && argv[0] === '--installation') return printInstallation(argv[1]);
  if (argv.length === 1 && argv[0] === '--status') {
    const status = { ...loginStatus(loginFile()), tokenUrl: tokenUrlOf(readSettings()) };
    process.stdout.write(`${JSON.stringify(status)}\n`);
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

module.exports = { IdentityError, tokenFor, tokenWithSignIn, tokenUrlOf };
