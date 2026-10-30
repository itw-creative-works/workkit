// workflow/public/lib.js: what the three `workkit public` verbs share: the
// pairing key, the `Public:` link line, the status labels, the line writers, and
// `gh` called by name so the shim and a test's stub answer it (workflow/README.md, the
// public/ row; docs/project-state.md § Capture, the public pairing).
// Usage: const { pairing, publicLink, gh } = require('./lib');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// An owner/name slug. The twin of PUBLIC_SLUG_RE in standards/labels.sh,
// pinned by test/hooks/twins.test.js: change one and change the other.
const SLUG = '[A-Za-z0-9-]+/[A-Za-z0-9._-]+';
const SLUG_RE = new RegExp(`^${SLUG}$`);
// The one link every step reads: the private issue's first body line.
const LINK_RE = new RegExp(`^Public: https://github\\.com/(${SLUG})/issues/([0-9]+)\\s*$`);
const STATUS = 'status:';

/** A refusal the verb prints on stderr before it exits 1. */
class PublicError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublicError';
  }
}

/**
 * Runs `gh` by name with the arguments as given.
 * @param {string[]} args
 * @param {{cwd: string}} opts
 * @returns {{ok: boolean, stdout: string, stderr: string}}
 */
const runGh = (args, { cwd }) => {
  const r = spawnSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  const stderr = r.error ? r.error.message : (r.stderr || '');
  return { ok: !r.error && r.status === 0, stdout: r.stdout || '', stderr };
};

/**
 * A gh write, or a PublicError naming it and gh's own words.
 * @param {function} gh the runner
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string} gh's stdout
 */
const ghWrite = (gh, args, cwd) => {
  const r = gh(args, { cwd });
  if (!r.ok) throw new PublicError(`gh ${args.slice(0, 2).join(' ')} failed: ${r.stderr.trim().split('\n').pop() || 'gh failed'}`);
  return r.stdout;
};

/**
 * A gh call's JSON answer: ghWrite's call, its stdout parsed, or a PublicError
 * naming the call when it answered no JSON.
 * @param {function} gh the runner (runGh's shape)
 * @param {string[]} args
 * @param {string} cwd
 * @returns {any}
 */
const ghJson = (gh, args, cwd) => {
  const stdout = ghWrite(gh, args, cwd);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new PublicError(`gh ${args.slice(0, 2).join(' ')} answered no JSON`);
  }
};

/** A verb's default line writer to stdout. */
const outLine = (line) => process.stdout.write(`${line}\n`);

/** A verb's default line writer to stderr. */
const warnLine = (line) => process.stderr.write(`${line}\n`);

/**
 * The repo root holding `cwd`, or a PublicError outside every repo.
 * @param {string} cwd
 * @returns {string}
 */
const repoRoot = (cwd) => {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new PublicError(`${cwd} is not inside a git repo`);
  return r.stdout.trim();
};

/**
 * The `public` key of the repo's committed `.workkit/settings.json`: `{ repo }`
 * for a slug, `{ invalid }` for any other value, null when there is none.
 * @param {string} root the repo root
 * @returns {{repo: string}|{invalid: string}|null}
 */
const publicKey = (root) => {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(root, '.workkit', 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
  const value = settings && typeof settings === 'object' ? settings.public : undefined;
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && SLUG_RE.test(value) ? { repo: value } : { invalid: JSON.stringify(value) };
};

/**
 * The pairing a verb acts on: the root and the public slug, or null when the
 * repo has none. A key that is no slug leaves the pairing off, said on stderr.
 * @param {string} cwd
 * @returns {{root: string, repo: string}|null}
 */
const pairing = (cwd) => {
  const root = repoRoot(cwd);
  const key = publicKey(root);
  if (key && key.invalid) {
    process.stderr.write(`public: the public key in .workkit/settings.json is ${key.invalid}, not an owner/name slug, so the pairing is off\n`);
    return null;
  }
  return key ? { root, repo: key.repo } : null;
};

/**
 * The public issue a private body links to, read off its first line.
 * @param {string} body the private issue's body
 * @returns {{repo: string, number: string, url: string}|null}
 */
const publicLink = (body) => {
  const first = String(body || '').replace(/^\s+/, '').split('\n')[0].replace(/\r$/, '');
  const m = LINK_RE.exec(first);
  return m ? { repo: m[1], number: m[2], url: `https://github.com/${m[1]}/issues/${m[2]}` } : null;
};

/**
 * The link line for a public issue.
 * @param {string} url the public issue's URL
 * @returns {string}
 */
const linkLine = (url) => `Public: ${url}`;

/**
 * The status labels among gh's `labels` field, by name.
 * @param {Array<{name: string}>} labels
 * @returns {string[]}
 */
const statusLabels = (labels) => (labels || []).map((l) => l.name).filter((n) => n.startsWith(STATUS));

/**
 * Issue numbers from `N` or `#N` arguments, or a PublicError naming the first
 * that is neither.
 * @param {string[]} args
 * @returns {string[]}
 */
const issueNumbers = (args) => args.map((a) => {
  const n = String(a).replace(/^#/, '');
  if (!/^[0-9]+$/.test(n)) throw new PublicError(`${a} is not an issue number`);
  return n;
});

/**
 * A verb's entry: runs it, prints a PublicError's message after `public:`,
 * and exits with the code it answered (1 for a refusal).
 * @param {function(): number} verb
 */
const main = (verb) => {
  try {
    process.exitCode = verb();
  } catch (err) {
    if (!(err instanceof PublicError)) throw err;
    process.stderr.write(`public: ${err.message}\n`);
    process.exitCode = 1;
  }
};

module.exports = {
  SLUG_RE, STATUS, PublicError, runGh, ghJson, ghWrite, outLine, warnLine, repoRoot, publicKey, pairing, publicLink,
  linkLine, statusLabels, issueNumbers, main,
};
