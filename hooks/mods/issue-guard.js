/**
 * hooks/mods/issue-guard.js: safety:issue-guard, the mechanical half of the
 * spec's public-repo rule: a gh call bounces when its argv or a body file it
 * sends carries a local .env value (named by KEY) or a token shape (named by
 * kind). The gh shim's gate runs it on every call, opted in or not
 * (workflow/identity/gate.js, docs/hooks.md § safety:issue-guard).
 */

import { repoSlug } from './optin.js';

// The public GitHub names a text spells: a github.com/<o>/<n> URL, a REST
// repos/<o>/<n> path and a --repo/-R <o>/<n> flag (-R attached too, the value
// on the next line where an argv is joined by newlines), the name cut at the
// first character no name holds, then one trailing punctuation mark.
const GH_URL = /github\.com\/([^/\s#?"']+)\/([^/\s#?"']+)/g;
const REST_NAMED = /(?:^|[^A-Za-z0-9_.-])repos\/([^/\s#?"']+)\/([^/\s#?"']+)/g;
const REPO_NAMED = /(?:^|\s)(?:--repo(?:=|\s+)|-R(?:=|\s*))["']?([^/\s"']+)\/([^/\s#?"']+)/g;
const NAME_TAIL = /[.,;:)\]>`"']$/;

// The committed example and template variants hold public placeholders.
const ENV_SKIP = new Set(['.env.example', '.env.sample', '.env.template', '.env.defaults']);

// A .env key holding one of these pieces, in any case, names a secret.
const SECRET_KEY_PIECES = ['PASS', 'PWD', 'SECRET', 'TOKEN', 'KEY', 'CREDENTIAL'];

// The token shapes, in the order they are tried; the KIND is named, never the match.
const TOKENS = [
  [/(^|[^A-Za-z0-9_])(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/m, 'a GitHub token-shaped string'],
  [/(^|[^A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/m, 'a GitHub token-shaped string'],
  [/(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{16,}/m, 'an API key-shaped string (sk- prefix)'],
  [/(^|[^A-Za-z0-9_])AIza[A-Za-z0-9_-]{20,}/m, 'a Google API key-shaped string'],
  [/(^|[^A-Za-z0-9_])xox[bapos]-[A-Za-z0-9-]{10,}/m, 'a Slack token-shaped string'],
  [/(^|[^A-Za-z0-9_])AKIA[A-Z0-9]{12,}/m, 'an AWS access key-shaped string'],
  [/[-]{5}BEGIN/, 'a private key block'],
];

// A .env line's key and its value readings, or null for a comment, a blank or
// no `=`: the whole tail (one outer quote pair stripped), and the value with a
// trailing comment cut (a quoted one ends at its closing quote, a bare one
// before the first `#` after whitespace).
function envPair(line) {
  if (line === '' || line.startsWith('#') || !line.includes('=')) return null;
  const cut = line.indexOf('=');
  const key = line.slice(0, cut).replace(/^export /, '').replace(/\s/g, '');
  if (!key) return null;
  const tail = line.slice(cut + 1).trim();
  let whole = tail;
  if (/^".*"$/s.test(whole) || /^'.*'$/s.test(whole)) whole = whole.slice(1, -1);
  const quoted = tail.match(/^(["'])(.*?)\1(?:\s*#.*)?$/s);
  const bare = quoted ? quoted[2] : tail.split(/\s#/)[0].trim();
  return { key, values: whole === bare ? [whole] : [whole, bare] };
}

// An obviously non-secret value: too short to be a key, as every boolean is;
// under a key naming no secret also one lowercase word (prose uses it by
// chance), a bare number or version, or a local URL carrying no credentials.
function isPlain(key, value) {
  if ([...value].length < 8) return true;
  const upper = key.toUpperCase();
  if (SECRET_KEY_PIECES.some((piece) => upper.includes(piece))) return false;
  if (/^[a-z]+$/.test(value)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(value) && !value.includes('@')) return true;
  return /^[0-9.]*$/.test(value);
}

/**
 * The lowercase owner and name segments the text's GitHub URLs, REST repo
 * paths and repo flags spell, plus the two segments of the origin slug:
 * public by construction.
 * @param {string} text the outbound text
 * @param {string|null} slug the origin's `owner/name`, null for no origin
 * @returns {Set<string>}
 */
export function publicNames(text, slug) {
  const names = new Set();
  const add = (owner, name) => {
    names.add(owner.toLowerCase());
    names.add(name.replace(NAME_TAIL, '').replace(/\.git$/, '').toLowerCase());
  };
  for (const re of [GH_URL, REST_NAMED, REPO_NAMED]) {
    for (const m of text.matchAll(re)) add(m[1], m[2]);
  }
  if (slug) add(...slug.split('/'));
  return names;
}

// The key of the first local .env value the text carries and `names` does
// not hold (lowercase), or null. Each file is read by Node's reader and line
// by line, which keeps what Node drops: an earlier line of a repeated key, a
// bare value holding `#`, a line under an unclosed quote.
function envLeak(envFiles, text, names, parseEnv) {
  for (const { path, text: env } of envFiles) {
    if (ENV_SKIP.has(path.split('/').pop())) continue;
    const pairs = [
      ...Object.entries(parseEnv(env)).map(([key, value]) => ({ key, values: [value] })),
      ...env.split('\n').map(envPair).filter(Boolean),
    ];
    for (const { key, values } of pairs) {
      for (const value of values) {
        if (isPlain(key, value) || names.has(value.toLowerCase())) continue;
        if (text.includes(value)) return key;
      }
    }
  }
  return null;
}

// The kind of the first token shape or long high-entropy run the text carries.
function tokenLeak(text) {
  for (const [re, kind] of TOKENS) if (re.test(text)) return kind;
  // Both cases and a digit keep a hex sha out; `/` and `-` stay out of the
  // class, so an issue URL, a path or a branch name is never one long run.
  const runs = text.match(/[A-Za-z0-9_+=]{40,}/g) ?? [];
  return runs.some((run) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /[0-9]/.test(run)) ? 'a long high-entropy run' : null;
}

/**
 * issue-guard's scan of one outbound action: the block naming the key or the
 * kind its text or a body file carries, else null. It judges whatever it is
 * handed; which calls are outbound is the caller's to decide.
 * @param {{text: string, bodies?: string[], envFiles: Array<{path: string, text: string}>, slug: string|null, parseEnv: function(string): Object<string, string>}} facts
 *   the action's own text (the gh argv joined by newlines);
 *   each body file's text it sends, none when omitted; the local .env files,
 *   the session folder's then the repo root's; the origin's `owner/name`,
 *   null for none; Node's `.env` reader (`util.parseEnv`, the gate's), required
 * @returns {{deny: string}|null}
 */
export function leakVerdict({ text, bodies = [], envFiles, slug, parseEnv }) {
  if (typeof parseEnv !== 'function') throw new TypeError('leakVerdict: no parseEnv; the gate hands in util.parseEnv');
  const all = [text, ...bodies.map((body) => body.replace(/\n+$/, ''))].join('\n');
  const key = envLeak(envFiles, all, publicNames(all, slug), parseEnv);
  const found = key ? `the value of ${key} from a local .env file` : tokenLeak(all);
  if (!found) return null;
  return {
    deny: `issue-guard: BLOCKED this gh command: the outbound text carries ${found}.\nEvery repo workkit touches is assumed public, issues and PRs and comments included: no secrets, credentials, tokens, or private business or personal details. Keep that context in chat or in local files and reference it indirectly.`,
  };
}

// A folder's .env files, `.env` then `.env.*` in name order.
async function envFilesIn(dir, list, read) {
  const names = (await list(dir)).filter((name) => name === '.env' || name.startsWith('.env.')).sort();
  const files = await Promise.all(names.map(async (name) => ({ path: `${dir}/${name}`, text: await read(`${dir}/${name}`) })));
  return files.filter((file) => file.text !== null);
}

/**
 * The local facts leakVerdict reads for an action run in `cwd`: the .env
 * files of that folder and of the repo root above it, and, when it found any
 * .env file, the repo's origin slug.
 * @param {{cwd: string, top: function, read: function, list: function, run: function}} facts the reads
 * @returns {Promise<{envFiles: Array<{path: string, text: string}>, slug: string|null}>}
 */
export async function leakFacts({ cwd, top, read, list, run }) {
  const root = await top(cwd);
  const envFiles = [
    ...(await envFilesIn(cwd, list, read)),
    ...(root && root !== cwd ? await envFilesIn(root, list, read) : []),
  ];
  const slug = envFiles.length > 0 ? (await repoSlug(root ?? cwd, run)) || null : null;
  return { envFiles, slug };
}
