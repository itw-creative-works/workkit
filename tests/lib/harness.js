/* eslint-disable no-console */
// Tiny zero-dependency test harness shared across the suites: `test()` prints
// a mark per case and each suite reports via `summary()`. AGENTS.md § Tests.

// The workflow state directory's name for the test layer. The engine and the
// hooks hold their own copy; the standards.sh suite asserts all three agree.
const WORKKIT_DIR = '.workkit';

let passed = 0;
let failed = 0;
const failures = [];
const skips = [];

const group = (name) => {
  console.log(`\n\x1b[1m[${name}]\x1b[0m`);
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
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
  group, test, assert, assertEq, skip, testUnless, skipSuite, selfRun, summary, hasLaunchd, WORKKIT_DIR,
};
