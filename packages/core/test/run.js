#!/usr/bin/env node
/* eslint-disable no-console */
// The kit's test runner, over the repo at the cwd: the suites lib/pick.js
// picks, each in a worker process on Node's own runner, a parallel wave then
// the serial tail the repo's `test/lib/serial.js` names, then the mod half
// (`claude plugin test` over `test/mods/*.test.ts`), then each workspace
// member's own `npm test`, totalled; non-zero on any failure. Suite paths
// after `--` narrow the run, `--filter=<text>` its cases. A repo reaches it
// through `workkit test`, the package's bin.

import fs from 'node:fs';
import { constants } from 'node:os';
import { fork, spawn } from 'node:child_process';
import { suiteName, POOL } from './lib/suites.js';
import { readFilter, writtenPaths } from './lib/suite-path.js';
import { pickSuites, SKIP_FILE } from './lib/pick.js';
import { membersOf, runMember, memberOutcome, PlanError } from './lib/members.js';
import { runNodeTest, endedMessage, howEnded } from './lib/node-test.js';
import { PIPE_GRACE_MS, SUITE_DEADLINE } from './lib/process.js';
import { endTree, endGroup, groupLives } from './lib/spawn.js';
import { indentRest, indentWriter } from './lib/log.js';
import { paint } from './lib/paint.js';
import { kitModule } from './lib/kit-module.js';

// The kit's program starter: on Windows it finds a `claude.cmd` a raw start misses.
const { spawnSync } = kitModule('run');

const SLOWEST = 5;
// Why the mod half and the members do not start under a filter.
const NOT_UNDER_FILTER = 'not started under --filter';
// The most seconds TEST_DEADLINE may name: node's timers hold 2^31 - 1 ms at most.
const MAX_DEADLINE_SECONDS = 2147483;
// The signals the runner passes on to its workers' groups before it exits.
const PASSED_ON = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// The pids of the workers still running, whether a signal is ending the run, and
// the pids whose groups that signal began to end.
const live = new Set();
let stopping = false;
let ending = [];

// The repo the run covers, the cwd, the filter text (null without the flag)
// and the suite paths it was handed: `--` dropped, every other argument a
// suite path. A misused flag ends the run before any suite.
const parseArgs = (argv) => {
  const { filter, rest, error } = readFilter(argv);
  if (error !== null) {
    console.error(error);
    process.exit(1);
  }
  return { root: process.cwd(), paths: writtenPaths(rest), filter };
};

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

// The workspace members of <root>; a pattern the expansion refuses ends the
// run with the publish plan's own line, a package.json that does not parse by its path.
const membersIn = (root) => {
  try {
    return membersOf(root);
  } catch (err) {
    if (!(err instanceof PlanError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
};

// What one run covers, or the line that ends it before any suite: the suites
// lib/pick.js picks, and the members a bare run starts (those with a `test`
// script that no active skip entry names, the rest counted as left out), held
// back whole under a filter.
const startOf = ({ root, paths, filter }) => {
  let members = null;
  const membersHere = () => {
    members ??= membersIn(root);
    return members;
  };
  const isMember = (dir) => membersHere().some((member) => member.dir === dir);
  const picked = pickSuites({ root, paths, ci: Boolean(process.env.CI), isMember });
  if (picked.error !== undefined) {
    console.error(picked.error);
    process.exit(1);
  }
  const tested = paths.length === 0 ? membersHere().filter((member) => member.tested) : [];
  const startable = tested.filter((member) => !picked.skipped.includes(member.dir));
  if (picked.suites.length === 0 && !picked.withMods && startable.length === 0) {
    console.error('No test file found (*.test.js, *.test.mjs, *.test.cjs)');
    process.exit(1);
  }
  const held = filter !== null && startable.length > 0;
  return {
    ...picked, members: held ? [] : startable, membersHeld: held, membersLeftOut: tested.length - startable.length,
  };
};

// <text> on stdout, painted by Node's rule for it (lib/paint.js): the workers
// write plain text, so every color the run shows is put on here.
const show = (text, done) => process.stdout.write(paint(text, process.stdout), done);
const showLine = (line) => show(`${line}\n`);

// <text> shown, resolved once written: a member's output goes to the same
// place straight from its own process, so nothing of ours may still be queued.
const say = (text) => new Promise((resolve) => { show(text, resolve); });

// The mod half: the plugin's wiring suites, run by the engine itself on the repo
// root (`claude plugin test` takes a plugin folder). No claude binary is a skip.
const runModHalf = (root) => {
  const res = spawnSync('claude', ['plugin', 'test', root], { cwd: root, encoding: 'utf8' });
  if (res.error) {
    return { skip: res.error.code === 'ENOENT' ? 'no claude binary on PATH' : `claude did not start: ${res.error.message}` };
  }
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  indentWriter(show)(out);
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
const runOne = async (suite, root, filter) => {
  const result = await runNodeTest(suite, suiteName(root, suite), filter);
  process.send(result, () => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(0)));
  });
};

// One suite in a worker process, handed the filter text when there is one:
// everything it wrote, both streams in arrival order, its message (null when it
// ended without one), its wall time in ms and whether <deadline> passed first,
// which ends the worker's process group.
const runWorker = (suite, { root, filter }, deadline) => new Promise((resolve) => {
  // A run a signal is ending starts no more workers; its exit ends the wait.
  if (stopping) return;
  const began = Date.now();
  // Its own process group off Windows, so endGroup reaches what the suite started in it.
  const child = fork(import.meta.filename, ['--worker', suite, root, ...(filter === null ? [] : [filter])], {
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
// never reaches: on one the runner ends every live worker's group, starts and prints
// no more, and exits as the signal would, 128 plus its number. A second KILLs each group the
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
 * @param {string[]} argv `[--] [--filter=<text>] [suite paths...]`, or a
 *   worker's `--worker <suite> <start folder> [<filter text>]`
 * @returns {Promise<void>}
 */
export const main = async (argv) => {
  // Node's run() runs no file under a variable its own test files inherit, so a
  // run a case starts in a scratch folder would run nothing; this run is its own.
  delete process.env.NODE_TEST_CONTEXT;
  // The file `workkit proof red` names for this run's counts; taken out, so a
  // run a suite starts writes no line of its own.
  const summaryFile = process.env.WORKKIT_TEST_SUMMARY;
  delete process.env.WORKKIT_TEST_SUMMARY;
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
    await runOne(argv[1], argv[2], argv[3] ?? null);
    return;
  }

  let passed = 0;
  let failed = 0;
  // One line added on every exit the run makes itself, one before any suite
  // included, since one proof command may start several runs.
  if (summaryFile) {
    process.on('exit', () => fs.appendFileSync(summaryFile, `${JSON.stringify({ passed, failed })}\n`));
  }
  const deadline = deadlineOf(process.env.TEST_DEADLINE);
  if (process.platform !== 'win32') passSignalsOn();
  const start = Date.now();
  const args = parseArgs(argv);
  const { root, filter } = args;
  const {
    suites, serial, withMods, leftOut, members, membersHeld, membersLeftOut,
  } = startOf(args);

  const allFailures = [];
  const skippedSuites = [];
  const skippedCases = [];
  const timings = [];
  let reported = 0;
  if (membersHeld) skippedSuites.push({ name: 'members', reason: NOT_UNDER_FILTER });

  // One finished suite: its block printed whole, its counts and time added.
  // Under a filter, a suite whose every case was left out prints and counts nothing,
  // and so does one that ends while a signal is ending the run.
  const report = (suite, outcome) => {
    if (stopping) return;
    const rel = suiteName(root, suite);
    const res = outcome.result;
    if (filter !== null && res && !outcome.timedOut && res.passed + res.failed + res.skips.length === 0) return;
    reported++;
    timings.push({ rel, ms: outcome.ms });
    show(`\n▶ ${rel}\n${outcome.output}`);
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

  if (filter !== null) showLine(`filter: ${filter}`);
  if (leftOut > 0) showLine(`skip: ${leftOut} suite${leftOut === 1 ? '' : 's'} left out (${SKIP_FILE})`);
  if (membersLeftOut > 0) showLine(`skip: ${membersLeftOut} member${membersLeftOut === 1 ? '' : 's'} left out (${SKIP_FILE})`);

  // The parallel wave: POOL workers at a time, each block printed once it and
  // every suite before it have finished, so the order is the sorted list's.
  // Then the serial tail, one at a time, in the serial list's order.
  const inSerial = new Set(serial);
  const wave = suites.filter((suite) => !inSerial.has(suite));
  const outcomes = [];
  let next = 0;
  let printed = 0;
  const lane = async () => {
    while (next < wave.length) {
      const i = next++;
      outcomes[i] = await runWorker(wave[i], args, deadline);
      while (printed < wave.length && outcomes[printed]) {
        report(wave[printed], outcomes[printed]);
        printed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, wave.length) }, lane));

  for (const suite of serial.filter((s) => suites.includes(s))) {
    report(suite, await runWorker(suite, args, deadline));
  }

  // A worker that ended while a signal is ending the run lets the wave finish:
  // the signal's handler exits the run, so no mod half, member or totals follow.
  if (stopping) return;

  if (withMods) {
    showLine('\n▶ mod half: claude plugin test');
    const mod = filter === null ? runModHalf(root) : { skip: NOT_UNDER_FILTER };
    if (mod.skip) {
      showLine(`⊘ skipped: ${indentRest(mod.skip)}`);
      skippedSuites.push({ name: 'mod half (claude plugin test)', reason: mod.skip });
    } else {
      passed += mod.passed;
      failed += mod.failed;
      for (const f of mod.failures) allFailures.push({ name: `mod half › ${f.name}`, message: f.message });
    }
  }
  const ran = reported + (withMods ? 1 : 0);

  // The members, one at a time in folder order, each on its own runner.
  const rows = [];
  for (const member of members) {
    // A run a signal is ending starts no more members, and prints no row or
    // totals for the one it ended: the signal's handler exits the run.
    if (stopping) return;
    await say(`\n▶ ${member.name}: npm test\n`);
    const end = await runMember(member, { spawn, live });
    if (stopping) return;
    const outcome = memberOutcome(member.name, end);
    rows.push(outcome.row);
    passed += outcome.passed;
    failed += outcome.failed;
    if (outcome.failure) allFailures.push(outcome.failure);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const suiteNote = skippedSuites.length ? `, ${skippedSuites.length} suite${skippedSuites.length === 1 ? '' : 's'} skipped` : '';
  const caseNote = skippedCases.length ? `, ${skippedCases.length} case${skippedCases.length === 1 ? '' : 's'} skipped` : '';
  const memberNote = rows.length ? `, ${rows.length} member${rows.length === 1 ? '' : 's'}` : '';
  if (rows.length) showLine(`\n${rows.join('\n')}`);
  showLine(`\n${passed} passed, ${failed} failed${suiteNote}${caseNote} (${elapsed}s, ${ran} suite${ran === 1 ? '' : 's'}${memberNote})`);
  if (timings.length) {
    const slowest = timings.sort((a, b) => b.ms - a.ms).slice(0, SLOWEST);
    showLine(`slowest: ${slowest.map(({ rel, ms }) => `${rel} ${(ms / 1000).toFixed(1)}s`).join(', ')}`);
  }

  // Name every skip, file and case alike: a run must never quietly cover less
  // than the reader assumes.
  for (const s of [...skippedSuites, ...skippedCases]) {
    showLine(`  ⊘ ${s.name}: ${indentRest(s.reason)}`);
  }

  if (failed > 0) {
    showLine('\nFailures:');
    for (const f of allFailures) {
      showLine(`  - ${f.name}: ${indentRest(f.message)}`);
    }
  }
  // A filter that matched no case anywhere proves nothing, so it is no pass.
  const noMatch = filter !== null && passed + failed + skippedCases.length === 0;
  if (noMatch) console.error(`No case matches ${filter}`);
  // exitCode, not exit(): a block may still be draining into a slow pipe.
  process.exitCode = failed > 0 || noMatch ? 1 : 0;
};

if (import.meta.main) main(process.argv.slice(2));
