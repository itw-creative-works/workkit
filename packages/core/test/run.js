#!/usr/bin/env node
/* eslint-disable no-console */
// The kit's test runner, over the repo at the cwd: every suite findSuites
// names, each in a worker process on Node's own runner, a parallel wave then
// the serial tail the repo's `test/lib/serial.js` names, then the mod half
// (`claude plugin test` over `test/mods/*.test.ts`), totalled; non-zero on any
// failure. Suite paths after `--` narrow the run. A repo reaches it through
// `workkit test`, the package's bin.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { fork, spawnSync } from 'node:child_process';
import { findSuites, findModSuites, suiteName, modDir, POOL } from './lib/suites.js';
import { fromStart, unmatchedLine, writtenPaths, namedSuites } from './lib/suite-path.js';
import { runNodeTest, endedMessage, howEnded } from './lib/node-test.js';
import { PIPE_GRACE_MS, SUITE_DEADLINE } from './lib/process.js';
import { endTree, endGroup, groupLives } from './lib/spawn.js';
import { indentRest, indentWriter } from './lib/log.js';

// A repo's serial list is CommonJS, loaded by absolute path.
const require = createRequire(import.meta.url);

const SLOWEST = 5;
// The most seconds TEST_DEADLINE may name: node's timers hold 2^31 - 1 ms at most.
const MAX_DEADLINE_SECONDS = 2147483;
// The signals the runner passes on to its workers' groups before it exits.
const PASSED_ON = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// The pids of the workers still running, whether a signal is ending the run, and
// the pids whose groups that signal began to end.
const live = new Set();
let stopping = false;
let ending = [];

// The repo the run covers, the cwd, and the suite paths it was handed: `--`
// dropped, every other argument a suite path.
const parseArgs = (argv) => {
  const root = process.cwd();
  return { root, paths: writtenPaths(argv) };
};

// The serial list's home, and how a start failure names it.
const SERIAL_FILE = 'test/lib/serial.js';

// The per-file deadline in ms: SUITE_DEADLINE, or the seconds TEST_DEADLINE
// names; a value that is no positive number, or more than a timer holds, ends
// the run before any suite.
const deadlineOf = (raw) => {
  if (raw === undefined) return SUITE_DEADLINE;
  const seconds = Number(raw);
  if (!(seconds > 0) || seconds > MAX_DEADLINE_SECONDS) {
    console.error(`TEST_DEADLINE must be a positive number of seconds, got ${raw}`);
    process.exit(1);
  }
  return seconds * 1000;
};

// The repo's serial tail, paths from the start folder; none without a serial.js.
const serialOf = (root) => {
  const file = path.join(root, SERIAL_FILE);
  return fs.existsSync(file) ? require(file).SERIAL : [];
};

// The named suites, or every suite when none is named; a name that is no
// suite ends the run before anything starts. A named `.test.ts` picks the mod
// half, which `claude plugin test` runs whole, since it takes a folder. A
// serial entry that is no suite ends the run the same way.
const pickSuites = ({ root, paths: args }, serialRels) => {
  const all = findSuites(root);
  const mods = findModSuites(modDir(root));
  const serialMiss = unmatchedLine(root, all, serialRels);
  if (serialMiss !== null) {
    console.error(`${serialMiss} (${SERIAL_FILE})`);
    process.exit(1);
  }
  if (args.length === 0) return { suites: all, withMods: mods.length > 0 };
  const named = args.filter((arg) => !mods.includes(fromStart(root, arg)));
  const miss = unmatchedLine(root, all, named);
  if (miss !== null) {
    console.error(miss);
    process.exit(1);
  }
  return { suites: namedSuites(root, named), withMods: named.length < args.length };
};

// The mod half: the plugin's wiring suites, run by the engine itself on the repo
// root (`claude plugin test` takes a plugin folder). No claude binary is a skip.
const runModHalf = (root) => {
  const res = spawnSync('claude', ['plugin', 'test', root], { cwd: root, encoding: 'utf8' });
  if (res.error) {
    return { skip: res.error.code === 'ENOENT' ? 'no claude binary on PATH' : `claude did not start: ${res.error.message}` };
  }
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  indentWriter(process.stdout.write.bind(process.stdout))(out);
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

// Worker mode: runs one suite on Node's runner and sends its result as ONE
// message, then exits 0 once its output is flushed.
const runOne = async (suite, root) => {
  const result = await runNodeTest(suite, suiteName(root, suite));
  process.send(result, () => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(0)));
  });
};

// One suite in a worker process: everything it wrote, both streams in arrival
// order, its message (null when it ended without one), its wall time in ms and
// whether <deadline> passed first, which ends the worker's process group.
const runWorker = (suite, root, deadline) => new Promise((resolve) => {
  // A run a signal is ending starts no more workers; its exit ends the wait.
  if (stopping) return;
  const began = Date.now();
  // Its own process group off Windows, so endGroup reaches what the suite started in it.
  const child = fork(import.meta.filename, ['--worker', suite, root], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32',
  });
  live.add(child.pid);
  const chunks = [];
  let result = null;
  let timedOut = false;
  let settled = false;
  const watchdog = setTimeout(() => {
    // A result that arrived wins, and a worker that already exited is a crash.
    if (result !== null || child.exitCode !== null || child.signalCode !== null) return;
    timedOut = true;
    // No caller awaits the ladder, so its failure is the file's last output line.
    endGroup(child.pid).catch((err) => {
      chunks.push(Buffer.from(`${err.message}\n`));
      settle({ code: null, signal: null });
    });
  }, deadline);
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    resolve({ output: Buffer.concat(chunks).toString(), result, ms: Date.now() - began, timedOut, ...outcome });
  };
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  child.on('message', (message) => { result = message; });
  child.on('exit', () => {
    live.delete(child.pid);
    setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, PIPE_GRACE_MS).unref();
  });
  child.on('close', (code, signal) => settle({ code, signal }));
  child.on('error', (err) => settle({ code: null, signal: null, error: err.message }));
});

// Off Windows each worker leads its own group, which a signal to the runner's
// never reaches: on one the runner ends every live worker's group, starts no more,
// and exits as the signal would, 128 plus its number. A second KILLs each group the
// first began to end that still lives, before any await, so a KILL to the runner after it cannot land first.
const passSignalsOn = () => {
  for (const signal of PASSED_ON) {
    process.on(signal, async () => {
      const code = 128 + constants.signals[signal];
      if (stopping) {
        // A gone group is skipped: endTree would fall back to its pid, anyone's by now.
        for (const pid of ending) {
          try { if (groupLives(pid)) endTree(pid, 'SIGKILL'); } catch (err) { console.error(err.message); }
        }
        process.exit(code);
      }
      stopping = true;
      ending = [...live];
      await Promise.all(ending.map((pid) => endGroup(pid).catch((err) => console.error(err.message))));
      process.exit(code);
    });
  }
};

// Why a worker that sent nothing ended: its deadline, exit code or signal, then
// the last lines it wrote, so the failure line alone says where it stopped.
const crashMessage = ({ output, code, signal, error, timedOut }, deadline) => {
  const how = timedOut ? `timed out after ${deadline / 1000}s`
    : error ? `did not run: ${error}` : howEnded({ code, signal });
  return endedMessage(how, output);
};

/**
 * One run over a repo: the whole of what `npm test` prints and exits with.
 * @param {string[]} argv `[--] [suite paths...]`, or a worker's
 *   `--worker <suite> <start folder>`
 * @returns {Promise<void>}
 */
export const main = async (argv) => {
  // Node's run() runs no file under a variable its own test files inherit, so a
  // run a case starts in a scratch folder would run nothing; this run is its own.
  delete process.env.NODE_TEST_CONTEXT;
  if (argv[0] === '--worker') {
    // A parent that is gone takes its workers with it, and each worker the
    // processes its suite started: off Windows its own group never hears the terminal.
    process.on('disconnect', () => {
      if (process.platform !== 'win32') endTree(process.pid, 'SIGINT');
      process.exit(1);
    });
    // The deadline's ladder ends a worker through its exit handlers, so a
    // suite's scratch folders are removed.
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
    await runOne(argv[1], argv[2]);
    return;
  }

  const deadline = deadlineOf(process.env.TEST_DEADLINE);
  if (process.platform !== 'win32') passSignalsOn();
  const start = Date.now();
  const args = parseArgs(argv);
  const { root } = args;
  const serialRels = serialOf(root);
  const { suites, withMods } = pickSuites(args, serialRels);

  if (suites.length === 0 && !withMods) {
    console.error('No test file found (*.test.js, *.test.mjs, *.test.cjs)');
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
    const rel = suiteName(root, suite);
    timings.push({ rel, ms: outcome.ms });
    process.stdout.write(`\n\x1b[1m\x1b[36m▶ ${rel}\x1b[0m\n${outcome.output}`);
    const res = outcome.result;
    if (!res || outcome.timedOut) {
      failed++;
      allFailures.push({ name: `run ${rel}`, message: crashMessage(outcome, deadline) });
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
  const serial = new Set(serialRels.map((rel) => fromStart(root, rel)));
  const wave = suites.filter((suite) => !serial.has(suite));
  const outcomes = [];
  let next = 0;
  let printed = 0;
  const lane = async () => {
    while (next < wave.length) {
      const i = next++;
      outcomes[i] = await runWorker(wave[i], root, deadline);
      while (printed < wave.length && outcomes[printed]) {
        report(wave[printed], outcomes[printed]);
        printed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, wave.length) }, lane));

  for (const suite of suites.filter((s) => serial.has(s))) {
    report(suite, await runWorker(suite, root, deadline));
  }

  if (withMods) {
    console.log(`\n\x1b[1m\x1b[36m▶ mod half: claude plugin test\x1b[0m`);
    const mod = runModHalf(root);
    if (mod.skip) {
      console.log(`\x1b[33m⊘ skipped:\x1b[0m ${indentRest(mod.skip)}`);
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
    console.log(`  \x1b[33m⊘ ${s.name}: ${indentRest(s.reason)}\x1b[0m`);
  }

  if (failed > 0) {
    console.log('\n\x1b[1mFailures:\x1b[0m');
    for (const f of allFailures) {
      console.log(`  - ${f.name}: ${indentRest(f.message)}`);
    }
  }
  // exitCode, not exit(): a block may still be draining into a slow pipe.
  process.exitCode = failed > 0 ? 1 : 0;
};

if (import.meta.main) main(process.argv.slice(2));
