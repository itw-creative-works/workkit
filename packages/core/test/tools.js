/* eslint-disable no-console */
// `workkit tools`: every command the repo's suites name through `needs(...)`,
// one per line, sorted and unique, so a cloud setup can install them. It reads
// the suites the runner would run from the cwd; it never loads one.

import fs from 'node:fs';
import path from 'node:path';
import { suiteDir, findSuites, findModSuites } from './lib/suites.js';
import { lexLine } from './lib/lexer.js';

// A `needs(` call, not a method of the same name or a longer identifier.
const NEEDS_CALL = /(?<![\w$.])needs\s*\(/g;

// One argument, a quoted string with no escape, then the comma or the close.
const LITERAL_ARG = /^\s*(['"])([^'"\\\n]+)\1\s*(,|\))/;

// `text` with every comment blanked to spaces, and every string, template and
// regex too unless `strings` is false (the lexer's spans); newlines are kept,
// so an index in it is the same index in `text`.
const codeOnly = (text, strings = true) => {
  let open = '';
  return text.split('\n').map((line) => {
    const lexed = lexLine(line, open);
    open = lexed.open;
    let out = line;
    for (const { start, end, comment } of lexed.spans) {
      if (strings || comment) out = `${out.slice(0, start)}${' '.repeat(end - start)}${out.slice(end)}`;
    }
    return out;
  }).join('\n');
};

// Whether the `needs(` at `at` in the code-only text, its `(` ending at
// `from`, defines a function rather than calling one: `function needs(` or a
// method, `needs(...) {`.
const isDefinition = (code, at, from) => {
  if (/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, at - 16), at))) return true;
  let depth = 1;
  let i = from;
  for (; i < code.length && depth > 0; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') depth--;
  }
  return depth === 0 && /^\s*\{/.test(code.slice(i));
};

// The arguments of the call whose `(` ends at `from`, or null when one is not
// a string literal.
const literalArgs = (text, from) => {
  const args = [];
  let rest = text.slice(from);
  if (/^\s*\)/.test(rest)) return args;
  for (;;) {
    const m = rest.match(LITERAL_ARG);
    if (!m) return null;
    args.push(m[2]);
    rest = rest.slice(m[0].length);
    if (m[3] === ')') return args;
    if (/^\s*\)/.test(rest)) return args;
  }
};

/**
 * The tools every suite under `root` needs, sorted and unique.
 * @param {string} root - the repo folder the runner would read
 * @returns {{ tools: string[] } | { error: string }} the list, or the first
 *   call whose arguments are not string literals, as `<file>:<line>: ...`
 */
export const suiteTools = (root) => {
  const testDir = suiteDir(root);
  const suites = [
    ...(fs.existsSync(testDir) ? findSuites(testDir) : []),
    ...findModSuites(path.join(testDir, 'mods')),
  ].sort();
  const tools = new Set();
  for (const suite of suites) {
    const text = fs.readFileSync(suite, 'utf8');
    const code = codeOnly(text);
    const uncommented = codeOnly(text, false);
    for (const call of code.matchAll(NEEDS_CALL)) {
      const from = call.index + call[0].length;
      if (isDefinition(code, call.index, from)) continue;
      const args = literalArgs(uncommented, from);
      if (args === null) {
        const line = text.slice(0, call.index).split('\n').length;
        return { error: `${path.relative(root, suite)}:${line}: needs() takes string literals only` };
      }
      for (const arg of args) tools.add(arg);
    }
  }
  return { tools: [...tools].sort() };
};

/**
 * The verb: the list on stdout, exit 0; a non-literal call is one
 * `✖ tools:` line and exit 1; an argument is a usage error, exit 2.
 * @param {string[]} args - the verb's arguments, none expected
 */
export const main = (args) => {
  if (args.length > 0) {
    console.error(`✖ tools: takes no arguments, not ${args[0]}`);
    process.exitCode = 2;
    return;
  }
  const res = suiteTools(process.cwd());
  if ('error' in res) {
    console.error(`✖ tools: ${res.error}`);
    process.exitCode = 1;
    return;
  }
  for (const tool of res.tools) console.log(tool);
};
