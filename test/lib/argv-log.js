// Argv recording for PATH-shim stubs (the fake `gh` the suites put on PATH).
// Each argument is its own NUL-terminated field and each call ends with a 0x1e
// record separator, so an assertion sees where one argument ended and the next
// began. An argument that is exactly 0x1e would read back as a boundary; nothing
// recorded here is one.

const fs = require('fs');
const { gitPath } = require('./platform');

const NUL = '\0';
const RS = '\x1e';

/**
 * Bash line that appends the current invocation's argv to `logFile`, spelled in
 * git's drive form (gitPath), which no Git Bash mount moves when a world moves
 * TEMP. The path must be shell-safe, which a mkdtemp path is.
 *
 * One printf, so one O_APPEND write while the record fits bash's stdout buffer
 * (1024 bytes on macOS): racing stubs cannot interleave their fields. A call
 * with no arguments writes just the separator and reads back as an empty argv.
 *
 * @param {string} logFile - absolute path to append to
 * @returns {string} bash source, one line
 */
const recordArgv = (logFile) => `printf '%s\\0' "$@" $'\\036' >> "${gitPath(logFile)}"`;

/**
 * The Node twin of `recordArgv`: one JavaScript statement that appends one
 * record, in the same framing, as a single append.
 *
 * @param {string} fileExpr - JavaScript expression for the log path, e.g. `JSON.stringify(logFile)`
 * @param {string} argvExpr - JavaScript expression for the argv array to record, e.g. `'process.argv.slice(2)'`
 * @returns {string} JavaScript source, one line
 */
const recordArgvJs = (fileExpr, argvExpr) => `require('fs').appendFileSync(${fileExpr}, [...${argvExpr}, ${JSON.stringify(RS)}].map((f) => f + ${JSON.stringify(NUL)}).join(''));`;

/**
 * Read a log written by `recordArgv` back into one argv array per invocation.
 * The path is Node's own to open, so it stays native: only the line the stub
 * runs is spelled for a shell.
 * @param {string} logFile - path written by a stub; a missing file reads as no calls
 * @returns {string[][]} one array of arguments per recorded call
 */
const readArgv = (logFile) => {
  if (!fs.existsSync(logFile)) return [];
  // Every field ends with its NUL, so the final split element is the empty tail
  // after the last one. An argument that is itself the empty string survives.
  const fields = fs.readFileSync(logFile, 'utf8').split(NUL);
  fields.pop();
  const calls = [];
  let current = [];
  for (const field of fields) {
    if (field === RS) {
      calls.push(current);
      current = [];
    } else {
      current.push(field);
    }
  }
  // Fields with no separator behind them are a write that never finished,
  // not a call, and never silently rounded up into one.
  return calls;
};

/**
 * Whole-argument prefix match: `isCall(c, 'label', 'create')` is true only when
 * the first two arguments are exactly those words, never when one argument
 * happens to contain them.
 * @param {string[]} call
 * @param {...string} prefix
 * @returns {boolean}
 */
const isCall = (call, ...prefix) => prefix.every((word, i) => call[i] === word);

/**
 * Exact argv equality.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
const eqArgv = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Render recorded calls for an assertion message, with argument boundaries
 * still visible.
 * @param {string[][]} calls
 * @returns {string}
 */
const fmtCalls = (calls) => calls.map((c) => JSON.stringify(c)).join(' | ');

module.exports = { recordArgv, recordArgvJs, readArgv, isCall, eqArgv, fmtCalls };
