#!/usr/bin/env node
/* eslint-disable no-console */
// The test runner behind `npm test`: runs every `tests/**/*.test.js` (each
// exports `async () => ({ passed, failed, failures })`), totals them, and exits
// non-zero on any failure. Suite paths after `--` (repo-relative or absolute)
// narrow the run to those suites. The suite contract: AGENTS.md § Tests.

const path = require('path');
const { findSuites } = require('./lib/suites');

const TEST_DIR = __dirname;
const ROOT = path.dirname(TEST_DIR);

// The named suites, or every suite when none is named; a name that is no
// suite ends the run before anything starts.
const pickSuites = (args) => {
  const all = findSuites(TEST_DIR);
  if (args.length === 0) return all.sort();
  const picked = new Set();
  for (const arg of args) {
    const full = path.resolve(ROOT, arg);
    if (!all.includes(full)) {
      console.error(`No suite matches ${arg}`);
      process.exit(1);
    }
    picked.add(full);
  }
  return [...picked].sort();
};

(async () => {
  const start = Date.now();
  const suites = pickSuites(process.argv.slice(2).filter((arg) => arg !== '--'));

  if (suites.length === 0) {
    console.log('No *.test.js suites found under tests/.');
    process.exit(0);
  }

  let passed = 0;
  let failed = 0;
  const allFailures = [];
  const skippedSuites = [];
  const skippedCases = [];

  for (const suite of suites) {
    const rel = path.relative(TEST_DIR, suite);
    console.log(`\n\x1b[1m\x1b[36m▶ ${rel}\x1b[0m`);
    let mod;
    try {
      mod = require(suite);
    } catch (err) {
      console.error(`\x1b[31mfailed to load ${rel}:\x1b[0m ${err.stack || err}`);
      failed++;
      allFailures.push({ name: `load ${rel}`, err });
      continue;
    }
    if (typeof mod !== 'function') {
      console.error(`\x1b[31m${rel} does not export an async runner function\x1b[0m`);
      failed++;
      allFailures.push({ name: `export ${rel}`, err: new Error('no default export function') });
      continue;
    }
    try {
      const res = await mod();
      passed += res.passed || 0;
      failed += res.failed || 0;
      for (const f of res.failures || []) {
        allFailures.push({ name: `${rel} › ${f.name}`, err: f.err });
      }
      for (const s of res.skips || []) {
        skippedCases.push({ name: `${rel} › ${s.name}`, reason: s.reason });
      }
    } catch (err) {
      // skipSuite() reports a missing precondition, not a defect.
      if (err.suiteSkipped) {
        console.log(`\x1b[33m⊘ skipped:\x1b[0m ${err.message}`);
        skippedSuites.push({ name: rel, reason: err.message });
        continue;
      }
      console.error(`\x1b[31m${rel} threw:\x1b[0m ${err.stack || err}`);
      failed++;
      allFailures.push({ name: `run ${rel}`, err });
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const suiteNote = skippedSuites.length ? `, ${skippedSuites.length} suite${skippedSuites.length === 1 ? '' : 's'} skipped` : '';
  const caseNote = skippedCases.length ? `, ${skippedCases.length} case${skippedCases.length === 1 ? '' : 's'} skipped` : '';
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed${suiteNote}${caseNote}\x1b[0m (${elapsed}s, ${suites.length} suite${suites.length === 1 ? '' : 's'})`);

  // Name every skip, file and case alike: a run must never quietly cover less
  // than the reader assumes.
  for (const s of [...skippedSuites, ...skippedCases]) {
    console.log(`  \x1b[33m⊘ ${s.name}: ${s.reason}\x1b[0m`);
  }

  if (failed > 0) {
    console.log('\n\x1b[1mFailures:\x1b[0m');
    for (const f of allFailures) {
      console.log(`  - ${f.name}: ${f.err.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
})();
