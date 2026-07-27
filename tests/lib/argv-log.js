//
// Argv recording for PATH-shim stubs (the fake `gh` the hook and script suites
// put on PATH).
//
// A stub that logs `"$*"` joins its arguments with spaces, which throws away the
// only thing worth asserting: where one argument ended and the next began. A
// script that drops the quotes around a value containing spaces then produces a
// byte-identical log line and the suite stays green. So each argument is written
// as its own NUL-terminated field, and each invocation ends with a record
// separator (0x1e).
//
// NUL is the sound half: an argument physically cannot contain one, because that
// is the byte the kernel uses to terminate it. 0x1e is a convention, not a
// guarantee — an argument that is EXACTLY that byte would read back as a record
// boundary. Nothing these stubs record can be: the arguments come from
// workflow/labels.json and the hooks' own literals. A stub fed arbitrary payloads
// wants a framing that does not rely on that.
//
// Arguments are decoded as UTF-8. Two arguments differing only in invalid bytes
// read back equal; no caller here sends any.
//
// Usage:
//   const { recordArgv, readArgv, isCall, eqArgv, fmtCalls } = require('../lib/argv-log');
//   fs.writeFileSync(stubPath, ['#!/usr/bin/env bash', recordArgv(logFile), ...].join('\n'));
//   const calls = readArgv(logFile);              // [['label', 'create', ...], ...]
//   calls.filter((c) => isCall(c, 'label', 'create'));
//

const fs = require('fs');

const NUL = '\0';
const RS = '\x1e';

/**
 * Bash line that appends the current invocation's argv to `logFile`.
 * Emitted into a stub script, so `logFile` must already be shell-safe (a
 * mkdtemp path is).
 *
 * ONE printf, so one append — as long as the record fits bash's stdout buffer
 * (1024 bytes on macOS). Under that, O_APPEND makes the write atomic, so two
 * stubs racing cannot interleave their fields, and a terminated stub leaves
 * nothing rather than a record with no end. A record past the buffer splits
 * into several writes and can fuse again; nothing these stubs record comes near
 * it, since an existing test caps a label description at 100 characters. A stub
 * fed large payloads wants a framing that does not rely on that.
 *
 * The separator rides along as the last field, which is also why no `$#` guard
 * is needed — a call with no arguments writes just the separator, and reads
 * back as an empty argv.
 *
 * @param {string} logFile - absolute path to append to
 * @returns {string} bash source, one line
 */
const recordArgv = (logFile) => `printf '%s\\0' "$@" $'\\036' >> "${logFile}"`;

/**
 * Read a log written by `recordArgv` back into one argv array per invocation.
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
  // Fields with no separator behind them are a write that never finished —
  // not a call, and never silently rounded up into one.
  return calls;
};

/**
 * Whole-argument prefix match — `isCall(c, 'label', 'create')` is true only when
 * the first two ARGUMENTS are exactly those words, never when one argument
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

module.exports = { recordArgv, readArgv, isCall, eqArgv, fmtCalls };
