/**
 * hooks/mods/bare-call.js: workflow:bare-call. A kit verb with an allow rule
 * (`workkit ship <verb>` for each ALLOWED_SHIP_VERBS entry, `workkit review
 * ...`) matches that rule only as a bare call, so a compound, a prefix or a
 * redirect around it gets a one-line notice naming the bare form; never a deny
 * (docs/hooks.md § workflow:bare-call).
 */

import {
  PLACEHOLDER, count, foldRedirectAmp, peelPrefixes, redirectSpan, stepDirs, stripHeredocs, stripQuotesKeeping, wordsOf,
} from './command.js';

/**
 * The `workkit ship` verbs with an allow rule: workflow/workkit/ship.sh's
 * SHIP_VERBS less deploy, in its order, held to allow.sh's ALLOW_RULES by a twin.
 */
export const ALLOWED_SHIP_VERBS = ['items', 'release', 'watch', 'cut', 'plan', 'publish'];

// The indices of the words left once each redirection and its target is dropped.
function keptIndices(words) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const span = redirectSpan(words[i]);
    if (span === 0) out.push(i);
    else i += span - 1;
  }
  return out;
}

// Whether a word opens a command substitution: a backtick, or a `$` the step
// split cut from its `(`.
const substitutes = (word, last) => word.includes('`') || (last && word.endsWith('$'));

// Whether a quoted span runs a command substitution: double-quoted and holding
// `$(` or a backtick. A single-quoted span is literal.
const substitutesQuoted = (span) => span[0] === '"' && (span.includes('$(') || span.includes('`'));

// The indices of the kit command's words in a step, from its command word on, or null.
function kitIndices(words) {
  const kept = keptIndices(words);
  const { skip, word } = peelPrefixes(kept.map((i) => words[i]));
  if (word !== 'workkit') return null;
  const [sub, verb] = kept.slice(skip + 1).map((i) => words[i]);
  const kit = sub === 'review' || (sub === 'ship' && ALLOWED_SHIP_VERBS.includes(verb));
  return kit ? kept.slice(skip) : null;
}

/**
 * bare-call's notice on a Bash command: one line per kit step that is not
 * the whole command on its own, else null. Judged on the stripped text; each
 * quoted span is put back, in order, where the strip left its placeholder, and
 * the named step stops before an argument opening a command substitution,
 * unquoted or inside double quotes.
 * @param {{command: string}} facts the command
 * @returns {{context: string}|null}
 */
export function bareCallVerdict({ command }) {
  if (!command) return null;
  const { text, quoted } = stripQuotesKeeping(stripHeredocs(command));
  const stripped = foldRedirectAmp(text);
  const found = [];
  let next = 0;
  for (const step of stepDirs(stripped)) {
    const words = wordsOf(step.text);
    const spans = words.map((w) => Array.from({ length: count(w, PLACEHOLDER) }, () => quoted[next++] ?? PLACEHOLDER));
    const written = words.map((w, i) => w.split(PLACEHOLDER).reduce((out, part, j) => `${out}${spans[i][j - 1]}${part}`));
    const kit = kitIndices(words);
    if (!kit) continue;
    const cut = kit.findIndex((i) => substitutes(words[i], i === words.length - 1) || spans[i].some(substitutesQuoted));
    const shown = cut === -1 ? kit : kit.slice(0, cut);
    found.push({ judged: kit.map((i) => words[i]).join(' '), shown: shown.map((i) => written[i]).join(' '), cut: cut !== -1 });
  }
  if (found.length === 0) return null;
  if (found.length === 1 && !found[0].cut && wordsOf(stripped).join(' ') === found[0].judged) return null;
  const lines = found.map(({ shown }) => `bare-call: run \`${shown}\` as its own Bash call from the repo root; inside a compound command it misses its allow rule and auto mode can refuse it.`);
  return { context: lines.join('\n') };
}

/**
 * The guard's run over the Bash facts.
 * @param {{command: string}} facts the chain's facts
 * @returns {{context: string}|null}
 */
export function bareCallGuard(facts) {
  return bareCallVerdict({ command: facts.command });
}
