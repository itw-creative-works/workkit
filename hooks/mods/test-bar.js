/**
 * hooks/mods/test-bar.js: safety:test-bar's nudge, on every write of a test
 * file, naming each line that misses the mechanical half of the test bar
 * (docs/tests.md § The bar). It names the line and the rule, never blocks:
 * the agent decides.
 */

import { escaped, isTestName, isTestPath } from './test-reminder.js';

// The scratch writer's homes: a consumer repo's (`test/` or `tests/`) and the kit's own.
const SCRATCH = new Set(['test/lib/scratch.js', 'tests/lib/scratch.js', 'workflow/test/lib/scratch.js']);
// The shared deadline's homes, where its own bounds are written.
const DEADLINE_HOME = new Set(['test/lib/process.js', 'tests/lib/process.js', 'workflow/test/lib/process.js']);
const HELPER_DIR = /(^|\/)(tests?|workflow\/test)\/lib\//;

const COMMENT = /^\s*(\/\/|\/\*|\*|#)/;
const CASE_START = /^\s*(await\s+)?(test|it|testUnless\s*\([^)]*\))\s*\(/;
const GROUP_START = /^\s*(group|describe)\s*\(/;
const ASSERTION = /\b(assert(\.\w+|Eq\w*)?|expect)\s*\(/;
const TMP_DIR = /\bmkdtempSync\s*\(|\btmpdir\s*\(/;
const FIXED_PATH = /['"`]\/tmp\/[\w.-]/;
const FIXED_PORT = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0):[1-9]\d{1,4}\b|\bport\b['"]?\s*[:=]\s*[1-9]\d{1,4}\b|\.listen\(\s*[1-9]\d{1,4}\b/i;
// A wait bound written as a number literal: a timer, a sleep helper, a timeout option, Atomics.wait.
const WAITS = [
  /\bset(?:Timeout|Interval)\s*\(.*,\s*([\d_]+)\s*\)/,
  /\bsleep\s*\(\s*([\d_]+)\s*\)/,
  /\btimeout\s*:\s*([\d_]+)/,
  /\bAtomics\.wait\s*\(.*,\s*([\d_]+)\s*\)/,
];
const SOURCE_READ = /\breadFileSync\s*\((.*)/;
// A read names the source tree by a repo-root anchor or a repo-relative literal.
const SOURCE_ANCHOR = /__dirname|process\.cwd\(\)|\b[A-Z_]*(ROOT|KIT|REPO)[A-Z_]*\b|['"`][\w.-]+\/[\w./-]+['"`]|['"`][\w-]+\.(js|cjs|mjs|ts|md|json|sh|css|scss|html)['"`]/;
const NAMED = /\b(?:const|let|var)\s+(\w+)\s*=/;
const WEAK = [/\bexistsSync\s*\(/, /\bl?stat(Sync)?\s*\(.*\.mode\b|\b0o[0-7]{3,4}\b|\bX_OK\b|\baccessSync\s*\(/, /\bassert(\.ok)?\s*\(\s*true\s*[,)]/];

// A `/` opens a regex literal at the line's start, after an operator or an
// opener (an arrow's `>` included) or after `return`; anywhere else it divides.
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/;

/**
 * Whether the `/` at `i`, met outside any span, opens a regex literal rather
 * than dividing: the text before it decides.
 * @param {string} line the line
 * @param {number} i the index of the `/`
 * @returns {boolean}
 */
function opensRegex(line, i) {
  return REGEX_AFTER.test(line.slice(0, i));
}

/**
 * The index of the unescaped `/` closing the regex literal opened at `i`, a
 * `/` inside a `[...]` class left alone; the line's length when it never
 * closes, since a regex never runs past its line.
 * @param {string} line the line
 * @param {number} i the index of the opening `/`
 * @returns {number}
 */
function regexEnd(line, i) {
  let inClass = false;
  for (let j = i + 1; j < line.length; j += 1) {
    if (line[j] === '\\') j += 1;
    else if (line[j] === '[') inClass = true;
    else if (line[j] === ']') inClass = false;
    else if (line[j] === '/' && !inClass) return j;
  }
  return line.length;
}

/**
 * The file's lines with every quoted span removed: a `'...'`, `"..."` or
 * backtick span on one line, and every line inside a template literal left
 * open at a line's end, up to the text after its closing backtick. A regex
 * literal and a trailing `//` comment are dropped too and open no span. A
 * comment line outside a template passes through whole and opens no span.
 * @param {string[]} lines the file's lines
 * @returns {string[]}
 */
export function quoteFree(lines) {
  let quote = '';
  return lines.map((line) => {
    if (!quote && COMMENT.test(line)) return line;
    let out = '';
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '\\') {
        if (!quote) out += line.slice(i, i + 2);
        i += 1;
      } else if (quote) {
        if (c === quote) quote = '';
      } else if (c === '/' && line[i + 1] === '/') {
        break;
      } else if (c === '/' && opensRegex(line, i)) {
        i = regexEnd(line, i);
      } else if (c === "'" || c === '"' || c === '`') {
        quote = c;
      } else {
        out += c;
      }
    }
    // Only a template literal runs past its line; a stray quote ends with it.
    if (quote !== '`') quote = '';
    return out;
  });
}

/**
 * The `[line, rule]` findings of the one-line rules: mkTmp, serial, and
 * deadline, which reads the quote-free lines (quoted text is a fixture's).
 * @param {string[]} lines the file's lines
 * @param {string} rel the file, repo-relative
 * @returns {Array<[number, string]>}
 */
function lineFindings(lines, rel) {
  const found = [];
  const free = quoteFree(lines);
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    if (!SCRATCH.has(rel) && TMP_DIR.test(line)) found.push([i + 1, 'mkTmp']);
    if (FIXED_PATH.test(line) || FIXED_PORT.test(line)) found.push([i + 1, 'serial']);
    const bound = (wait) => Number(free[i].match(wait)?.[1].replace(/_/g, '')) > 0;
    if (!DEADLINE_HOME.has(rel) && WAITS.some(bound)) found.push([i + 1, 'deadline']);
  });
  return found;
}

/**
 * The `[line, 'worth']` findings: a case whose every assertion is an
 * existence, mode or exec-bit check, or `assert.ok(true)`, named at its first.
 * @param {string[]} lines the file's lines
 * @returns {Array<[number, string]>}
 */
function worthFindings(lines) {
  const found = [];
  let asserts = null;
  const close = () => {
    if (asserts?.length && asserts.every(([, line]) => WEAK.some((weak) => weak.test(line)))) found.push([asserts[0][0], 'worth']);
    asserts = null;
  };
  lines.forEach((line, i) => {
    if (CASE_START.test(line) || GROUP_START.test(line)) close();
    if (CASE_START.test(line)) asserts = [];
    if (asserts && !COMMENT.test(line) && ASSERTION.test(line)) asserts.push([i + 1, line]);
  });
  close();
  return found;
}

/**
 * The `[line, 'source-regex']` findings: a `readFileSync` of a source path
 * whose text, by the name it is held under or inline, reaches `assert.match`.
 * @param {string[]} lines the file's lines
 * @returns {Array<[number, string]>}
 */
function sourceRegexFindings(lines) {
  const found = [];
  lines.forEach((line, i) => {
    const read = line.match(SOURCE_READ);
    if (!read || COMMENT.test(line) || /(^|[^\w-])tests?\//.test(read[1]) || !SOURCE_ANCHOR.test(read[1])) return;
    if (/\bassert\.match\s*\(/.test(line)) {
      found.push([i + 1, 'source-regex']);
      return;
    }
    const name = line.match(NAMED)?.[1];
    const matched = name && new RegExp(`\\bassert\\.match\\s*\\(\\s*${escaped(name)}\\b`);
    if (matched && lines.slice(i + 1).some((later) => matched.test(later))) found.push([i + 1, 'source-regex']);
  });
  return found;
}

/**
 * The nudge for a written test file, one `test-bar: <file>:<line> <rule>`
 * line per finding in line order, or '' when it is not a test path or nothing
 * matches.
 * @param {{root: string, rel: string, text: string}} facts the repo root, the
 *   file relative to it, and the file's text as written
 * @returns {string}
 */
export function testBarContext(facts) {
  const rel = String(facts.rel ?? '').replace(/\\/g, '/');
  if (!isTestPath(rel) || typeof facts.text !== 'string') return '';
  const lines = facts.text.split(/\r?\n/);
  const found = [...lineFindings(lines, rel), ...worthFindings(lines), ...sourceRegexFindings(lines)];
  if (HELPER_DIR.test(rel) && isTestName(rel)) found.push([1, 'helper-test']);
  return found.sort((a, b) => a[0] - b[0]).map(([line, rule]) => `test-bar: ${rel}:${line} ${rule}`).join('\n');
}
