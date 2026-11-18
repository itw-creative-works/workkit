/**
 * Whether a process, or every member of a group, has ended and waits for its
 * parent to collect it, which still answers signal 0. Asked only once signal 0
 * answered; a state that cannot be read leaves that answer standing. The reads
 * are the kit's `workflow/lib/proc-state.js`.
 */

import fs from 'node:fs';
import { kitModule } from './kit-module.js';

const { spawnSync } = kitModule('run');
const kit = kitModule('proc-state');
const HAS_PROC = process.platform !== 'win32' && fs.existsSync('/proc/self/stat');

/**
 * Whether <pid> has ended and is not yet collected (the kit's `ended`). Never on Windows.
 * @param {number} pid
 * @returns {boolean}
 */
export const ended = (pid) => kit.ended(pid, spawnSync);

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
    const fields = kit.procStat(name);
    // An entry that cannot be read may be a living member, so it keeps the group.
    if (fields === undefined) return false;
    if (fields?.[2] !== group) continue;
    if (fields[0] !== 'Z') return false;
    seen = true;
  }
  return seen;
};
