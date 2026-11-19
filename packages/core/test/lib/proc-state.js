/**
 * Whether a process, or every member of a group, has ended and waits for its
 * parent to collect it, which still answers signal 0, and a group's members.
 * Asked only once signal 0 answered; a state that cannot be read leaves that
 * answer standing. The reads are the kit's `workflow/lib/proc-state.js`.
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
 * The /proc scan of the group <pgid> leads: each member seen with its state
 * letter, and whether an entry could not be read. Null without /proc, or when
 * /proc cannot be listed.
 * @param {number} pgid
 * @returns {{ members: { pid: number, state: string }[], unreadable: boolean }|null}
 */
const scanGroup = (pgid) => {
  if (!HAS_PROC) return null;
  let names;
  try {
    names = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  const group = String(pgid);
  const members = [];
  let unreadable = false;
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const fields = kit.procStat(name);
    if (fields === undefined) unreadable = true;
    else if (fields?.[2] === group) members.push({ pid: Number(name), state: fields[0] });
  }
  return { members, unreadable };
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
  const scan = scanGroup(pgid);
  // An entry that cannot be read may be a living member, so it keeps the group.
  if (!scan || scan.unreadable) return false;
  return scan.members.length > 0 && scan.members.every((member) => member.state === 'Z');
};

/**
 * Each member of the group <pgid> leads that /proc shows, with its stat state
 * letter: `[{ pid, state }]`. Empty without /proc.
 * @param {number} pgid
 * @returns {{ pid: number, state: string }[]}
 */
export const groupMembers = (pgid) => scanGroup(pgid)?.members ?? [];

/**
 * The error text of a target still alive after SIGKILL: `<who>: pid <N> survived
 * SIGKILL`, then `; still in its group: <pid> (<state>), ...` naming each member given.
 * @param {string} who
 * @param {number} pid
 * @param {{ pid: number, state: string }[]} members - the group's members seen, `groupMembers`'s answer
 * @returns {string}
 */
export const survivedText = (who, pid, members) => {
  const text = `${who}: pid ${pid} survived SIGKILL`;
  if (members.length === 0) return text;
  return `${text}; still in its group: ${members.map((member) => `${member.pid} (${member.state})`).join(', ')}`;
};
