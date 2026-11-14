// The end of a kit run's output as the suites read it: its lines with the colours
// stripped, the totals line, and the failure and skip lists printed below it.

const { stripVTControlCharacters } = require('util');

const TOTALS_LINE = /^\d+ passed, \d+ failed/;

const linesOf = (output) => stripVTControlCharacters(output).split(/\r?\n/);

// The lines below the totals line; the whole output when it holds none.
const listsOf = (output) => {
  const lines = linesOf(output);
  return lines.slice(lines.findIndex((line) => TOTALS_LINE.test(line)) + 1);
};

module.exports = { TOTALS_LINE, linesOf, listsOf };
