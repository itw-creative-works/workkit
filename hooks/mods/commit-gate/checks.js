/**
 * hooks/mods/commit-gate/checks.js: the commit gate's reads of plain text: the
 * commit clause's flags, what a committed path is (docs, a version manifest),
 * the version stamp's JSON compare, and the issues a message closes and
 * names. Plain functions; the git and gh reads are the gatherer's.
 */

import { redirectSpan, wordsOf } from '../command.js';
import { isPlain, parseJson } from '../settings.js';
import { CODE_EXT } from '../test-reminder.js';

// Every long flag that takes a SEPARATE value: the quote strip leaves the
// value as a visible token, so a flag missing here would read it as a pathspec.
const VALUE_LONG = new Set([
  '--message', '--file', '--author', '--date', '--trailer', '--fixup', '--squash',
  '--cleanup', '--pathspec-from-file', '--gpg-sign', '--reuse-message', '--reedit-message',
]);
const ELSEWHERE = "Run the commit from the repo's own directory so the gate can see its staging.";

// The trailer that closes an issue, read per line off the RAW command.
const TRAILER = /(^|[^A-Za-z0-9])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[ \t\r\f\v]+#[0-9]+/gim;
// A #N glued to a run that opens with a letter, `_`, `.`, `/`, `-`, `&` or `$` is another thing's.
const GLUED = /[A-Za-z_./&$-][A-Za-z0-9_./&$-]*#[0-9]+/g;

/**
 * The commit clause's flags, walked past `commit`: `-a`/`--all`, and whether
 * a pathspec rides along (the commit then bypasses staging); a redirect is
 * syntax, never an argument. A `-C`, `--git-dir`, `--work-tree`, `GIT_DIR=`
 * or `GIT_WORK_TREE=` before `commit` aims it at another repo: the deny.
 * @param {string} clause the quote-stripped commit clause (findGitCommit's)
 * @returns {{all: boolean, pathspec: boolean}|{deny: string}}
 */
export function commitFlags(clause) {
  const flags = { all: false, pathspec: false };
  let seen = false;
  let skip = 0;
  for (const w of wordsOf(clause)) {
    if (skip > 0) {
      skip -= 1;
    } else if (!seen) {
      if (w === '-C') return { deny: `uses 'git -C'. ${ELSEWHERE}` };
      if (/^--(git-dir|work-tree)(=|$)/.test(w)) return { deny: `uses '${w.split('=')[0]}'. ${ELSEWHERE}` };
      if (/^(GIT_DIR|GIT_WORK_TREE)=/.test(w)) return { deny: `sets ${w.split('=')[0]}. ${ELSEWHERE}` };
      if (w === 'commit') seen = true;
    } else if (w === '--') {
      return { ...flags, pathspec: true };
    } else if (w === '--all') {
      flags.all = true;
    } else if (VALUE_LONG.has(w)) {
      skip = 1;
    } else if (w.startsWith('--')) {
      // --message=, --file= and every other long flag carry their own value.
    } else if (w.length > 1 && w[0] === '-') {
      if (w.includes('a')) flags.all = true;
      // Only a value-taking letter at the END consumes the next word: `-m_hookq_` has its value.
      if (/[mFtcC]$/.test(w)) skip = 1;
    } else if ((w.includes('<') || w.includes('>')) && redirectSpan(w) > 0) {
      skip = redirectSpan(w) - 1;
    } else {
      flags.pathspec = true;
    }
  }
  return flags;
}

/**
 * Whether a committed path reads as docs: under a docs folder unless its
 * extension is code (an executable script there is code), and a docs
 * basename (`*.md`, CHANGELOG, LICENSE) wherever it lives.
 * @param {string} path a repo-relative path
 * @returns {boolean}
 */
export function isDocPath(path) {
  const base = path.split('/').pop();
  if (/\.md$/.test(base) || /^(CHANGELOG|LICENSE)(\..*)?$/.test(base)) return true;
  return /(^|\/)docs\//.test(path) && !CODE_EXT.test(base);
}

/**
 * Whether a path is a version manifest, a package.json or a
 * .claude-plugin/plugin.json at any depth, which a version-only bump keeps out
 * of the code a commit carries.
 * @param {string} path a repo-relative path
 * @returns {boolean}
 */
export function isManifest(path) {
  return /(^|\/)package\.json$/.test(path) || /(^|\/)\.claude-plugin\/plugin\.json$/.test(path);
}

// A value as text with every object's keys sorted, so two parses compare whole.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const parsedObject = (text) => {
  const value = parseJson(text);
  return isPlain(value) ? value : null;
};

// The object less its version, every dependency pin equal to that version marked as moving with it.
function lockstep(object) {
  const { version = null, ...rest } = object;
  const pinned = canonical(version);
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => {
    if (!/[dD]ependencies$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return [key, value];
    return [key, Object.fromEntries(Object.entries(value).map(([name, pin]) => [name, canonical(pin) === pinned ? '<lockstep>' : pin]))];
  }));
}

/**
 * Whether two texts of one JSON file differ only in `version`, or in it and
 * the exact dependency pins equal to it on each side. Text that does not parse
 * as an object is a no.
 * @param {string} head the file at HEAD
 * @param {string} copy the bytes the commit carries
 * @returns {boolean}
 */
export function versionOnly(head, copy) {
  const a = parsedObject(head);
  const b = parsedObject(copy);
  if (!a || !b) return false;
  const bare = ({ version, ...rest }) => canonical(rest);
  return bare(a) === bare(b) || canonical(lockstep(a)) === canonical(lockstep(b));
}

/**
 * Whether the raw command carries a closing trailer (`Fixes #N`), the one
 * parse closedIssues makes.
 * @param {string} command the raw command
 * @returns {boolean}
 */
export function closesAny(command) {
  return closedIssues(command).length > 0;
}

/**
 * The issue numbers the message closes, one per closing trailer.
 * @param {string} command the raw command
 * @returns {number[]}
 */
export function closedIssues(command) {
  return [...command.matchAll(TRAILER)].map((m) => Number(m[0].match(/[0-9]+$/)[0]));
}

/**
 * Every issue the command names as a plain `#N`, ascending and each once; a
 * `#N` glued to a run opening with a letter, `_`, `.`, `/`, `-`, `&` or `$`
 * (owner/repo#N, page#N, &#N, $#) is not one, and digits alone open none.
 * @param {string} command the raw command
 * @returns {number[]}
 */
export function namedIssues(command) {
  const numbers = [...command.replace(GLUED, '').matchAll(/#([0-9]+)/g)].map((m) => Number(m[1]));
  return [...new Set(numbers)].sort((x, y) => x - y);
}
