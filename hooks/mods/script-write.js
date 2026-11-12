/**
 * hooks/mods/script-write.js: safety:script-write. The write hooks see only
 * the Edit and Write tools, so this bounces a Bash command that rewrites a
 * file past them: sed or perl in place, or a python, python3 or node snippet
 * (a `-c` or `-e` argument, or a heredoc) whose text writes a file.
 * `WORKKIT_ALLOW_SCRIPT_WRITE=1` is the escape, heard out loud
 * (docs/hooks.md § safety:script-write).
 */

import {
  baseName, foldRedirectAmp, hasEscape, heredocsOf, inPlaceEdit, peelPrefixes, stepsOf, stripHeredocs, stripQuotes,
  wordsOf, writtenSteps,
} from './command.js';

const INTERPRETERS = { python: 'python', python3: 'python', node: 'node' };
// The flag whose next word is the snippet: python's -c, alone or ending a cluster (-Bc), node's -e or -p.
const SNIPPET_FLAG = { python: /^-[A-Za-z]*c$/, node: /^(-[ep]{1,2}|--eval|--print)$/ };
// A flag whose value is its next word, so the value never reads as the script name.
const VALUE_FLAG = {
  python: new Set(['-W', '-X']),
  node: new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions']),
};
// A script file, known by its ending: any other bare word is read past as a value or a redirect.
const SCRIPT_FILE = { python: /\.pyw?$/, node: /\.[cm]?[jt]s$/ };
// Python's -m, alone or ending a cluster (-Bm): its next word is the module.
const MODULE_FLAG = /^-[A-Za-z]*m$/;

// An open( argument, as source: string literals and up to two levels of
// parentheses, so open(os.path.join('a','b'), 'w') reads as two arguments.
// A backslash before a quote is STR's alone, so no text parses two ways and backtracks.
const STR = String.raw`\\?'[^']*'|\\?"[^"]*"`;
const LONE_BACKSLASH = String.raw`\\(?!['"])`;
const NESTED = String.raw`\((?:${STR}|${LONE_BACKSLASH}|\((?:${STR}|${LONE_BACKSLASH}|[^'"()\\])*\)|[^'"()\\])*\)`;
const ARG = String.raw`(?:${STR}|${LONE_BACKSLASH}|${NESTED}|[^'"(),\\])*`;
// A mode literal that writes: w, a, x or +, with b, t or r beside it.
const MODE = String.raw`\\?['"][rbtwax+]*[wax+][rbtwax+]*\\?['"]`;
const WRITES = {
  python: [
    new RegExp(String.raw`(\.open\(|\bopen\(${ARG},)[ \t]*${MODE}`),
    new RegExp(String.raw`\bopen\((${ARG},)*[ \t]*mode[ \t]*=[ \t]*${MODE}`),
    /\.write_text\(/,
    /\.write_bytes\(/,
  ],
  node: [/(writeFile|appendFile)(Sync)?|createWriteStream/],
};

// The interpreter a step's quote-stripped words run, by any path: `python3`, or ''.
const interpreterOf = (words) => {
  const { skip, word } = peelPrefixes(words);
  const name = baseName(word);
  return { skip, name: Object.hasOwn(INTERPRETERS, name) ? name : '' };
};

// The index of the snippet among a step's words, or -1: the interpreter's own
// flags are read up to its script file (or a module after -m), past which a flag is the script's.
const snippetAt = (words, skip, kind) => {
  for (let i = skip + 1; i < words.length; i++) {
    const word = words[i];
    if (SNIPPET_FLAG[kind].test(word)) return i + 1 < words.length ? i + 1 : -1;
    if (VALUE_FLAG[kind].has(word)) i++;
    else if (kind === 'python' && MODULE_FLAG.test(word)) return -1;
    else if (!word.startsWith('-') && SCRIPT_FILE[kind].test(word)) return -1;
  }
  return -1;
};

// Each snippet a command hands an interpreter: the snippet flag's argument as
// written, quotes kept, and the body of a heredoc the interpreter reads.
function snippetsOf(command) {
  const out = [];
  for (const { head, body } of heredocsOf(command)) {
    // The `<<` put back, so the last step is the heredoc's own even with no command before it.
    const { name } = interpreterOf(wordsOf(stepsOf(`${foldRedirectAmp(stripQuotes(head))}<<`).at(-1)));
    if (name) out.push({ name, text: body });
  }
  for (const { words, written } of writtenSteps(command).steps) {
    const { skip, name } = interpreterOf(words);
    const at = name ? snippetAt(words, skip, INTERPRETERS[name]) : -1;
    if (at !== -1) out.push({ name, text: written[at] });
  }
  return out;
}

// What the command does that rewrites a file past the write hooks, named for the message, or ''.
function writeOf(command) {
  if (inPlaceEdit(command)) return 'runs sed or perl in place';
  for (const { name, text } of snippetsOf(command)) {
    const hit = WRITES[INTERPRETERS[name]].map((re) => text.match(re)).find(Boolean);
    if (hit) return `hands ${name} a snippet that writes a file (\`${hit[0]}\`)`;
  }
  return '';
}

/**
 * script-write's verdict on a Bash command: the block text when it rewrites
 * a file past the Edit and Write tools, the stand-aside notice when the
 * escape is set, else null.
 * @param {string} command the command; the escape is the
 *   `WORKKIT_ALLOW_SCRIPT_WRITE=1` assignment on it
 * @returns {{deny: string}|{context: string}|null}
 */
export function scriptWriteVerdict(command) {
  if (!command) return null;
  const found = writeOf(command);
  if (!found) return null;
  if (hasEscape(foldRedirectAmp(stripQuotes(stripHeredocs(command))), 'WORKKIT_ALLOW_SCRIPT_WRITE')) {
    return { context: `script-write: stood aside for a scratch or generated file: WORKKIT_ALLOW_SCRIPT_WRITE=1 is set on this command (${found}).` };
  }
  return { deny: `script-write: BLOCKED this command: it ${found}, and a file edited from Bash skips every write hook, which fire on the Edit and Write tools alone.\nMake the edit with the Edit or Write tool. A write hook's bounce is fixed, or reported to the manager, never worked around. For a scratch or generated file no write hook judges, rerun the command with WORKKIT_ALLOW_SCRIPT_WRITE=1 in front of it.` };
}

/**
 * The guard's run over the Bash facts.
 * @param {{command: string}} facts the chain's facts
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function scriptWriteGuard(facts) {
  return scriptWriteVerdict(facts.command);
}
