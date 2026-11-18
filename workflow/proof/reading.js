/**
 * workflow/proof/reading.js: how `workkit proof red` reads a run, CJS: the test
 * summary (the kit runner's summary file, else node's own summary blocks in the
 * output) and the modules node could not load. Pure but for the file read.
 * Usage: const { summaryOf, loadFailures } = require('./reading');
 */

const fs = require('fs');

// Node's summary block: these eight lines in this order, `fail` and `cancelled` the failed count.
const BLOCK = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];
const FAIL_AT = BLOCK.indexOf('fail');
const CANCELLED_AT = BLOCK.indexOf('cancelled');

// A block line: at column zero under one prefix, `# ` under tap or `ℹ ` under spec.
const BLOCK_LINE = /^(# |ℹ )([a-z_]+) ([0-9]+(?:\.[0-9]+)?)$/;

// Node's one signal for a module it could not load, MODULE_NOT_FOUND and ERR_MODULE_NOT_FOUND alike.
const NOT_FOUND = /Cannot find (?:module|package) '/;
const IMPORTED_FROM = ' imported from ';

/** A text's lines as a line reader sees them, each CR end dropped. */
const linesOf = (text) => {
  const lines = String(text ?? '').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.replace(/\r$/, ''));
};

/**
 * Node's whole summary blocks in one stream summed: a block's eight lines in
 * order under one prefix, any line breaking the order starting the search again.
 */
const blocksIn = (text, sum) => {
  let at = 0;
  let prefix = '';
  let tests = 0;
  let failed = 0;
  for (const line of linesOf(text)) {
    const m = BLOCK_LINE.exec(line);
    if (at > 0 && (!m || m[1] !== prefix || m[2] !== BLOCK[at])) at = 0;
    if (!m || m[2] !== BLOCK[at]) continue;
    const n = Number(m[3]);
    if (at === 0) [prefix, tests] = [m[1], n];
    if (at === FAIL_AT) failed = n;
    if (at === CANCELLED_AT) failed += n;
    at += 1;
    if (at < BLOCK.length) continue;
    sum.tests += tests;
    sum.failed += failed;
    sum.seen = true;
    at = 0;
  }
};

/** The summary file's lines summed, a test being a pass or a failure; throws on a line that is not `{"passed":n,"failed":n}`. */
const fileSum = (text) => {
  const sum = { tests: 0, failed: 0 };
  for (const line of String(text).split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)) {
    const counts = JSON.parse(line);
    const keys = counts && typeof counts === 'object' && !Array.isArray(counts) ? Object.keys(counts).sort().join(',') : '';
    if (keys !== 'failed,passed' || typeof counts.passed !== 'number' || typeof counts.failed !== 'number') {
      throw new Error(`not a summary line: ${line}`);
    }
    sum.tests += counts.passed + counts.failed;
    sum.failed += counts.failed;
  }
  return sum;
};

/**
 * The run's test summary. The summary file decides when it holds anything, each
 * line exactly `{"passed":n,"failed":n}`, summed; else node's whole summary
 * blocks in the output, summed over stdout then stderr.
 * @param {{out: string, err: string, file: string}} run the command's stdout and stderr, and the summary file's path
 * @returns {{tests: number, failed: number}|null} null when the run left neither
 * @throws {Error} the summary file holds a line that is not the counts
 */
const summaryOf = ({ out, err, file }) => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // No file is no summary line: the output decides.
  }
  if (text.length > 0) {
    try {
      return fileSum(text);
    } catch {
      throw new Error('the test summary cannot be read');
    }
  }
  const sum = { tests: 0, failed: 0, seen: false };
  blocksIn(out, sum);
  blocksIn(err, sum);
  return sum.seen ? { tests: sum.tests, failed: sum.failed } : null;
};

/**
 * Each module node could not load, in the order the output names them,
 * stdout then stderr: its specifier, and the requiring file node names (`from`,
 * after `imported from`, else the first line of its require stack; empty for none).
 * @param {{out: string, err: string}} run the command's stdout and stderr
 * @returns {Array<{spec: string, from: string}>}
 */
const loadFailures = ({ out, err }) => {
  const found = [];
  let pending = null;
  let stack = false;
  for (const raw of [...linesOf(out), ...linesOf(err)]) {
    const line = raw.replace(/^[#\s]+/, '');
    const m = NOT_FOUND.exec(line);
    if (m) {
      if (pending !== null) found.push({ spec: pending, from: '' });
      pending = null;
      stack = false;
      const rest = line.slice(m.index + m[0].length);
      const close = rest.indexOf("'");
      if (close < 0) continue;
      const spec = rest.slice(0, close);
      const after = rest.slice(close + 1);
      if (after.startsWith(IMPORTED_FROM)) found.push({ spec, from: after.slice(IMPORTED_FROM.length) });
      else pending = spec;
    } else if (pending !== null && line.startsWith('Require stack:')) {
      stack = true;
    } else if (pending !== null && stack && line.startsWith('- ')) {
      found.push({ spec: pending, from: line.slice(2) });
      pending = null;
    }
  }
  if (pending !== null) found.push({ spec: pending, from: '' });
  return found;
};

module.exports = { summaryOf, loadFailures };
