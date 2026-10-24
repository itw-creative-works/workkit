#!/usr/bin/env node
/* eslint-disable no-console */
// The kit's test runner, over the repo `--root <dir>` names (else the cwd): every
// `test/**/*.test.js` in worker processes, a parallel wave then the serial tail
// the repo's `test/lib/serial.js` names, then the mod half (`claude plugin test`
// over `test/mods/*.test.ts`), totalled; non-zero on any failure. Suite paths
// after `--` narrow the run. A repo reaches it through a `test/run.js` that
// calls `main`. A repo with no `test/` is read from `tests/`.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const { fork, spawnSync } = require('child_process');
const { findSuites, findModSuites, POOL } = require('./lib/suites');
const { isNodeTestSuite, runNodeTest } = require('./lib/node-test');

// How long a worker's pipes stay open past its exit, for a grandchild still
// holding them; the worker's own output is already in the pipe by then.
const PIPE_GRACE_MS = 1000;
const TAIL_LINES = 3;
const SLOWEST = 5;

// The repo's suite folder: `test/`, Node's convention; `tests/` only when the
// repo has that folder and no `test/`.
const suiteDir = (root) => {
  const isDir = (dir) => fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  const dir = path.join(root, 'test');
  const legacy = path.join(root, 'tests');
  return !isDir(dir) && isDir(legacy) ? legacy : dir;
};

// The repo the run covers and the suite paths it was handed: `--root <dir>`
// anywhere, `--` dropped, every other argument a suite path.
const parseArgs = (argv) => {
  let rootArg = process.cwd();
  const paths = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      if (i + 1 >= argv.length) {
        console.error('--root needs a folder');
        process.exit(1);
      }
      rootArg = argv[++i];
    } else if (argv[i] !== '--') {
      paths.push(argv[i]);
    }
  }
  const root = path.resolve(rootArg);
  const testDir = suiteDir(root);
  return { root, testDir, modDir: path.join(testDir, 'mods'), paths };
};

// The repo's serial tail, relative to the suite folder; none without a serial.js.
const serialOf = (testDir) => {
  const file = path.join(testDir, 'lib', 'serial.js');
  return fs.existsSync(file) ? require(file).SERIAL : [];
};

// The named suites, or every suite when none is named; a name that is no
// suite ends the run before anything starts. A named `.test.ts` picks the mod
// half, which `claude plugin test` runs whole, since it takes a folder. A
// serial entry that is no suite ends the run the same way.
const pickSuites = ({ root, testDir, modDir, paths: args }, serialRels) => {
  const all = fs.existsSync(testDir) ? findSuites(testDir) : [];
  const mods = findModSuites(modDir);
  for (const rel of serialRels) {
    if (!all.includes(path.join(testDir, rel))) {
      console.error(`No suite matches ${rel} (${path.basename(testDir)}/lib/serial.js)`);
      process.exit(1);
    }
  }
  if (args.length === 0) return { suites: all.sort(), withMods: mods.length > 0 };
  const picked = new Set();
  let withMods = false;
  for (const arg of args) {
    const full = path.resolve(root, arg);
    if (mods.includes(full)) {
      withMods = true;
      continue;
    }
    if (!all.includes(full)) {
      console.error(`No suite matches ${arg} under ${path.basename(testDir)}/`);
      process.exit(1);
    }
    picked.add(full);
  }
  return { suites: [...picked].sort(), withMods };
};

// The mod half: the plugin's wiring suites, run by the engine itself on the repo
// root (`claude plugin test` takes a plugin folder). No claude binary is a skip.
const runModHalf = (root) => {
  const res = spawnSync('claude', ['plugin', 'test', root], { cwd: root, encoding: 'utf8' });
  if (res.error) {
    return { skip: res.error.code === 'ENOENT' ? 'no claude binary on PATH' : `claude did not start: ${res.error.message}` };
  }
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(out);
  const count = (word) => Number((out.match(new RegExp(`^\\s*(\\d+) ${word}$`, 'm')) || [])[1] || 0);
  const failures = [...out.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/gm)]
    .map((m) => ({ name: m[1], message: 'failed under claude plugin test' }));
  let failed = count('fail');
  if (res.status !== 0 && failed === 0) {
    failed = 1;
    failures.push({ name: 'claude plugin test', message: `exited ${res.status}` });
  }
  return { passed: count('pass'), failed, failures };
};

// Worker mode: runs one suite and sends its result as ONE message, then exits 0
// once its output is flushed. A whole-suite failure (no load, no runner, a
// throw) is a `whole` failure, named as the runner always named it. A
// `node:test` suite is picked before any require, which would run its tests.
const runOne = async (suite, testDir) => {
  const rel = path.relative(testDir, suite);
  const result = { passed: 0, failed: 0, failures: [], skips: [], skipped: null };
  const send = () => process.send(result, () => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(0)));
  });
  if (isNodeTestSuite(fs.readFileSync(suite, 'utf8'))) {
    Object.assign(result, await runNodeTest(suite, rel));
    send();
    return;
  }
  const wholeFailure = (name, message) => {
    result.failed = 1;
    result.failures = [{ name, message, whole: true }];
  };
  let mod;
  let loaded = false;
  try {
    mod = require(suite);
    loaded = true;
  } catch (err) {
    console.error(`\x1b[31mfailed to load ${rel}:\x1b[0m ${err.stack || err}`);
    wholeFailure(`load ${rel}`, err.message);
  }
  if (loaded && typeof mod !== 'function') {
    console.error(`\x1b[31m${rel} does not export an async runner function\x1b[0m`);
    wholeFailure(`export ${rel}`, 'no default export function');
  } else if (loaded) {
    try {
      const res = await mod();
      result.passed = res.passed || 0;
      result.failed = res.failed || 0;
      result.failures = (res.failures || []).map((f) => ({ name: f.name, message: f.err.message }));
      result.skips = (res.skips || []).map((s) => ({ name: s.name, reason: s.reason }));
    } catch (err) {
      // skipSuite() reports a missing precondition, not a defect.
      if (err.suiteSkipped) {
        console.log(`\x1b[33m⊘ skipped:\x1b[0m ${err.message}`);
        result.skipped = err.message;
      } else {
        console.error(`\x1b[31m${rel} threw:\x1b[0m ${err.stack || err}`);
        wholeFailure(`run ${rel}`, err.message);
      }
    }
  }
  send();
};

// One suite in a worker process: everything it wrote, both streams in arrival
// order, its message (null when it ended without one) and its wall time in ms.
const runWorker = (suite, testDir) => new Promise((resolve) => {
  const began = Date.now();
  const child = fork(__filename, ['--worker', suite, testDir], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const chunks = [];
  let result = null;
  let settled = false;
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    resolve({ output: Buffer.concat(chunks).toString(), result, ms: Date.now() - began, ...outcome });
  };
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  child.on('message', (message) => { result = message; });
  child.on('exit', () => {
    setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, PIPE_GRACE_MS).unref();
  });
  child.on('close', (code, signal) => settle({ code, signal }));
  child.on('error', (err) => settle({ code: null, signal: null, error: err.message }));
});

// Why a worker that sent nothing ended: its exit code or signal, then the last
// lines it wrote, so the failure line alone says where it stopped.
const crashMessage = ({ output, code, signal, error }) => {
  const how = error ? `did not run: ${error}` : signal ? `killed by ${signal}` : `exited with code ${code}`;
  const tail = stripVTControlCharacters(output).split('\n').map((line) => line.trim()).filter(Boolean).slice(-TAIL_LINES);
  return `${how} without a result${tail.length ? `; last output: ${tail.join(' | ')}` : ''}`;
};

/**
 * One run over a repo: the whole of what `npm test` prints and exits with.
 * @param {string[]} argv `[--root <dir>] [--] [suite paths...]`, or a worker's
 *   `--worker <suite> <suite dir>`
 * @returns {Promise<void>}
 */
const main = async (argv) => {
  if (argv[0] === '--worker') {
    // A parent that is gone takes its workers with it.
    process.on('disconnect', () => process.exit(1));
    await runOne(argv[1], argv[2]);
    return;
  }

  const start = Date.now();
  const args = parseArgs(argv);
  const { root, testDir } = args;
  const serialRels = serialOf(testDir);
  const { suites, withMods } = pickSuites(args, serialRels);

  if (suites.length === 0 && !withMods) {
    console.error(`No *.test.js suites found under ${path.basename(testDir)}/.`);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const allFailures = [];
  const skippedSuites = [];
  const skippedCases = [];
  const timings = [];

  // One finished suite: its block printed whole, its counts and time added.
  const report = (suite, outcome) => {
    const rel = path.relative(testDir, suite);
    timings.push({ rel, ms: outcome.ms });
    process.stdout.write(`\n\x1b[1m\x1b[36m▶ ${rel}\x1b[0m\n${outcome.output}`);
    const res = outcome.result;
    if (!res) {
      failed++;
      allFailures.push({ name: `run ${rel}`, message: crashMessage(outcome) });
      return;
    }
    if (res.skipped !== null) {
      skippedSuites.push({ name: rel, reason: res.skipped });
      return;
    }
    passed += res.passed;
    failed += res.failed;
    for (const f of res.failures) {
      allFailures.push({ name: f.whole ? f.name : `${rel} › ${f.name}`, message: f.message });
    }
    for (const s of res.skips) {
      skippedCases.push({ name: `${rel} › ${s.name}`, reason: s.reason });
    }
  };

  // The parallel wave: POOL workers at a time, each block printed once it and
  // every suite before it have finished, so the order is the sorted list's.
  const serial = new Set(serialRels.map((rel) => path.join(testDir, rel)));
  const wave = suites.filter((suite) => !serial.has(suite));
  const outcomes = [];
  let next = 0;
  let printed = 0;
  const lane = async () => {
    while (next < wave.length) {
      const i = next++;
      outcomes[i] = await runWorker(wave[i], testDir);
      while (printed < wave.length && outcomes[printed]) {
        report(wave[printed], outcomes[printed]);
        printed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, wave.length) }, lane));

  for (const suite of suites.filter((s) => serial.has(s))) {
    report(suite, await runWorker(suite, testDir));
  }

  if (withMods) {
    console.log(`\n\x1b[1m\x1b[36m▶ mod half: claude plugin test\x1b[0m`);
    const mod = runModHalf(root);
    if (mod.skip) {
      console.log(`\x1b[33m⊘ skipped:\x1b[0m ${mod.skip}`);
      skippedSuites.push({ name: 'mod half (claude plugin test)', reason: mod.skip });
    } else {
      passed += mod.passed;
      failed += mod.failed;
      for (const f of mod.failures) allFailures.push({ name: `mod half › ${f.name}`, message: f.message });
    }
  }
  const ran = suites.length + (withMods ? 1 : 0);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const suiteNote = skippedSuites.length ? `, ${skippedSuites.length} suite${skippedSuites.length === 1 ? '' : 's'} skipped` : '';
  const caseNote = skippedCases.length ? `, ${skippedCases.length} case${skippedCases.length === 1 ? '' : 's'} skipped` : '';
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed${suiteNote}${caseNote}\x1b[0m (${elapsed}s, ${ran} suite${ran === 1 ? '' : 's'})`);
  if (timings.length) {
    const slowest = timings.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST);
    console.log(`slowest: ${slowest.map(({ rel, ms }) => `${rel} ${(ms / 1000).toFixed(1)}s`).join(', ')}`);
  }

  // Name every skip, file and case alike: a run must never quietly cover less
  // than the reader assumes.
  for (const s of [...skippedSuites, ...skippedCases]) {
    console.log(`  \x1b[33m⊘ ${s.name}: ${s.reason}\x1b[0m`);
  }

  if (failed > 0) {
    console.log('\n\x1b[1mFailures:\x1b[0m');
    for (const f of allFailures) {
      console.log(`  - ${f.name}: ${f.message}`);
    }
  }
  // exitCode, not exit(): a block may still be draining into a slow pipe.
  process.exitCode = failed > 0 ? 1 : 0;
};

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
