/**
 * hooks/mods/test-bar.js: safety:test-bar's nudge, on every write of a test
 * file, naming each line that misses the mechanical half of the test bar
 * (docs/tests.md § The bar). It names the line and the rule, never blocks:
 * the agent decides.
 */

import { escaped, isTestName, isTestPath } from './test-reminder.js';

// The scratch writer's two homes: a consumer repo's and the kit's own.
const SCRATCH = new Set(['tests/lib/scratch.js', 'workflow/test/lib/scratch.js']);
const HELPER_DIR = /(^|\/)(tests|workflow\/test)\/lib\//;
const SLEEP_MAX_MS = 1000;

const COMMENT = /^\s*(\/\/|\/\*|\*|#)/;
const CASE_START = /^\s*(await\s+)?(test|it|testUnless\s*\([^)]*\))\s*\(/;
const GROUP_START = /^\s*(group|describe)\s*\(/;
const ASSERTION = /\b(assert(\.\w+|Eq\w*)?|expect)\s*\(/;
const TMP_DIR = /\bmkdtempSync\s*\(|\btmpdir\s*\(/;
const FIXED_PATH = /['"`]\/tmp\/[\w.-]/;
const FIXED_PORT = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0):[1-9]\d{1,4}\b|\bport\b['"]?\s*[:=]\s*[1-9]\d{1,4}\b|\.listen\(\s*[1-9]\d{1,4}\b/i;
const SLEEP = /\bsetTimeout\s*\(.*,\s*([\d_]+)\s*\)/;
const SOURCE_READ = /\breadFileSync\s*\((.*)/;
// A read names the source tree by a repo-root anchor or a repo-relative literal.
const SOURCE_ANCHOR = /__dirname|process\.cwd\(\)|\b[A-Z_]*(ROOT|KIT|REPO)[A-Z_]*\b|['"`][\w.-]+\/[\w./-]+['"`]|['"`][\w-]+\.(js|cjs|mjs|ts|md|json|sh|css|scss|html)['"`]/;
const NAMED = /\b(?:const|let|var)\s+(\w+)\s*=/;
const WEAK = [/\bexistsSync\s*\(/, /\bl?stat(Sync)?\s*\(.*\.mode\b|\b0o[0-7]{3,4}\b|\bX_OK\b|\baccessSync\s*\(/, /\bassert(\.ok)?\s*\(\s*true\s*[,)]/];

/**
 * The `[line, rule]` findings of the one-line rules: mkTmp, serial, sleep.
 * @param {string[]} lines the file's lines
 * @param {string} rel the file, repo-relative
 * @returns {Array<[number, string]>}
 */
function lineFindings(lines, rel) {
  const found = [];
  lines.forEach((line, i) => {
    if (COMMENT.test(line)) return;
    if (!SCRATCH.has(rel) && TMP_DIR.test(line)) found.push([i + 1, 'mkTmp']);
    if (FIXED_PATH.test(line) || FIXED_PORT.test(line)) found.push([i + 1, 'serial']);
    const sleep = line.match(SLEEP);
    if (sleep && Number(sleep[1].replace(/_/g, '')) > SLEEP_MAX_MS) found.push([i + 1, 'sleep']);
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
    if (!read || COMMENT.test(line) || /\btests\b/.test(read[1]) || !SOURCE_ANCHOR.test(read[1])) return;
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
