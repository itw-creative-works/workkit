/**
 * workflow/lib/run-lock.js: the run lock, one folder per detached run, CJS: the
 * take and its judge (a run that is over, a live holder, a launch still under
 * way), the supervisor's pid file, the record beside the lock, the live and held
 * reads, the end request and its wait, the end of a run's processes, and the
 * sweep of the narrowed runs' slots. The folder's own rules are lib/lock.js's.
 * Usage: const { takeRunLock, dropRunLock } = require('./run-lock');
 */

const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');
const { readOrNull } = require('./read');
const { writeWhole } = require('./detach');
const { endTreeOf } = require('./tree');
const {
  claimDir, lockMark, retireJudged, lockTag, tagPid, pidAlive, isFile, isDir, DAY_MS,
} = require('./lock');

// The seconds a take waits for the pid of a lock whose taker still lives
// (WK_LAUNCH_WAIT), and an end request for its answer (WK_END_WAIT).
const LAUNCH_WAIT_S = 60;
const END_WAIT_S = 30;

// A lock with no taker to read gets this long for its pid; one with a done
// file this long to go, since its own foreground is collecting it.
const NO_TAKER_MS = 5000;
const DONE_GOING_MS = 2000;

// A live remover's gone mark gets this long to go, at no try's cost.
const GONE_WAIT_MS = 5000;

// How often a lock is looked at while a take waits (waitWhile), and while an end waits.
const TAKE_POLL_MS = 100;
const END_POLL_MS = 200;

// The tries a take makes before it gives up on the lock.
const TAKE_TRIES = 3;

// A process group's end: INT first, so the body logs its own code, then TERM,
// then KILL, each 1.5 seconds after the last while the group lives: 15 looks
// GROUP_POLL_MS apart.
const END_LADDER = ['SIGINT', 'SIGTERM', 'SIGKILL'];
const GROUP_POLLS = 15;
const GROUP_POLL_MS = 100;

// The days a narrowed run's slot outlives its done file.
const SLOT_KEEP_DAYS = 1;

/** The seconds an environment variable names, <fallback> when it is unset or empty. */
const secondsOf = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : Number(value);
};

/** Wait while <holds()> does, up to <ms>, looking every TAKE_POLL_MS. */
const waitWhile = async (holds, ms) => {
  const until = Date.now() + ms;
  while (holds() && Date.now() < until) await sleep(TAKE_POLL_MS);
};

/** The pid <lock>/pid holds, its line ends dropped; null with no file. */
const lockPid = (lock) => {
  const text = readOrNull(path.join(lock, 'pid'));
  return text === null ? null : text.replace(/\n+$/, '');
};

/**
 * The code <lock>/done holds, its line ends dropped; '' while there is none.
 * @param {string} lock
 * @returns {string}
 */
const doneCode = (lock) => (readOrNull(path.join(lock, 'done')) ?? '').replace(/\n+$/, '');

const hasDone = (lock) => isFile(path.join(lock, 'done'));

/**
 * The supervisor's pid while <lock> holds a run that is going: a pid file, no
 * done file, and that pid alive.
 * @param {string} lock
 * @returns {number|null}
 */
const runLive = (lock) => {
  const pid = lockPid(lock);
  if (!pid || hasDone(lock) || !pidAlive(pid)) return null;
  return Number(pid);
};

/**
 * The supervisor's pid while <lock> holds a run whose answer no call has
 * collected: a pid file, and that pid alive or its done file written.
 * @param {string} lock
 * @returns {number|null}
 */
const runHeld = (lock) => {
  const pid = lockPid(lock);
  if (!pid || (!hasDone(lock) && !pidAlive(pid))) return null;
  return Number(pid);
};

/**
 * <pid> as <lock>/pid, written whole and renamed, so a second run never reads a
 * half-written pid.
 * @param {string} lock
 * @param {number|string} pid
 */
const writePid = (lock, pid) => writeWhole(path.join(lock, 'pid'), `${pid}\n`);

/**
 * `<pid> <code>` in <lock>.done, beside the lock folder, written whole, for a
 * call attached to the same run that finds the lock already dropped.
 * @param {string} lock
 * @param {number|string} pid
 * @param {number|string} code
 */
const leaveRecord = (lock, pid, code) => writeWhole(`${lock}.done`, `${pid} ${code}\n`);

/**
 * The code <lock>.done records for supervisor <pid>; null with no record or
 * another run's.
 * @param {string} lock
 * @param {number|string} pid
 * @returns {number|null}
 */
const recordedCode = (lock, pid) => {
  const line = (readOrNull(`${lock}.done`) ?? '').split('\n')[0];
  const match = /^[ \t]*(\S+)[ \t]+(\d+)[ \t]*$/.exec(line);
  return match && match[1] === String(pid) ? Number(match[2]) : null;
};

/**
 * Retire <lock> only while <pid> holds it; a run that took it over has written
 * its own pid there. The mark is read before the pid, so a lock taken over
 * after that read keeps its own.
 * @param {string} lock
 * @param {number|string} pid
 * @returns {Promise<void>}
 */
const dropRunLock = async (lock, pid) => {
  await retireJudged(lock, (dir) => lockPid(dir) === String(pid));
};

/**
 * The take's judge. True when <lock>'s run is over: its done file written (the
 * folder given 2s first to go), its pid gone, or no pid once its taker is gone
 * or WK_LAUNCH_WAIT runs out (no taker read: no pid 5s on). A live holder's pid
 * while a live run holds it; false when the folder went meanwhile.
 */
const runOver = async (lock) => {
  const pidFile = path.join(lock, 'pid');
  const mark = lockMark(lock);
  const taker = mark?.startsWith('id.') ? tagPid(mark.slice('id.'.length)) : null;
  const starting = () => fs.existsSync(lock) && !isFile(pidFile);
  if (taker !== null) {
    await waitWhile(() => starting() && pidAlive(taker), secondsOf('WK_LAUNCH_WAIT', LAUNCH_WAIT_S) * 1000);
  } else {
    await waitWhile(starting, NO_TAKER_MS);
  }
  const held = runLive(lock);
  if (held !== null) return held;
  if (!hasDone(lock)) return true;
  await waitWhile(() => fs.existsSync(lock), DONE_GOING_MS);
  return isDir(lock);
};

/**
 * Take <lock> through claimDir with a tag of this process's own. A lock whose
 * run is over is taken over by its mark; a live remover's gone mark gets 5s to
 * go. `detach: could not take the lock <lock>` when it cannot be made.
 * @param {string} lock
 * @returns {Promise<{code: number, mark?: string, held?: number}>} 0 with the
 *   lock's mark, 3 with a live holder's pid, 1 when it cannot be made
 */
const takeRunLock = async (lock) => {
  const refused = () => {
    console.error(`detach: could not take the lock ${lock}`);
    return { code: 1 };
  };
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
  } catch {
    return refused();
  }
  for (let tries = 0; ;) {
    const tag = lockTag();
    if (claimDir(lock, tag)) {
      // The last run's record is no answer for the new one.
      fs.rmSync(`${lock}.done`, { force: true });
      return { code: 0, mark: `id.${tag}` };
    }
    tries += 1;
    if (tries > TAKE_TRIES || (fs.existsSync(lock) && !isDir(lock))) return refused();
    // Gone between the failed take and this look: its run just ended.
    if (!fs.existsSync(lock)) continue;
    // Any answer but a live holder's pid and a live remover's null (a removal lost
    // to another caller included) is judged again.
    const found = await retireJudged(lock, runOver);
    if (typeof found === 'number') return { code: 3, held: found };
    if (found === null) {
      tries -= 1;
      const mark = lockMark(lock);
      if (mark?.startsWith('gone.')) {
        const gone = path.join(lock, mark);
        await waitWhile(() => fs.existsSync(gone), GONE_WAIT_MS);
        if (fs.existsSync(gone)) return refused();
      }
    }
  }
};

/** wk_ask_end's answer once supervisor <pid> is gone: 0 for a done file or a lock holding another pid or none, else 2. */
const goneAnswer = (lock, pid) => (hasDone(lock) || lockPid(lock) !== String(pid) ? 0 : 2);

/**
 * While <lock> holds <pid>, write the end request, then wait up to
 * WK_END_WAIT seconds, with no end of the wait while <lock>/ending says <pid>
 * is ending the run. A supervisor gone already gets no request.
 * @param {string} lock
 * @param {number|string} pid
 * @returns {Promise<number>} 0 once the done file is written or <lock> holds another
 *   pid or none, 1 when the wait runs out, 2 when <pid> is gone, <lock> still holds it
 *   and no done file is there
 */
const askEnd = async (lock, pid) => {
  const deadline = Date.now() + secondsOf('WK_END_WAIT', END_WAIT_S) * 1000;
  if (lockPid(lock) !== String(pid)) return 0;
  if (!pidAlive(pid)) return goneAnswer(lock, pid);
  try {
    fs.writeFileSync(path.join(lock, 'end'), '');
  } catch { /* the lock went meanwhile, read below */ }
  for (;;) {
    if (hasDone(lock) || lockPid(lock) !== String(pid)) return 0;
    // The run may have ended and its lock been dropped between the look above and this one.
    if (!pidAlive(pid)) return goneAnswer(lock, pid);
    if (!isFile(path.join(lock, 'ending')) && Date.now() >= deadline) return 1;
    await sleep(END_POLL_MS);
  }
};

/** Whether the process group <pid> leads empties within 1.5s; a refused probe reads as gone. */
const groupGone = async (pid) => {
  for (let polls = 0; ; polls += 1) {
    try {
      process.kill(-pid, 0);
    } catch {
      return true;
    }
    if (polls >= GROUP_POLLS) return false;
    await sleep(GROUP_POLL_MS);
  }
};

/**
 * End a detached run's supervisor <pid> and what it started. On Windows its
 * process tree (endTreeOf in lib/tree.js), a failure's line on stderr. Elsewhere
 * the supervisor leads its own group, ended by END_LADDER.
 * @param {number|string} pid
 * @returns {Promise<boolean>} false only for a Windows end that failed
 */
const endRun = async (pid) => {
  if (process.platform === 'win32') {
    try {
      await endTreeOf(Number(pid));
      return true;
    } catch (err) {
      console.error(err.message);
      return false;
    }
  }
  for (const signal of END_LADDER) {
    try {
      process.kill(-Number(pid), signal);
    } catch {
      return true;
    }
    if (signal === 'SIGKILL' || await groupGone(Number(pid))) return true;
  }
  return true;
};

/** The sweep's judge: true for a slot whose wrapper was cut off, its done file over a day old, or a gone mark at any age. */
const slotLeft = (lock) => {
  if (lockMark(lock)?.startsWith('gone.')) return true;
  try {
    return Date.now() - fs.statSync(path.join(lock, 'done')).mtimeMs > SLOT_KEEP_DAYS * DAY_MS;
  } catch {
    return false;
  }
};

/**
 * Remove each narrowed run's lock folder left behind, `<base><slot>`: a run
 * whose wrapper was cut off (slotLeft). A live remover's slot stays.
 * @param {string} base the slots' lock path less the slot
 * @returns {Promise<string[]>} the slots whose lock went, for their log and record to go too
 */
const sweepSlots = async (base) => {
  const dir = path.dirname(base);
  const prefix = path.basename(base);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return [];
  }
  const swept = [];
  for (const name of names) {
    const lock = path.join(dir, name);
    if (isDir(lock) && await retireJudged(lock, slotLeft) === true) swept.push(name.slice(prefix.length));
  }
  return swept;
};

module.exports = {
  takeRunLock, runLive, runHeld, writePid, leaveRecord, recordedCode, dropRunLock, askEnd, sweepSlots,
  endRun, pidAlive, doneCode,
};
