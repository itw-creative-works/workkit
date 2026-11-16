/**
 * Whether a process, or every member of a group, has ended and waits for its
 * parent to collect it, which still answers signal 0. Asked only once signal 0
 * answered; a state that cannot be read leaves that answer standing.
 */

import fs from 'node:fs';
import { SPAWN_DEADLINE } from './process.js';
import { kitModule } from './kit-module.js';

const { spawnSync } = kitModule('run');
const IS_WINDOWS = process.platform === 'win32';
const HAS_PROC = !IS_WINDOWS && fs.existsSync('/proc/self/stat');

// The fields of /proc/<pid>/stat after the command name, which may hold spaces
// and brackets: [state, ppid, pgrp, ...]. null once the entry is gone, undefined when unreadable.
const statOf = (pid) => {
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
 * one `ps` reports; a state starting with Z is ended. Never on Windows.
 * @param {number} pid
 * @returns {boolean}
 */
export const ended = (pid) => {
  if (IS_WINDOWS) return false;
  if (HAS_PROC) {
    const fields = statOf(pid);
    return fields === null || fields?.[0] === 'Z';
  }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SPAWN_DEADLINE });
  return !ps.error && ps.stdout.trim().startsWith('Z');
};

/**
 * Whether every member of the group <pgid> leads has ended and is not yet
 * collected, by the /proc entries: true only when a member was seen and every
 * member seen was in state Z. Without /proc, false; macOS refuses a group of
 * such members signal 0 (EPERM) itself.
 * @param {number} pgid
 * @returns {boolean}
 */
export const groupEnded = (pgid) => {
  if (!HAS_PROC) return false;
  let names;
  try {
    names = fs.readdirSync('/proc');
  } catch {
    return false;
  }
  const group = String(pgid);
  let seen = false;
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const fields = statOf(name);
    // An entry that cannot be read may be a living member, so it keeps the group.
    if (fields === undefined) return false;
    if (fields?.[2] !== group) continue;
    if (fields[0] !== 'Z') return false;
    seen = true;
  }
  return seen;
};
