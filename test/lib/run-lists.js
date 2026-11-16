// A kit run's output as the suites read it: its lines with the colours stripped,
// the case marks, the totals line, and the failure and skip lists below it.

const { stripVTControlCharacters } = require('util');

const TOTALS_LINE = /^\d+ passed, \d+ failed/;

const linesOf = (output) => stripVTControlCharacters(output).split(/\r?\n/);

// The lines below the totals line; the whole output when it holds none.
const listsOf = (output) => {
  const lines = linesOf(output);
  return lines.slice(lines.findIndex((line) => TOTALS_LINE.test(line)) + 1);
};

// The case marks a run printed, trimmed: `✓ alpha`, `✗ beta`, `⊘ beta: why`.
const marksOf = (output) => linesOf(output).map((line) => line.trim()).filter((line) => /^[✓✗⊘] /.test(line));

// The totals line, or '' when the run printed none.
const totalsOf = (output) => linesOf(output).find((line) => TOTALS_LINE.test(line)) || '';

// The text below `Failures:`, or '' when the run printed no failure list.
const failuresOf = (output) => linesOf(output).join('\n').split('Failures:')[1] || '';

module.exports = {
  TOTALS_LINE, linesOf, listsOf, marksOf, totalsOf, failuresOf,
};
