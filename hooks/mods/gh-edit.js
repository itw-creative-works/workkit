/**
 * hooks/mods/gh-edit.js: the read of a `gh issue edit|close|create` command
 * the guards share: the raw match, the clause split and its walk, the
 * subcommand, a flag's values, the repo and whether it is the session's, the
 * issue numbers, and the texts the gh guards answer with. Plain functions over text.
 */

import { BLANK, PLACEHOLDER, clauseChangesDir, foldRedirectAmp, redirectSpan, stripHeredocs, stripQuotes, wordsOf } from './command.js';

const ISSUE_URL = /https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/issues\/[0-9]+/;
const REPO_FLAG = /(^|[ \t\r\f\v])(--repo([= \t\r\f\v]|$)|-R)/m;
const NO_VALUE = new Set(['--remove-milestone', '--help', '-h']);

/**
 * Whether the text spells `gh issue <sub>` for one of the |-separated
 * subcommands as a command, not inside a path or a longer name: the cheap read
 * a hook makes on the raw command before any split.
 * @param {string} text the command text
 * @param {string} subs the subcommands, `edit|close`
 * @returns {boolean}
 */
export function ghNames(text, subs) {
  return new RegExp(`(^|[^A-Za-z0-9_./-])gh${BLANK}+issue${BLANK}+(${subs})(${BLANK}|$)`, 'm').test(text);
}

/**
 * `edit` or `close`, whichever the quote-stripped clause first runs as
 * `gh issue <sub>`; '' when it runs neither.
 * @param {string} clause one quote-stripped clause
 * @returns {string}
 */
export function ghClauseSub(clause) {
  const match = clause.match(new RegExp(`(^|[^A-Za-z0-9_./-])gh${BLANK}+issue${BLANK}+(edit|close)(${BLANK}|$)`, 'm'));
  return match ? match[2] : '';
}

/**
 * Whether the repo value names the session tree's origin, owner/name in any
 * letter case. No origin is never here.
 * @param {string} repo the `--repo` value
 * @param {string} here the session tree's origin slug, '' when it has none
 * @returns {boolean}
 */
export function ghRepoIsHere(repo, here) {
  return Boolean(here) && repo.toLowerCase() === here.toLowerCase();
}

/**
 * The clauses, in one pass: a separator inside a quoted span is data, and a
 * line break inside one becomes a space.
 * @param {string} text the command text
 * @returns {string[]}
 */
export function ghClauses(text) {
  let all = '';
  let st = '';
  for (const line of text.replace(/\n$/, '').split('\n')) {
    let out = '';
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (st === '' && (c === '"' || c === "'")) {
        st = c;
        out += c;
      } else if (st !== "'" && c === '\\') {
        out += line.slice(i, i + 2);
        i += 1;
      } else if (st === '' && (c === ';' || c === '|' || c === '&')) {
        out += '\n';
      } else {
        if (c === st) st = '';
        out += c;
      }
    }
    all += `${out}${st === '' ? '\n' : ' '}`;
  }
  return all.replace(/\n+$/, '').split('\n');
}

// The clause's words, a quoted span kept whole and a backslash keeping the next character.
function flagWords(clause) {
  const words = [];
  for (const line of clause.split('\n')) {
    let w = '';
    let st = '';
    let inWord = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (st === '' && (c === ' ' || c === '\t')) {
        if (inWord) words.push(w);
        w = '';
        inWord = false;
        continue;
      }
      inWord = true;
      w += c;
      if (st === '' && (c === '"' || c === "'")) st = c;
      else if (st !== "'" && c === '\\' && i < line.length - 1) w += line[++i];
      else if (st !== '' && c === st) st = '';
    }
    if (inWord) words.push(w);
  }
  return words;
}

/**
 * Every value the clause hands the flag, raw (`--flag v`, `--flag=v`, `-Sv`),
 * a redirect before a separate value skipped. A quoted span is one word, so a
 * flag named in a body is part of the body's word.
 * @param {string} clause one clause
 * @param {string} long the long flag (`--repo`)
 * @param {string} [short] the short flag (`-R`)
 * @returns {string[]}
 */
export function ghFlagValues(clause, long, short) {
  const values = [];
  let want = false;
  let skip = 0;
  for (const w of flagWords(clause)) {
    if (skip > 0) {
      skip -= 1;
    } else if (want) {
      const span = redirectSpan(w);
      if (span > 0) {
        skip = span - 1;
      } else {
        want = false;
        values.push(w);
      }
    } else if (w === long || (short && w === short)) {
      want = true;
    } else if (w.startsWith(`${long}=`)) {
      values.push(w.slice(long.length + 1));
    } else if (short && w.startsWith(short)) {
      values.push(w.slice(short.length));
    }
  }
  return values;
}

/**
 * The first `--repo`/`-R` value in any spelling gh takes, quotes off; with no
 * flag, the repo an issue URL names (read off the quote-stripped clause, so a
 * body naming either is not one); else ''. Null when the value cannot be
 * resolved here (empty, a variable, a substitution).
 * @param {string} clause one clause
 * @returns {string|null}
 */
export function ghRepo(clause) {
  const stripped = stripQuotes(clause);
  if (!REPO_FLAG.test(stripped)) {
    const url = stripped.match(ISSUE_URL)?.[0];
    if (!url) return '';
    return url.slice('https://'.length).replace(/\/issues\/[^/]*$/, '').replace(/^github\.com\//, '');
  }
  const repo = (ghFlagValues(clause, '--repo', '-R')[0] ?? '').replace(/["']/g, '');
  if (repo === '' || /[$`]/.test(repo) || repo.includes(PLACEHOLDER)) return null;
  return repo;
}

/**
 * The issue numbers after `gh issue <sub>`, each once: every positional (a
 * number, `#N`, an issue URL's tail) among the flags. A bare flag takes the
 * next word unless gh gives it no value; a redirect is never the positional.
 * @param {string} clause one quote-stripped clause
 * @param {string} sub `edit` or `close`
 * @returns {string[]}
 */
export function ghIssueNumbers(clause, sub) {
  const head = new RegExp(`^.*gh${BLANK}+issue${BLANK}+${sub}${BLANK}+`);
  const tokens = clause.split('\n')[0].replace(head, '').split(/[ \t]+/).filter(Boolean);
  const issues = [];
  let skip = 0;
  let opts = true;
  for (const tok of tokens) {
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    if ((tok.includes('>') || tok.includes('<')) && redirectSpan(tok) > 0) {
      skip = redirectSpan(tok) - 1;
      continue;
    }
    if (opts && tok[0] === '-') {
      if (tok === '--') opts = false;
      else if (!NO_VALUE.has(tok) && !/^--.*=/.test(tok) && (tok.startsWith('--') || tok.length === 2)) skip = 1;
      continue;
    }
    let n = tok.replace(/^#/, '');
    if (/^https:\/\/.*\/issues\//.test(n)) n = n.replace(/^.*\/issues\//, '').replace(/[/?#].*$/, '');
    if (/^[0-9]+$/.test(n) && !issues.includes(n)) issues.push(n);
  }
  return issues;
}

/**
 * Each clause of a command's gh walk, the heredocs stripped and a redirect's
 * `&` folded first: the raw clause, its quote-stripped copy, and whether a
 * clause that changes directory came before it (that clause is not yielded).
 * @param {string} command the command text
 * @yields {{clause: string, detect: string, sawCd: boolean}}
 */
export function* ghSteps(command) {
  let sawCd = false;
  for (const clause of ghClauses(foldRedirectAmp(stripHeredocs(command)))) {
    if (!clause) continue;
    const detect = stripQuotes(clause);
    if (clauseChangesDir(wordsOf(detect))) sawCd = true;
    else yield { clause, detect, sawCd };
  }
}

/**
 * A gh guard's deny, the notes gathered so far leading it.
 * @param {string[]} notes the notes, read when the deny is made
 * @returns {function(string): {deny: string}}
 */
export const denyAfter = (notes) => (text) => ({ deny: [...notes, text].join('\n') });

/**
 * A gh guard's notice for an issue it could not read.
 * @param {string} hook the hook (`proof-guard`)
 * @param {string} gate what did not run (`proof gate`)
 * @returns {function(string, string): string} `(n, why)` to the line
 */
export const ghSkipped = (hook, gate) => (n, why) => `${hook}: could not read issue #${n} (${why}), so the ${gate} did not run on this command.`;

/**
 * The bounce for a gated flip or close behind a cd, pushd or popd: the hook
 * judges the session's directory, so that command acts on a tree and repo it
 * cannot see.
 * @param {string} hook the bouncing hook (`proof-guard`)
 * @returns {string} the deny text
 */
export function ghBlocksCd(hook) {
  return `${hook}: BLOCKED this command. It changes directory (cd, pushd or popd) before a gated gh issue flip or close, so the gate cannot tell which tree and repo that command acts on. Run the cd in its own Bash call first, then the gh command alone; where the directory resets between calls (a subagent), run the flip from a session whose directory is that repo.`;
}
