// The suite deadline a run holds, for the runner (test/run.js) and `modCase`
// (lib/mods.js): `SUITE_DEADLINE`, or the seconds `TEST_DEADLINE` names.
// The door does not re-export it.

import { SUITE_DEADLINE } from './process.js';

// The most seconds TEST_DEADLINE may name: node's timers hold 2^31 - 1 ms at most.
const MAX_DEADLINE_SECONDS = 2147483;

/**
 * The per-file deadline in ms this process's `TEST_DEADLINE` sets, else
 * `SUITE_DEADLINE`; a value that is no positive number, or more than a timer
 * holds, is no deadline but the line it stops a run with.
 * @returns {{deadline: number|null, error: string|null}}
 */
export const suiteDeadline = () => {
  const raw = process.env.TEST_DEADLINE;
  if (raw === undefined) return { deadline: SUITE_DEADLINE, error: null };
  const seconds = Number(raw);
  if (!(seconds > 0) || seconds > MAX_DEADLINE_SECONDS) {
    return { deadline: null, error: `TEST_DEADLINE must be a positive number of seconds, got ${raw}` };
  }
  return { deadline: seconds * 1000, error: null };
};
