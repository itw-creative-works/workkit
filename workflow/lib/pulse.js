/**
 * workflow/lib/pulse.js: the detached supervisor's verdict on a run, from one
 * reading per check of whether its log was written (output) and whether its
 * processes used the processor (work). Pure: no clock, no I/O.
 * Usage: const { judge } = require('./pulse');
 */

// Checks in a row with neither output nor work that make a run frozen.
const FROZEN_CHECKS = 2;

// Checks in a row with no output that ask for a look at a run still working.
const LOOK_CHECKS = 6;

// The share of one processor over a check's length that counts as work.
const WORK_FLOOR = 0.01;

// The exit code a frozen run records, and the one a call attached to a run answers a look with.
const FROZEN_CODE = 124;
const LOOK_CODE = 125;

/**
 * The verdict of one more reading. Output starts both counts again; work with
 * no output starts the still count again and adds to the quiet one; neither
 * adds to both. A still count at FROZEN_CHECKS is frozen; else a quiet count
 * at LOOK_CHECKS is a look, and that count starts again; else alive.
 * @param {{quiet: number, still: number}|undefined} state the counts so far, undefined at the first reading
 * @param {{output: boolean, work: boolean}} reading this check's reading
 * @returns {{state: {quiet: number, still: number}, verdict: ('alive'|'frozen'|'look')}}
 */
const judge = (state, { output, work }) => {
  const { quiet, still } = state ?? { quiet: 0, still: 0 };
  const next = {
    quiet: output ? 0 : quiet + 1,
    still: output || work ? 0 : still + 1,
  };
  if (next.still >= FROZEN_CHECKS) return { state: next, verdict: 'frozen' };
  if (next.quiet >= LOOK_CHECKS) return { state: { ...next, quiet: 0 }, verdict: 'look' };
  return { state: next, verdict: 'alive' };
};

module.exports = { judge, FROZEN_CHECKS, LOOK_CHECKS, WORK_FLOOR, FROZEN_CODE, LOOK_CODE };
