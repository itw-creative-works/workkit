#!/usr/bin/env node
/* eslint-disable no-console */
//
// Test runner for the workkit plugin. Discovers every `tests/**/*.test.js`
// file, runs each (each module exports an async fn returning
// { passed, failed, failures }), aggregates the totals, and exits non-zero if
// anything failed.
//
// Run with:  npm test   (or)  node tests/run.js
//
// Add a new suite by dropping a `*.test.js` anywhere under tests/ that exports
// `async () => ({ passed, failed, failures })` — see tests/hooks/ for the shape.
//

const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;

// Recursively collect *.test.js files (skipping lib/ and node_modules).
const findSuites = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSuites(full));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
};

(async () => {
  const start = Date.now();
  const suites = findSuites(TEST_DIR).sort();

  if (suites.length === 0) {
    console.log('No *.test.js suites found under tests/.');
    process.exit(0);
  }

  let passed = 0;
  let failed = 0;
  const allFailures = [];
  const skippedSuites = [];

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
    } catch (err) {
      // A suite that called skipSuite() is reporting a missing precondition,
      // not a defect — this machine cannot ask the question it asks.
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
  const skipNote = skippedSuites.length ? `, ${skippedSuites.length} suite${skippedSuites.length === 1 ? '' : 's'} skipped` : '';
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed${skipNote}\x1b[0m (${elapsed}s, ${suites.length} suite${suites.length === 1 ? '' : 's'})`);

  // Name every skip. A run that quietly covered less than the reader assumes is
  // the failure mode this whole mechanism has to avoid.
  for (const s of skippedSuites) {
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
