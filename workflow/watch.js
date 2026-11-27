#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/watch.js: `workkit watch [--end] [suite|run|<pid>]`, the call attached
// again to the repo's live run, or one that ended with no call attached: the one
// named, else the suite's, else the supervised one, else the one live narrowed
// run. It follows the log to the run's end, a frozen end or the next look
// (attachRun); --end asks the supervisor to end the run instead (askEnd).

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const { readOrNull } = require('./lib/read');
const { INT_CODE } = require('./lib/detach');
const {
  attachRun, viewOf, samePath, sizeOf, bytesOf, lastLines,
} = require('./lib/attach');
const {
  runHeld, runLive, askEnd, pidAlive,
} = require('./lib/run-lock');
const {
  runPaths, lockPathOf, testSlots, clearSlot, LogsDirError,
} = require('./lib/run-paths');
const { sayAs } = require('./lib/say');
const { shellDirOf } = require('../hooks/mods/markers.js');
const { chomp } = require('../hooks/mods/text.js');

const USAGE = 'usage: workkit watch [--end] [suite|run|<pid>]';

// The runs named by word, in the order a call with no name takes them.
const NAMED = ['suite', 'run'];

// How many of the log's last lines a follow prints before its tail.
const BACKLOG = 20;

const COUNT_WORDS = ['', '', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// A view that shows nothing: a run's end collected, its output not the call's.
const UNSEEN = { write: () => {}, flush: () => {}, gone: () => false };

const say = sayAs('watch');

/** A refusal: its line, `watch: <message>`, said on stderr, the call ending with its code. */
class Refusal extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'Refusal';
    this.code = code;
  }
}

const fail = (line, code) => {
  throw new Refusal(line, code);
};

const noRun = (root) => fail(`no run is live in ${root}`);

/** The lock of suite, run, or a narrowed run's slot. */
const lockOf = (root, run) => (NAMED.includes(run) ? lockPathOf(root, run) : lockPathOf(root, 'test', run));

/** Each run whose lock <check> (runHeld or runLive) answers a pid for: suite, run, then each slot. */
const runsWhere = async (root, check) => {
  const found = [];
  for (const run of [...NAMED, ...await testSlots(root)]) {
    if (check(await lockOf(root, run)) !== null) found.push(run);
  }
  return found;
};

/** The refusal that never guesses between live runs, each named in the call that picks it; exit 2. */
const nameOne = (verb, runs) => {
  fail(`${COUNT_WORDS[runs.length] || runs.length} runs are live; name one: ${runs.map((run) => `${verb} ${run}`).join(', or ')}`, 2);
};

/**
 * The run a call with no name takes. A run that ended after a look counts as
 * live: its answer waits in its lock. An end never guesses between running
 * runs, and takes one that finished, its answer uncollected, only when none
 * runs; nor one held in the foreground, which ends with the run that holds it.
 */
const pick = async (root, end, verb) => {
  const live = await runsWhere(root, runHeld);
  if (live.length === 0) noRun(root);
  let chosen = live[0];
  if (end) {
    const running = [];
    for (const run of await runsWhere(root, runLive)) {
      if (!fs.existsSync(path.join(await lockOf(root, run), 'foreground'))) running.push(run);
    }
    if (running.length > 1) nameOne(verb, running);
    if (running.length === 1) [chosen] = running;
  } else if (!NAMED.includes(chosen) && live.length !== 1) {
    nameOne(verb, live);
  }
  return NAMED.includes(chosen) ? { which: chosen, slot: '' } : { which: 'test', slot: chosen };
};

/** <log>'s bytes up to <size>. */
const logBytes = (log, size = sizeOf(log)) => (size > 0 ? bytesOf(log, 0, size) : Buffer.alloc(0));

/** The code of a run whose done file is written, taken from the log's end: the lock drops, and a call still attached reads the code from the record it leaves. */
const collect = (log, lock, pid) => attachRun(log, lock, pid, sizeOf(log), { view: UNSEEN });

/**
 * A narrowed run's slot cleared once its end is read, unless its call still
 * runs (the slot names the script shell's node, script-shell.js): that call is
 * attached, needs the record, and clears the slot itself.
 */
const dropSlot = async (root, slot) => {
  if (slot === '' || pidAlive(slot)) return;
  await clearSlot(root, slot);
};

/**
 * --end on a run held in the foreground (runForeground in lib/attach.js), whose
 * end file no supervisor reads: the refusal names the call that ends the run
 * its marker holds, the marker's path folded from any shell spelling first.
 */
const refuseForeground = async (root, lock, name) => {
  const enclosing = shellDirOf(chomp(readOrNull(path.join(lock, 'foreground'))), process.env, process.platform);
  let how = 'end the run that started it';
  if (samePath(enclosing, await lockOf(root, 'run'))) how = 'workkit watch --end run ends it';
  else if (samePath(enclosing, await lockOf(root, 'suite'))) how = 'workkit watch --end suite ends it';
  fail(`workkit watch --end ${name} cannot end a run held in the foreground inside another run; ${how}`);
};

/** The end request and its wait, then the log's last line; a supervisor gone with no answer has its own line. */
const endRun = async (log, lock, pid) => {
  const asked = await askEnd(lock, pid);
  if (asked === 2) fail(`the run's supervisor (pid ${pid}) is gone and left no answer`);
  if (asked !== 0) fail(`the run did not end; its supervisor is pid ${pid}`);
  if (fs.existsSync(path.join(lock, 'done'))) await collect(log, lock, pid);
  process.stdout.write(lastLines(logBytes(log), 1));
};

/**
 * The call: a follow prints the log's last lines up to a size measured first,
 * then the tail from that size, both through one view, so no line shows twice
 * and one painter paints both.
 * @param {string[]} argv `[--end] [suite|run|<pid>]`
 * @returns {Promise<number>} the run's own code, 0 for an end, 1, 2, 125 on a look, 130 on an INT
 */
const main = async (argv) => {
  const args = [...argv];
  const end = args[0] === '--end';
  if (end) args.shift();
  let which = null;
  let slot = '';
  if (NAMED.includes(args[0])) {
    which = args.shift();
  } else if (/^\d+$/.test(args[0] ?? '')) {
    which = 'test';
    slot = args.shift();
  }
  if (args.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const root = repoRoot(process.cwd());
  if (root === null) fail('not inside a git repository');
  if (which === null) ({ which, slot } = await pick(root, end, end ? 'workkit watch --end' : 'workkit watch'));
  const lock = await lockPathOf(root, which, slot);
  const pid = runHeld(lock);
  if (pid === null) noRun(root);
  const { log } = await runPaths(root, which, slot);
  // The look line names the slot's call: `workkit watch <pid>`.
  process.env.WK_WATCH_NAME = slot;

  if (end && fs.existsSync(path.join(lock, 'done'))) {
    const done = await collect(log, lock, pid);
    await dropSlot(root, slot);
    if (done.code === null) return 1;
    console.log(`watch: the run ended already (exit ${done.code})`);
    return 0;
  }
  if (end) {
    if (fs.existsSync(path.join(lock, 'foreground'))) await refuseForeground(root, lock, slot || which);
    await endRun(log, lock, pid);
    await dropSlot(root, slot);
    return 0;
  }
  const size = sizeOf(log);
  const view = viewOf();
  view.write(lastLines(logBytes(log, size), BACKLOG));
  const stop = new AbortController();
  // An INT ends this call alone: the run goes on, its lock held.
  process.on('SIGINT', () => stop.abort());
  const done = await attachRun(log, lock, pid, size, { signal: stop.signal, view });
  if (done.stopped) return INT_CODE;
  // A look keeps the slot for the next watch.
  if (!done.look) await dropSlot(root, slot);
  return done.rc;
};

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((err) => {
      if (err instanceof Refusal) {
        say(err.message);
        return err.code;
      }
      if (!(err instanceof LogsDirError)) throw err;
      console.error(err.message);
      return 1;
    })
    // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
    .then((code) => { process.exitCode = code; });
}
