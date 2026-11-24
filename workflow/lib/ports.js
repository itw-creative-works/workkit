/**
 * workflow/lib/ports.js: the processes listening on a TCP port, and the end of
 * one of them. `lsof` off Windows, `netstat -ano` on it, read here in Node.
 * Neither tool: no process, so the port reads free.
 * Usage: const { portPids, endPid } = require('../lib/ports');
 */

const { spawnSync } = require('./run');

const PLATFORM = process.platform;

/** `lsof -t`'s lines, one pid each, as numbers; each once. */
const lsofPids = (stdout) => [...new Set(stdout.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line)).map(Number))];

/**
 * The pids of the `LISTENING` TCP rows whose local address ends in `:<port>`,
 * on either stack (`:18693` is not 8693), each once.
 */
const netstatPids = (stdout, port) => {
  const suffix = `:${port}`;
  const pids = stdout.split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([proto, local, , state, pid]) => proto === 'TCP' && state === 'LISTENING' && local.endsWith(suffix) && /^\d+$/.test(pid ?? ''))
    .map(([, , , , pid]) => Number(pid));
  return [...new Set(pids)];
};

/**
 * The ids of the processes listening on a TCP port. `lsof -b` skips stat() on
 * every mount, which a stalled network share blocks 15s a call.
 * @param {number|string} port
 * @param {{platform?: string}} [context] the platform the lookup is for
 * @returns {number[]} each id once; empty when the port is free or neither tool is there
 */
const portPids = (port, { platform = PLATFORM } = {}) => {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
  if (platform === 'win32') return netstatPids(spawnSync('netstat', ['-ano'], options).stdout ?? '', port);
  return lsofPids(spawnSync('lsof', ['-bti', `tcp:${port}`, '-sTCP:LISTEN'], options).stdout ?? '');
};

/**
 * Ends one process portPids answered with. On Windows the id is a Windows id
 * and Node's end of it is forceful whatever the signal: Windows has no polite
 * end for a windowless process.
 * @param {number} pid
 * @param {string} [signal]
 * @returns {void} a process already gone is passed over; any other refusal throws
 */
const endPid = (pid, signal = 'SIGTERM') => {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
};

module.exports = { portPids, endPid };
