/* eslint-disable no-console */
//
// Tiny zero-dependency test harness shared across this repo's test suites.
//
// A `test()` runner that prints ✓/✗ per case, plus `assert`/`assertEq`. State
// is module scoped and a suite reports its own results via `summary()`.
//
// Usage:
//   const { test, assert, assertEq, group, summary } = require('../lib/harness');
//   group('my group');
//   await test('does a thing', () => { assert(cond, 'msg'); });
//   const { passed, failed } = summary();   // call once at the end of the file
//

// The workflow state directory's name, for the TEST layer — every suite builds
// its fixture paths from this instead of spelling the directory out. The engine
// (workflow/standards.sh) and the hooks (hooks/_lib.sh) hold their own copy;
// the standards.sh suite asserts all three still agree.
const WORKKIT_DIR = '.workkit';

let passed = 0;
let failed = 0;
const failures = [];

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
    throw new Error(`${msg || 'assertEq failed'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// A suite whose preconditions are absent SKIPS itself instead of failing. Some
// suites can only ask their question on a provisioned machine — one with
// caffeinate, with ~/.claude linked, with an upstream's dependencies installed.
// Elsewhere (a Linux runner, a container, a fresh clone) their failures say
// nothing about the code, and excluding them from the OUTSIDE — a second npm
// script, a flag in a workflow file — puts that knowledge far from the suite it
// describes. Each suite states its own requirement, so `npm test` is the one
// command everywhere and reports honestly wherever it runs.
const skipSuite = (reason) => {
  const err = new Error(reason);
  err.suiteSkipped = true;
  throw err;
};

// The scheduling capability the 9am job is built on. A test that asserts what
// launchd does needs launchd to exist — where it does not, there is no schedule
// to keep current and the case says so instead of failing. The engine itself
// branches on `uname -s` ("launchd is macOS"), so the detector mirrors that
// exact question rather than probing PATH for launchctl: the two must never
// disagree about which branch the code under test takes (issue #114).
const hasLaunchd = () => process.platform === 'darwin';

// Snapshot + reset the running totals for THIS file, returning what it accrued.
// The runner sums these across files. Resetting lets each file report cleanly.
const summary = () => {
  const result = { passed, failed, failures: failures.slice() };
  passed = 0;
  failed = 0;
  failures.length = 0;
  return result;
};

// Run one suite file on its own (`node tests/hooks/x.test.js`). The runner
// catches a skip for the whole-suite case; without this, invoking a file
// directly would surface that same skip as an unhandled crash.
const selfRun = (runner) => {
  runner()
    .then(({ failed }) => process.exit(failed > 0 ? 1 : 0))
    .catch((err) => {
      if (!err.suiteSkipped) throw err;
      console.log(`\x1b[33m⊘ skipped:\x1b[0m ${err.message}`);
      process.exit(0);
    });
};

module.exports = { group, test, assert, assertEq, skipSuite, selfRun, summary, hasLaunchd, WORKKIT_DIR };
