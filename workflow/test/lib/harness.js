/* eslint-disable no-console */
// Tiny zero-dependency test harness shared across the suites: `test()` prints
// a mark per case and each suite reports via `summary()`. AGENTS.md § Tests.
// It is the library's one entry: every concern file's exports ride on its own.

const path = require('path');
const { fileURLToPath } = require('url');
const { openCase, drain, CASE_INDENT } = require('./log');

// The workflow state directory's name for the test layer. The engine and the
// hooks hold their own copy, so change all three together.
const WORKKIT_DIR = '.workkit';

let passed = 0;
let failed = 0;
const failures = [];
const skips = [];

// A stack line with its file:/// URL (an ESM frame) in path form, so it reads as a plain frame.
const pathForm = (line) => line.replace(/file:\/\/\S+?(?=:\d+:\d+\)?$)/, (url) => fileURLToPath(url));

// The first stack frame outside this library: the line in the suite that threw.
// The stack opens with the message, so its lines are skipped before frames are read.
const caseFrame = (err) => {
  const stack = String(err?.stack ?? '');
  const message = String(err?.message ?? '');
  const at = stack.indexOf(message);
  return (at === -1 ? stack : stack.slice(at + message.length)).split('\n')
    .map((line) => pathForm(line.trim()))
    .find((line) => {
      const file = line.match(/^at (?:async )?(?:.* \()?(.+?):\d+:\d+\)?$/)?.[1];
      return file !== undefined && path.isAbsolute(file) && !file.startsWith(`${__dirname}${path.sep}`);
    });
};

const group = (name) => {
  console.log(`\n\x1b[1m[${name}]\x1b[0m`);
};

const test = async (name, fn) => {
  openCase();
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    const lines = drain();
    if (process.env.TEST_LOG === '1') for (const line of lines) console.log(`${CASE_INDENT}${line}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`${CASE_INDENT}\x1b[31m${err.message}\x1b[0m`);
    for (const line of drain()) console.log(`${CASE_INDENT}${line}`);
    const frame = caseFrame(err);
    if (frame) console.log(`${CASE_INDENT}\x1b[2m${frame}\x1b[0m`);
  }
  // One event-loop turn per case: a killed runner's disconnect reaches the
  // worker between cases, which an await on a sync case alone never gives it.
  await new Promise((resolve) => setImmediate(resolve));
};

const assert = (cond, msg) => {
  if (!cond) {
    throw new Error(msg || 'assertion failed');
  }
};

const assertEq = (actual, expected, msg) => {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// One case this machine cannot answer, named rather than dropped: it counts as
// neither pass nor failure. skipSuite() would drop the whole file, cases that
// could run included.
const skip = (name, reason) => {
  skips.push({ name, reason });
  console.log(`  \x1b[33m⊘\x1b[0m ${name} \x1b[33m(skipped: ${reason})\x1b[0m`);
};

// `test` where the case is answerable, a named skip where it is not. Asking the
// question inside the body instead scores a pass for a case that asserted nothing.
//   const newsTest = testUnless(IS_WINDOWS, 'the gh shim is not startable here');
const testUnless = (skipIt, reason) => (skipIt ? (name) => skip(name, reason) : test);

// A suite whose preconditions are absent skips itself instead of failing, so
// `npm test` stays the one command everywhere and the requirement lives in the
// suite it describes.
const skipSuite = (reason) => {
  const err = new Error(reason);
  err.suiteSkipped = true;
  throw err;
};

// Mirrors the engine's `uname -s` question rather than probing PATH for
// launchctl, so the two never disagree about which branch the code takes.
const hasLaunchd = () => process.platform === 'darwin';

// Log output with the helpers' color codes removed, so lines compare exactly.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

// Snapshot and reset this file's totals; the runner sums them across files.
const summary = () => {
  const result = { passed, failed, failures: failures.slice(), skips: skips.slice() };
  passed = 0;
  failed = 0;
  failures.length = 0;
  skips.length = 0;
  return result;
};

// Runs one suite file on its own; without it a whole-suite skip would surface
// as an unhandled crash.
const selfRun = (runner) => {
  runner()
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch((err) => {
      if (!err.suiteSkipped) throw err;
      console.log(`\x1b[33m⊘ skipped:\x1b[0m ${err.message}`);
      process.exit(0);
    });
};

module.exports = {
  ...require('./process'),
  ...require('./scratch'),
  ...require('./seed'),
  ...require('./suites'),
  ...require('./log'),
  ...require('./spawn'),
  group, test, assert, assertEq, skip, testUnless, skipSuite, selfRun, summary, hasLaunchd, stripAnsi, WORKKIT_DIR,
};
