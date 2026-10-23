/**
 * hooks/mods/issue-guard.js: safety:issue-guard, the mechanical half of the
 * spec's public-repo rule: a gh issue or PR write, a GraphQL discussion or
 * issue mutation, or a REST write to an issue or pull endpoint bounces when
 * its text or body file carries a local .env value (named by KEY) or a token
 * shape (named by kind). It runs opted in or not (docs/hooks.md § safety:issue-guard).
 */

import { BLANK, anyLine } from './command.js';

// grep reads a command line by line, so every pattern here is tried per line.
const GH_WORD = '(^|[^A-Za-z0-9_./-])gh';
const ISSUE_WRITE = new RegExp(`${GH_WORD}${BLANK}+(issue${BLANK}+(create|comment|edit|close|reopen)|pr${BLANK}+(create|comment|edit|merge|close))(${BLANK}|$)`);
const GRAPHQL = new RegExp(`${GH_WORD}${BLANK}+api${BLANK}+graphql(${BLANK}|$)`);
const MUTATION = /mutation/i;
const MUTATION_NAME = /(create|update|add|delete)(Discussion|DiscussionComment|Issue|IssueComment|Comment)/i;
const GH_API = new RegExp(`${GH_WORD}${BLANK}+api(${BLANK}|$)`);
const GH_API_ALL = new RegExp(GH_API.source, 'g');
const ISSUE_PATH = new RegExp(`(^|[^A-Za-z0-9_.-])(https://api\\.github\\.com/)?/?repos/[^/ \\t\\v\\f\\r]+/[^/ \\t\\v\\f\\r]+/(issues|pulls)([^A-Za-z0-9_-]|$)`);
const FIELD_TAIL = new RegExp(`${BLANK}(-[fF]|--field|--raw-field|--input)[= \\t\\v\\f\\r][\\s\\S]*$`);
const WRITE_METHOD = new RegExp(`(^|${BLANK})(-X|--method)[= \\t\\v\\f\\r]+["']?(POST|PATCH|PUT)`, 'i');
const ANY_METHOD = new RegExp(`(^|${BLANK})(-X|--method)[= \\t\\v\\f\\r]`);
const ANY_FIELD = new RegExp(`(^|${BLANK})(-[fF]|--field|--raw-field|--input)[= \\t\\v\\f\\r]`);
const BODY_FLAG = new RegExp(`(--body-file|--raw-field|--field|--input|(^|${BLANK})-F)[= \\t\\v\\f\\r]+[^ \\t\\v\\f\\r]+`, 'g');
const BODY_FLAG_HEAD = new RegExp(`^${BLANK}*(--body-file|--raw-field|--field|--input|-F)[= \\t\\v\\f\\r]+`);
const AT_FILE = new RegExp(`(^|${BLANK})(-[fF]|--field|--raw-field)[= \\t\\v\\f\\r]+[A-Za-z_][A-Za-z0-9_]*=["']?@[^ \\t\\v\\f\\r"']+`, 'g');

// The committed example and template variants hold public placeholders.
const ENV_SKIP = new Set(['.env.example', '.env.sample', '.env.template', '.env.defaults']);

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

const matchesOf = (text, re) => text.split('\n').flatMap((line) => line.match(re) ?? []);

// One leading and one trailing double quote, then the same for single quotes.
const unquote = (word) => word.replace(/^"/, '').replace(/"$/, '').replace(/^'/, '').replace(/'$/, '');

// The REST door: the whole repos/<o>/<n>/(issues|pulls) tree by prefix. A
// write is an explicit POST|PATCH|PUT or a field-carrying call; the read
// exemption reads the method only before the first field, of one `gh api` call.
function restWrite(command) {
  if (!anyLine(command, GH_API) || !anyLine(command, ISSUE_PATH)) return false;
  const lead = command.split('\n').map((line) => line.replace(FIELD_TAIL, '')).join('\n');
  if (anyLine(lead, WRITE_METHOD)) return true;
  if (matchesOf(command, GH_API_ALL).length === 1 && anyLine(lead, ANY_METHOD)) return false;
  return anyLine(command, ANY_FIELD);
}

/**
 * Whether a command is an outbound gh write the guard reads: an issue or PR
 * write (close and reopen too: their --comment posts free text), a GraphQL
 * discussion or issue mutation, or a REST write to an issue or pull endpoint.
 * @param {string} command the Bash command
 * @returns {boolean}
 */
function isOutbound(command) {
  if (!command) return false;
  if (anyLine(command, ISSUE_WRITE)) return true;
  if (anyLine(command, GRAPHQL) && anyLine(command, MUTATION) && anyLine(command, MUTATION_NAME)) return true;
  return restWrite(command);
}

/**
 * The body files an outbound command sends, each as the command spells it
 * with one pair of quotes dropped: `--body-file`, `-F`, the field flags, the
 * REST `--input`, then the GraphQL variable form `-F body=@<path>`.
 * @param {string} command the Bash command
 * @returns {string[]}
 */
function bodyPaths(command) {
  const flagged = matchesOf(command, BODY_FLAG).map((m) => m.replace(BODY_FLAG_HEAD, ''));
  const atFiles = matchesOf(command, AT_FILE).map((m) => m.replace(/^.*@/, ''));
  return [...flagged, ...atFiles].map(unquote).filter(Boolean);
}

// A .env line's key and value, or null for a comment, a blank or no `=`.
function envPair(line) {
  if (line === '' || line.startsWith('#') || !line.includes('=')) return null;
  const cut = line.indexOf('=');
  const key = line.slice(0, cut).replace(/^export /, '').replace(/\s/g, '');
  if (!key) return null;
  let value = line.slice(cut + 1).trim();
  if (/^".*"$/s.test(value) || /^'.*'$/s.test(value)) value = value.slice(1, -1);
  return { key, value };
}

// An obviously non-secret value: too short to be a key, one lowercase word
// (prose uses it by chance), a boolean, a bare number or version, or a local
// URL carrying no credentials.
function isPlain(value) {
  if ([...value].length < 8) return true;
  if (/^[a-z]+$/.test(value)) return true;
  if (/^([Tt]rue|[Ff]alse|TRUE|FALSE)$/.test(value)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(value) && !value.includes('@')) return true;
  return /^[0-9.]*$/.test(value);
}

// The key of the first local .env value the text carries, or null.
function envLeak(envFiles, text) {
  for (const { path, text: env } of envFiles) {
    if (ENV_SKIP.has(path.split('/').pop())) continue;
    for (const line of env.split('\n')) {
      const pair = envPair(line);
      if (pair && !isPlain(pair.value) && text.includes(pair.value)) return pair.key;
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
 * issue-guard's verdict on a Bash command: the block naming the key or the
 * kind its outbound text carries, else null.
 * @param {{command: string, envFiles: Array<{path: string, text: string}>, bodies: object}} facts
 *   the command; the local .env files, the session folder's then the repo
 *   root's; each body file's text by the path `bodyPaths` names it, a path
 *   that is no file left out
 * @returns {{deny: string}|null}
 */
export function issueGuardVerdict({ command, envFiles, bodies }) {
  if (!isOutbound(command)) return null;
  const parts = [command];
  for (const path of bodyPaths(command)) {
    if (typeof bodies[path] === 'string') parts.push(bodies[path].replace(/\n+$/, ''));
  }
  const text = parts.join('\n');
  const key = envLeak(envFiles, text);
  const found = key ? `the value of ${key} from a local .env file` : tokenLeak(text);
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
 * The guard's run over the Bash facts: an outbound command reads its body
 * files and the .env files of its folder and of the repo root above it.
 * @param {{command: string, cwd: string, top: function, read: function, list: function}} facts the chain's facts
 * @returns {Promise<{deny: string}|null>}
 */
export async function issueGuardGuard({ command, cwd, top, read, list }) {
  if (!isOutbound(command)) return null;
  const bodies = {};
  for (const path of bodyPaths(command)) {
    const text = await read(path.startsWith('/') ? path : `${cwd}/${path}`);
    if (text !== null) bodies[path] = text;
  }
  const root = await top(cwd);
  const envFiles = [
    ...(await envFilesIn(cwd, list, read)),
    ...(root && root !== cwd ? await envFilesIn(root, list, read) : []),
  ];
  return issueGuardVerdict({ command, envFiles, bodies });
}
