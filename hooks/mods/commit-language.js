/**
 * hooks/mods/commit-language.js: safety:commit-language, the mechanical half
 * of two commit rules: no kill/destroy/dead wording in a message, and a
 * Conventional Commits subject (at most 72 characters) carrying no version
 * outside `chore(release)`, judged in git's commit-msg hook on the message
 * git commits (workflow/githooks/judge.js, docs/hooks.md § safety:commit-language).
 */

/**
 * The release subject's version, as a regex source: this hook and
 * release-taken both read it, so one never accepts a release the other misses.
 */
export const VERSION_RE = 'v?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?';

const WORD = 'A-Za-z0-9_';
const VOCABULARY = new RegExp(`(?<![${WORD}])(kill(s|ed|ing)?|destroy(s|ed|ing)?|dead)(?![${WORD}])`, 'gi');
const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test)(\([^)]+\))?!?: [^A-Z]/;
const VERSION = new RegExp(`(?<![${WORD}])v?[0-9]+\\.[0-9]+\\.[0-9]+(?![${WORD}])`);
const RELEASE = new RegExp(`^chore\\(release\\): ${VERSION_RE}$`);
const GENERATED = /^(Merge |Revert |fixup! |squash! )/;
const MAX_SUBJECT = 72;

const PREFIX = 'commit-language: BLOCKED this commit:';

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

/**
 * commit-language's verdict on a commit's message: the first rule it breaks,
 * as a deny, or null. The subject is the message's first line; merge, revert,
 * fixup and squash subjects skip the format rules, never the vocabulary.
 * @param {string} message the text git commits
 * @returns {{deny: string}|null}
 */
export function commitLanguageVerdict(message) {
  const words = vocabularyOf(message);
  if (words) {
    return { deny: `${PREFIX} the message uses non-neutral vocabulary: ${words}\nReword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, rephrase the message around it: the hook reads the message git commits, so quoting the word does not hide it.` };
  }
  const subject = message.split('\n')[0].replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
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
