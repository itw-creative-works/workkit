// A kit run's output as the suites read it: its lines with the colours stripped,
// the case marks, the totals line, and the failure and skip lists below it.
// failureLinesOf alone takes lines and keeps their colours.

const { stripVTControlCharacters } = require('util');

const TOTALS_LINE = /^\d+ passed, \d+ failed/;

const linesOf = (output) => stripVTControlCharacters(output).split(/\r?\n/);

// The lines below the run's own totals line, the one totalsOf reads; the whole output when it holds none.
const listsOf = (output) => {
  const lines = linesOf(output);
  return lines.slice(lines.findLastIndex((line) => TOTALS_LINE.test(line)) + 1);
};

// The case marks a run printed, trimmed: `✓ alpha`, `✗ beta`, `⊘ beta: why`.
const marksOf = (output) => linesOf(output).map((line) => line.trim()).filter((line) => /^[✓✗⊘] /.test(line));

// The run's own totals line: the last one, since each workspace member's run
// prints its own above it. '' when the run printed none.
const totalsOf = (output) => linesOf(output).findLast((line) => TOTALS_LINE.test(line)) || '';

// The text below `Failures:`, or '' when the run printed no failure list.
const failuresOf = (output) => linesOf(output).join('\n').split('Failures:')[1] || '';

// The given lines after the `Failures:` heading, their colours kept; all of them when no line is that heading.
const failureLinesOf = (lines) => lines.slice(lines.findIndex((line) => stripVTControlCharacters(line) === 'Failures:') + 1);

module.exports = {
  TOTALS_LINE, linesOf, listsOf, marksOf, totalsOf, failuresOf, failureLinesOf,
};
