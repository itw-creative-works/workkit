// Tests for workflow/lib/pulse.js, the verdict on a run from its readings: output
// or work is alive, two quiet checks in a row are frozen, and six checks of work
// with no output ask for a look.

const path = require('path');
const {
  describe, test, expect,
} = require('../lib/harness');

const { judge } = require(path.join(__dirname, '..', '..', 'workflow', 'lib', 'pulse.js'));

const QUIET = { output: false, work: false };
const WORK = { output: false, work: true };
const OUTPUT = { output: true, work: false };
const BOTH = { output: true, work: true };

/** The verdict of each reading in turn, each call handed the state the one before it left. */
const verdicts = (readings) => {
  let state;
  return readings.map((reading) => {
    const out = judge(state, reading);
    ({ state } = out);
    return out.verdict;
  });
};

const times = (n, reading) => new Array(n).fill(reading);
const alive = (n) => times(n, 'alive').join(', ');

describe('pulse: alive', () => {
  test('output or work: alive, and a quiet reading after it counts from one again', () => {
    for (const [name, reading] of [['output', OUTPUT], ['work', WORK], ['both', BOTH]]) {
      expect(verdicts([QUIET, reading, QUIET]).join(', '), `quiet, ${name}, quiet`).toBe(alive(3));
    }
  });

  test('output starts the look count again: five checks of work, output, five more are all alive', () => {
    expect(verdicts([...times(5, WORK), OUTPUT, ...times(5, WORK)]).join(', '), 'eleven verdicts').toBe(alive(11));
  });
});

describe('pulse: frozen', () => {
  test('two quiet readings in a row: frozen; one, then work: alive', () => {
    expect(verdicts([QUIET, QUIET]).join(', '), 'quiet, quiet').toBe('alive, frozen');
    expect(verdicts([QUIET, WORK]).join(', '), 'quiet, work').toBe('alive, alive');
  });
});

describe('pulse: look', () => {
  test('six readings of work with no output: look, then the count starts again; five: alive', () => {
    expect(verdicts(times(12, WORK)).join(', '), 'twelve readings of work').toBe(`${alive(5)}, look, ${alive(5)}, look`);
  });
});
