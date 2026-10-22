/**
 * hooks/mods/commit-language.js: safety:commit-language, the mechanical half
 * of two commit rules: no kill/destroy/dead wording in a message, and a
 * Conventional Commits subject (at most 72 characters) carrying no version
 * outside `chore(release)`. Only the quoted message-flag spans of a real
 * commit are read (docs/hooks.md § safety:commit-language).
 */

import { VERSION_RE, findGitCommit } from './command.js';

// A message flag and its quoted span: -m, --message, -F, --file, attached or not.
const FLAG_SPAN = /(?:^|[ \t\n\r\f\v;&|({])(?:-[a-zA-Z]*[mF]|--message|--file)[= \t\n\r\f\v]*("(?:[^"\\]|\\[\s\S])*"|'[^']*')/g;
const ANY_SPAN = /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'/g;
const WORD = 'A-Za-z0-9_';
const VOCABULARY = new RegExp(`(?<![${WORD}])(kill(s|ed|ing)?|destroy(s|ed|ing)?|dead)(?![${WORD}])`, 'gi');
const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test)(\([^)]+\))?!?: [^A-Z]/;
const VERSION = new RegExp(`(?<![${WORD}])v?[0-9]+\\.[0-9]+\\.[0-9]+(?![${WORD}])`);
const RELEASE = new RegExp(`^chore\\(release\\): ${VERSION_RE}$`);
const GENERATED = /^(Merge |Revert |fixup! |squash! )/;
const MAX_SUBJECT = 72;

const PREFIX = 'commit-language: BLOCKED this commit:';

// Each message-flag span's inside, in order, read from `text`.
const flagSpans = (text) => [...text.matchAll(FLAG_SPAN)].map((m) => m[1].slice(1, -1));

// Lines joined as a shell substitution keeps them: every trailing newline dropped.
const joined = (spans) => spans.map((s) => `${s}\n`).join('').replace(/\n+$/, '');

// The words found, sorted and deduplicated without regard to case, each followed by a space.
function vocabularyOf(text) {
  const seen = new Map();
  for (const lineText of text.split('\n')) {
    for (const [word] of lineText.matchAll(VOCABULARY)) {
      if (!seen.has(word.toUpperCase())) seen.set(word.toUpperCase(), word);
    }
  }
  return [...seen.keys()].sort().map((key) => `${seen.get(key)} `).join('');
}

// The spans from the first `commit` word whose tail yields any.
function subjectSpans(command) {
  for (const { index } of command.matchAll(/\bcommit\b/g)) {
    const spans = flagSpans(command.slice(index));
    if (spans.length > 0) return joined(spans);
  }
  return '';
}

// The subject line to judge, or '' when there is none to read.
function subjectOf(command) {
  const spans = subjectSpans(command);
  if (!spans) return '';
  const lines = spans.split('\n');
  let subject = lines[0];
  if (/\$\(.*<</s.test(subject)) subject = lines[1] ?? '';
  if (subject.includes('$(')) return '';
  return subject.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
}

/**
 * commit-language's verdict on a Bash command: the first rule it breaks, as
 * a deny, or null.
 * @param {{command: string, cwd: string, originless: boolean}} facts the
 *   command, the folder it runs in, and whether that folder is a git work
 *   tree with no origin (a scratch or fixture repo, outside the pipeline)
 * @returns {{deny: string}|null}
 */
export function commitLanguageVerdict({ command, originless }) {
  if (!command) return null;
  const found = findGitCommit(command);
  if ((!found.clause && !found.wrapped) || originless) return null;
  const flagged = joined(flagSpans(command));
  const quoted = flagged || joined([...command.matchAll(ANY_SPAN)].map((m) => m[1] ?? m[2]));
  if (!quoted) return null;
  const words = vocabularyOf(quoted);
  if (words) {
    return { deny: `${PREFIX} the message uses non-neutral vocabulary: ${words}\nReword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, keep it unquoted in the command or rephrase around it.` };
  }
  const subject = subjectOf(command);
  if (!subject || GENERATED.test(subject)) return null;
  if (!CONVENTIONAL.test(subject)) {
    return { deny: `${PREFIX} the subject line is not Conventional Commits: ${subject}\nWrite it as <type>(<scope>): <subject> with type one of feat/fix/docs/chore/refactor/test and a lowercase first word, e.g. fix(hooks): bounce the empty span.` };
  }
  const length = [...subject].length;
  if (length > MAX_SUBJECT) {
    return { deny: `${PREFIX} the subject line is ${length} characters, over the 72-character limit.\nShorten the subject and move the detail into the commit body.` };
  }
  if (VERSION.test(subject) && !RELEASE.test(subject)) {
    return { deny: `${PREFIX} the subject line carries a version number: ${subject}\nOnly the release commit names a version, as chore(release): <x.y.z>. Describe the change instead; the version bump is its own commit.` };
  }
  return null;
}

/**
 * The guard's run over the Bash facts: the origin is asked only for a real
 * commit, so a plain command costs no git call.
 * @param {{command: string, cwd: string, originless: function}} facts the
 *   chain's facts, `originless()` async
 * @returns {Promise<{deny: string}|null>}
 */
export async function commitLanguageGuard(facts) {
  const found = findGitCommit(facts.command);
  if (!found.clause && !found.wrapped) return null;
  return commitLanguageVerdict({ command: facts.command, cwd: facts.cwd, originless: await facts.originless() });
}
