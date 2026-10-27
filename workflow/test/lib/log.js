/* eslint-disable no-console */
// A case's own log: lines a case writes as it runs, held in the one slot the
// running case owns, which the harness drains as the case ends and prints under
// a failure (and under a pass with TEST_LOG=1). A line written with no case
// running prints at once, indented as a case's lines are.

const util = require('util');

// The indent of every line the harness prints under a case's mark.
const CASE_INDENT = '    ';

// The running case's lines, null while no case runs.
let current = null;

/** Log one line: the parts joined by spaces, a non-string inspected as console.log shows it. */
const log = (...parts) => {
  const line = parts.map((part) => (typeof part === 'string' ? part : util.inspect(part))).join(' ');
  if (current) current.push(line);
  else console.log(`${CASE_INDENT}${line}`);
};

/** Open the slot of a case starting to run. */
const openCase = () => {
  current = [];
};

/** The running case's lines, in the order written; the slot is closed after. */
const drain = () => {
  const lines = current ?? [];
  current = null;
  return lines;
};

module.exports = { log, openCase, drain, CASE_INDENT };
