/**
 * workflow/lib/proc-state.js: a process's state, CJS, requiring nothing beyond
 * Node so workkit-core ships a copy (`proc-state.cjs`): the fields of its
 * /proc entry, and whether it has ended and waits for its parent to collect it.
 * A program it starts goes through the caller's starter from lib/run.js.
 * Usage: const { ended } = require('./proc-state'); ended(pid, spawnSync);
 */

const fs = require('fs');

const IS_WINDOWS = process.platform === 'win32';
const HAS_PROC = !IS_WINDOWS && fs.existsSync('/proc/self/stat');

// The longest the `ps` read of one process's state may take.
const PS_DEADLINE_MS = 60000;

/**
 * The fields of /proc/<pid>/stat after the command name, which may hold spaces
 * and brackets: [state, ppid, pgrp, ...].
 * @param {number|string} pid
 * @returns {string[]|null|undefined} null once the entry is gone, undefined when it cannot be read
 */
const procStat = (pid) => {
  let text;
  try {
    text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' || err.code === 'ESRCH' ? null : undefined;
  }
  return text.slice(text.lastIndexOf(')') + 2).split(' ');
};

/**
 * Whether <pid> has ended and is not yet collected: its /proc state, else the
 * one `ps` reports; a state starting with Z is ended. Never on Windows. An entry
 * gone reads as ended, one that cannot be read as not.
 * @param {number|string} pid
 * @param {Function} spawnSync the caller's starter from lib/run.js
 * @returns {boolean}
 */
const ended = (pid, spawnSync) => {
  if (IS_WINDOWS) return false;
  if (HAS_PROC) {
    const fields = procStat(pid);
    return fields === null || (fields !== undefined && fields[0].startsWith('Z'));
  }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: PS_DEADLINE_MS,
  });
  return !ps.error && (ps.stdout ?? '').trim().startsWith('Z');
};

module.exports = { procStat, ended };
