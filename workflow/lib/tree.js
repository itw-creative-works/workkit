/**
 * workflow/lib/tree.js: the processes under a pid by parent, each with the
 * processor time it has used, read from /proc on Linux and `ps` elsewhere, and
 * the end of that tree. A child in its own session is in the tree; one whose
 * parent was already gone is not. On Windows the end alone reads processes, from
 * two tables: the Windows one, through PowerShell, and Git Bash's own, `ps -el`.
 * Usage: const { treeOf, endTreeOf } = require('./tree');   (lib/detach.js, endRun in lib/run-lock.js)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('./run');

const PLATFORM = process.platform;

// How long a terminated tree gets before its forced end, and again after it.
const GRACE_MS = 10000;
const POLL_MS = 200;

// How long the Windows end waits on each table read before it counts as not run.
const READ_MS = 60000;

// The most output a process table read may print.
const TABLE_BUFFER = 64 * 1024 * 1024;

// Each Windows table reader's options: its output as text, bounded at READ_MS.
const READ_OPTIONS = {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  timeout: READ_MS,
  maxBuffer: TABLE_BUFFER,
};

// The Windows table as a JSON array, one row per process, its creation time in
// UTC as a fixed-width string ('' when there is none). No cmdlet: one loads a
// module, which is slow under a home folder PowerShell has not seen.
const WINDOWS_TABLE_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$rows = foreach ($p in ([wmisearcher]'SELECT ProcessId, ParentProcessId, CreationDate FROM Win32_Process').Get()) {",
  "  $created = if ($p.CreationDate) { [Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate).ToUniversalTime().ToString('o') } else { '' }",
  '  \'{"pid":\' + [int]$p.ProcessId + \',"ppid":\' + [int]$p.ParentProcessId + \',"created":"\' + $created + \'"}\'',
  '}',
  "'[' + ($rows -join ',') + ']'",
].join('\n');

const POWERSHELL_ARGS = [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-EncodedCommand', Buffer.from(WINDOWS_TABLE_PS, 'utf16le').toString('base64'),
];

// One Git Bash `ps -el` row: an optional one-letter state, then PID, PPID, PGID and WINPID.
const MSYS_ROW = /^\s*(?:[A-Za-z]\s+)?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s/;

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
    maxBuffer: TABLE_BUFFER,
  });
  if (ps.error) throw ps.error;
  if (ps.status !== 0) throw new Error(`tree.js: ps exited ${ps.status}: ${ps.stderr.trim()}`);
  return ps.stdout.split('\n').map(rowOf).filter(Boolean);
};

/**
 * A Windows table reader's stdout, or a one-line rejection naming `program` when
 * it could not run or exited nonzero, keeping the first non-empty line of its stderr.
 */
const outputOf = (program, result) => {
  if (result.error) throw new Error(`tree.js: ${program} could not run (${result.error.message})`);
  if (result.status !== 0) {
    const first = result.stderr.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    throw new Error(`tree.js: ${program} exited ${result.status}: ${first}`);
  }
  return result.stdout;
};

const unreadable = (program, what) => new Error(`tree.js: ${program} printed a table it cannot read: ${what}`);

const isWindowsRow = (row) => Number.isInteger(row?.pid) && Number.isInteger(row.ppid) && typeof row.created === 'string';

/** The Windows table, one `{ pid, ppid, created }` per process, from PowerShell at `powershell`. */
const windowsTableOf = (run, powershell) => {
  const stdout = outputOf('powershell', run(powershell, POWERSHELL_ARGS, READ_OPTIONS));
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch (err) {
    throw unreadable('powershell', err.message);
  }
  if (!Array.isArray(rows)) throw unreadable('powershell', stdout.trim());
  const bad = rows.find((row) => !isWindowsRow(row));
  if (bad !== undefined) throw unreadable('powershell', JSON.stringify(bad));
  return rows;
};

/** Git Bash's table, one `{ pid, ppid, winpid }` per process, from `ps -el` after its header line. */
const msysTableOf = (run) => {
  const stdout = outputOf('ps', run('bash', ['--noprofile', '--norc', '-c', '/usr/bin/ps -el'], READ_OPTIONS));
  return stdout.split('\n').slice(1).filter((line) => line.trim() !== '').map((line) => {
    const match = MSYS_ROW.exec(line);
    if (!match) throw unreadable('ps', line.trimEnd());
    return { pid: Number(match[1]), ppid: Number(match[2]), winpid: Number(match[4]) };
  });
};

/** A Map from each parent pid in `rows` to the rows it parents. */
const byParent = (rows) => {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  return children;
};

/** The rows of `table` that are `roots` or under one of them by parent. */
const under = (table, roots) => {
  const children = byParent(table);
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    queue.push(...(children.get(pid) ?? []).map((row) => row.pid));
  }
  return table.filter((row) => seen.has(row.pid));
};

/** A Windows process's identity: its pid alone may name a later process. */
const keyOf = (row) => `${row.pid}@${row.created}`;

/**
 * The Windows tree from the members in `tracked`, each new one added to it: a
 * Windows child of a member, created at or after it and before any later holder
 * of its pid, or a Git Bash child of a living member, joined on WINPID. A member
 * the read finds gone is closed after it: a gone process starts nothing. Returns
 * the members alive in `windows`; a process with no creation time is none.
 */
const membersOf = (windows, msys, tracked) => {
  const live = new Map(windows.filter((row) => row.created !== '').map((row) => [row.pid, row]));
  const windowsChildren = byParent([...live.values()]);
  const msysOf = new Map(msys.map((row) => [row.winpid, row]));
  const msysChildren = byParent(msys);
  const queue = [...tracked.values()];
  while (queue.length > 0) {
    const member = queue.shift();
    const holder = live.get(member.pid);
    const alive = holder?.created === member.created;
    const children = member.closed ? [] : (windowsChildren.get(member.pid) ?? [])
      .filter((row) => row.created >= member.created && (alive || !holder || row.created < holder.created));
    if (!alive) member.closed = true;
    if (alive && msysOf.has(member.pid)) {
      const own = msysOf.get(member.pid).pid;
      children.push(...(msysChildren.get(own) ?? []).map((row) => live.get(row.winpid)).filter(Boolean));
    }
    for (const child of children) {
      if (tracked.has(keyOf(child))) continue;
      tracked.set(keyOf(child), child);
      queue.push(child);
    }
  }
  return [...tracked.values()].filter((member) => live.get(member.pid)?.created === member.created);
};

/**
 * The process `pid` and every process under it by parent, one
 * `{ pid, ppid, cpu, command }` each, `cpu` the processor seconds it has used
 * so far (on Linux with its waited-for children's). Null on Windows.
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

/** The end's verdict once its signals are done: the refused pids first, then what outlived the forced end. */
const settled = (refused, outlived) => {
  if (refused.size > 0) throw new Error(`could not signal ${[...refused.keys()].join(', ')} (${[...refused.values()][0]})`);
  if (outlived.length > 0) throw new Error(`tree.js: pid ${outlived.join(', ')} still running after a forced end`);
};

/** Whether `pid` still answers `process.kill(pid, 0)`: ESRCH is gone, any other throw alive. */
const answers = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
};

/**
 * The Windows end: each read of both tables ends every member it finds once,
 * forced, since Windows has no terminate signal a process can answer. Between
 * reads it asks each member through `answers` every POLL_MS until all are gone
 * or GRACE_MS has passed since the last signal, since a read takes seconds. A
 * root the Windows table lacks is a tree already gone. It rejects naming what
 * still lives GRACE_MS after the last signal went out.
 */
const endOnWindows = async (pid, run, systemRoot) => {
  if (!systemRoot) throw new Error('tree.js: SystemRoot is not set, so powershell cannot be found');
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const read = () => [windowsTableOf(run, powershell), msysTableOf(run)];
  const [windows, msys] = read();
  const root = windows.find((row) => row.pid === pid && row.created !== '');
  if (!root) return;
  const tracked = new Map([[keyOf(root), root]]);
  const ended = new Set();
  const refused = new Map();
  let left = membersOf(windows, msys, tracked);
  let lastSignal = Date.now();
  let outlived = [];
  for (;;) {
    left = left.filter((member) => !refused.has(member.pid));
    if (left.length === 0) break;
    const fresh = left.filter((member) => !ended.has(keyOf(member)));
    if (fresh.length > 0) {
      for (const member of fresh) ended.add(keyOf(member));
      signalEach(fresh.map((member) => member.pid), 'SIGKILL', refused);
      lastSignal = Date.now();
    } else if (Date.now() - lastSignal >= GRACE_MS) {
      outlived = left.map((member) => member.pid);
      break;
    }
    const signalled = left.map((member) => member.pid).filter((each) => !refused.has(each));
    await goneWithin(() => signalled.filter(answers), lastSignal + GRACE_MS - Date.now());
    left = membersOf(...read(), tracked);
  }
  settled(refused, outlived);
};

/**
 * Ends the tree `pid` heads: a terminate signal to each process, then a forced
 * end for what still lives GRACE_MS later. A process the tree held keeps
 * counting after its parent is gone, and so does any it starts meanwhile. A
 * refused signal is passed over, so every other process still gets its own,
 * and the end then rejects naming the refused pids. On Windows: endOnWindows,
 * PowerShell run from System32 under SystemRoot, never through PATH.
 * @param {number} pid
 * @param {{ platform?: string, run?: function, systemRoot?: string }} [seams] - the platform, the spawnSync and the SystemRoot the end is for
 * @returns {Promise<void>} resolves when the tree is gone; rejects with `could not signal <pids> (<message>)`, naming what outlived the forced end,
 *   or on Windows `tree.js: SystemRoot is not set, so powershell cannot be found` or a reader's `tree.js: <powershell|ps> ...` line
 */
const endTreeOf = async (pid, { platform = PLATFORM, run = spawnSync, systemRoot = process.env.SystemRoot } = {}) => {
  if (platform === 'win32') {
    await endOnWindows(pid, run, systemRoot);
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
  settled(refused, outlived);
};

module.exports = { treeOf, endTreeOf };
