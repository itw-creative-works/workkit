/**
 * workflow/lib/tree.js: the processes under a pid by parent, each with the
 * processor time it has used, read from /proc on Linux and `ps` elsewhere, and
 * the end of that tree. A child in its own session is in the tree; one whose
 * parent was already gone is not.
 * Usage: const { treeOf, endTreeOf } = require('./tree');
 */

const fs = require('fs');
const { spawnSync } = require('./run');

const PLATFORM = process.platform;

// How long a terminated tree gets before its forced end, and again after it.
const GRACE_MS = 10000;
const POLL_MS = 200;

// One `ps` row: pid, ppid, state, processor time, command.
const ROW = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s?(.*)$/;

// /proc's clock ticks per second (USER_HZ), 100 on every Linux the kit runs on.
const TICKS = 100;

// The /proc/<pid>/stat fields after the command, from field 3 (state): ppid,
// then utime, stime, cutime and cstime, the last two its waited-for children's.
const STAT_PPID = 1;
const STAT_TIMES = [11, 12, 13, 14];

/**
 * Processor seconds from `ps`'s time column: `[DD-][HH:]MM:SS.ss` on macOS,
 * `[DD-]HH:MM:SS` on Linux.
 * @param {string} time
 * @returns {number}
 */
const secondsOf = (time) => {
  const [days, clock] = time.includes('-') ? time.split('-') : ['0', time];
  const seconds = Number(days) * 86400 + clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
  if (Number.isNaN(seconds)) throw new Error(`tree.js: ps printed a processor time it cannot read: ${time}`);
  return seconds;
};

/** One row of `ps`, null for a blank line or a zombie, which uses nothing and cannot be ended. */
const rowOf = (line) => {
  if (line.trim() === '') return null;
  const match = ROW.exec(line);
  if (!match) throw new Error(`tree.js: ps printed a line it cannot read: ${line}`);
  const [, pid, ppid, stat, time, command] = match;
  if (stat.startsWith('Z')) return null;
  return { pid: Number(pid), ppid: Number(ppid), cpu: secondsOf(time), command };
};

/**
 * One process read from /proc, null when it is gone or a zombie. Its `cpu`
 * holds the time of the children it has waited for, so a short-lived child's
 * work reaches its parent.
 * @param {string} pid
 * @returns {{pid: number, ppid: number, cpu: number, command: string}|null}
 */
const procRowOf = (pid) => {
  let stat;
  let cmdline;
  try {
    stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ESRCH') return null;
    throw err;
  }
  // The command sits in parentheses and may hold either, so the last `)` ends it.
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).split(' ');
  if (fields[0] === 'Z') return null;
  const ticks = STAT_TIMES.reduce((sum, index) => sum + Number(fields[index]), 0);
  const command = cmdline.split('\0').filter(Boolean).join(' ') || `[${stat.slice(stat.indexOf('(') + 1, close)}]`;
  return { pid: Number(pid), ppid: Number(fields[STAT_PPID]), cpu: ticks / TICKS, command };
};

/** Every live process on Linux, one row each, from /proc. */
const procTableOf = () => fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(procRowOf).filter(Boolean);

/** Every live process on the machine, one row each. */
const tableOf = () => {
  if (PLATFORM === 'linux') return procTableOf();
  const ps = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'stat=', '-o', 'time=', '-o', 'command='], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ps.error) throw ps.error;
  if (ps.status !== 0) throw new Error(`tree.js: ps exited ${ps.status}: ${ps.stderr.trim()}`);
  return ps.stdout.split('\n').map(rowOf).filter(Boolean);
};

/** The rows of `table` that are `roots` or under one of them by parent. */
const under = (table, roots) => {
  const children = new Map();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return table.filter((row) => seen.has(row.pid));
};

/**
 * The process `pid` and every process under it by parent, one
 * `{ pid, ppid, cpu, command }` each, `cpu` the processor seconds it has used
 * so far (on Linux with its waited-for children's). Null on Windows, where no
 * process is read.
 * @param {number} pid
 * @returns {{pid: number, ppid: number, cpu: number, command: string}[]|null}
 */
const treeOf = (pid) => (PLATFORM === 'win32' ? null : under(tableOf(), [pid]));

/** Sends `signal` to each pid; one already gone is passed over, and a refusal is kept in `refused` by pid. */
const signalEach = (pids, signal, refused) => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (err) {
      if (err.code !== 'ESRCH') refused.set(pid, err.message);
    }
  }
};

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Whether `left()` comes back empty within `ms`, asked every POLL_MS. */
const goneWithin = async (left, ms) => {
  const until = Date.now() + ms;
  while (left().length > 0) {
    if (Date.now() >= until) return false;
    await pause(POLL_MS);
  }
  return true;
};

/**
 * Ends the tree `pid` heads: a terminate signal to each process, then a forced
 * end for what still lives GRACE_MS later. A process the tree held keeps
 * counting after its parent is gone, and so does any it starts meanwhile. A
 * refused signal is passed over, so every other process still gets its own,
 * and the end then rejects naming the refused pids. On Windows one `taskkill /T /F`.
 * @param {number} pid
 * @returns {Promise<void>} resolves when the tree is gone; rejects with `could not signal <pids> (<message>)`, or naming what outlived the forced end
 */
const endTreeOf = async (pid) => {
  if (PLATFORM === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    return;
  }
  const tracked = new Set([pid]);
  const refused = new Map();
  const left = () => {
    const rows = under(tableOf(), tracked);
    for (const row of rows) tracked.add(row.pid);
    return rows.map((row) => row.pid).filter((each) => !refused.has(each));
  };
  let outlived = [];
  signalEach(left(), 'SIGTERM', refused);
  if (!(await goneWithin(left, GRACE_MS))) {
    signalEach(left(), 'SIGKILL', refused);
    if (!(await goneWithin(left, GRACE_MS))) outlived = left();
  }
  if (refused.size > 0) throw new Error(`could not signal ${[...refused.keys()].join(', ')} (${[...refused.values()][0]})`);
  if (outlived.length > 0) throw new Error(`tree.js: pid ${outlived.join(', ')} still running after a forced end`);
};

module.exports = { treeOf, endTreeOf };
