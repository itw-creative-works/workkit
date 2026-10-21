#!/usr/bin/env node
/* eslint-disable no-console */
// The test runner behind `npm test`: runs every `tests/**/*.test.js` (each
// exports `async () => ({ passed, failed, failures })`), then the mod half,
// `claude plugin test` over the hooks module's wiring suites, `tests/mods/*.test.ts`, totals them,
// and exits non-zero on any failure. Suite paths after `--` (repo-relative or
// absolute) narrow the run to those suites. The suite contract: AGENTS.md § Tests.

const path = require('path');
const { spawnSync } = require('child_process');
const { findSuites, findModSuites } = require('./lib/suites');

const TEST_DIR = __dirname;
const ROOT = path.dirname(TEST_DIR);
const MOD_DIR = path.join(TEST_DIR, 'mods');

// The named suites, or every suite when none is named; a name that is no
// suite ends the run before anything starts. A named `.test.ts` picks the mod
// half, which `claude plugin test` runs whole, since it takes a folder.
const pickSuites = (args) => {
  const all = findSuites(TEST_DIR);
  const mods = findModSuites(MOD_DIR);
  if (args.length === 0) return { suites: all.sort(), withMods: mods.length > 0 };
  const picked = new Set();
  let withMods = false;
  for (const arg of args) {
    const full = path.resolve(ROOT, arg);
    if (mods.includes(full)) {
      withMods = true;
      continue;
    }
    if (!all.includes(full)) {
      console.error(`No suite matches ${arg}`);
      process.exit(1);
    }
    picked.add(full);
  }
  return { suites: [...picked].sort(), withMods };
};

// The mod half: the plugin's wiring suites, run by the engine itself on the kit
// root (`claude plugin test` takes a plugin folder). No claude binary is a skip.
const runModHalf = () => {
  const res = spawnSync('claude', ['plugin', 'test', ROOT], { cwd: ROOT, encoding: 'utf8' });
  if (res.error) {
    return { skip: res.error.code === 'ENOENT' ? 'no claude binary on PATH' : `claude did not start: ${res.error.message}` };
  }
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(out);
  const count = (word) => Number((out.match(new RegExp(`^\\s*(\\d+) ${word}$`, 'm')) || [])[1] || 0);
  const failures = [...out.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/gm)]
    .map((m) => ({ name: m[1], err: new Error('failed under claude plugin test') }));
  let failed = count('fail');
  if (res.status !== 0 && failed === 0) {
    failed = 1;
    failures.push({ name: 'claude plugin test', err: new Error(`exited ${res.status}`) });
  }
  return { passed: count('pass'), failed, failures };
};

(async () => {
  const start = Date.now();
  const { suites, withMods } = pickSuites(process.argv.slice(2).filter((arg) => arg !== '--'));

  if (suites.length === 0 && !withMods) {
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

  if (withMods) {
    console.log(`\n\x1b[1m\x1b[36m▶ mod half: claude plugin test\x1b[0m`);
    const mod = runModHalf();
    if (mod.skip) {
      console.log(`\x1b[33m⊘ skipped:\x1b[0m ${mod.skip}`);
      skippedSuites.push({ name: 'mod half (claude plugin test)', reason: mod.skip });
    } else {
      passed += mod.passed;
      failed += mod.failed;
      for (const f of mod.failures) allFailures.push({ name: `mod half › ${f.name}`, err: f.err });
    }
  }
  const ran = suites.length + (withMods ? 1 : 0);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const suiteNote = skippedSuites.length ? `, ${skippedSuites.length} suite${skippedSuites.length === 1 ? '' : 's'} skipped` : '';
  const caseNote = skippedCases.length ? `, ${skippedCases.length} case${skippedCases.length === 1 ? '' : 's'} skipped` : '';
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed${suiteNote}${caseNote}\x1b[0m (${elapsed}s, ${ran} suite${ran === 1 ? '' : 's'})`);

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
