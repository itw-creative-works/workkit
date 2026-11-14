// How the runner (test/run.js) runs one suite file: through Node's own `run()`,
// its events printed as the suite's block and counted into the result object
// the worker sends.

import { run } from 'node:test';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { indentRest, indentWriter, CASE_INDENT } from './log.js';
import { PIPE_GRACE_MS } from './process.js';

// The head Node puts before an error's message, `Error: ` or `Error [CODE]: `.
const ERROR_HEAD = /^\w*Error(?: \[[^\]]+\])?: /;
// A stack frame line under it.
const FRAME_LINE = /^\s+at /;
// The line under the source line Node quotes, marking where the throw sat.
const CARET_LINE = /^\s*\^\s*$/;
// Node's last stderr line as a process dies of an uncaught error.
const TRAILER = /^Node\.js v\d+\.\d+\.\d+$/;
// Node's hint under a thrown non-error, no part of its message.
const TRACE_HINT = /^\(Use `node --trace-uncaught/;
// Node's diagnostic for an error a file raised after its test ended, the error quoted.
const LATE_ERROR = /created the error "([\s\S]*)" (?:and would have|which triggered)/;
// Between the parts of a heading and of a case's full name.
const JOINT = ' › ';
// How many of a suite's last output lines a failure line quotes.
const TAIL_LINES = 3;
// How often the worker looks for the end of the suite process run() started.
const EXIT_POLL_MS = 100;

/**
 * Why a suite ended without its result: how it ended, then the last lines it
 * wrote, so the failure line alone says where it stopped.
 * @param {string} how `exited with code 3`, `killed by SIGTERM`, ...
 * @param {string} output what the suite wrote, both streams in arrival order
 * @returns {string}
 */
export const endedMessage = (how, output) => {
  const tail = stripVTControlCharacters(output).split('\n').map((line) => line.trim()).filter(Boolean).slice(-TAIL_LINES);
  return `${how} without a result${tail.length ? `; last output: ${tail.join(' | ')}` : ''}`;
};

/**
 * How a process ended, from its exit code and signal.
 * @param {{code: number|null, signal: string|null}} ended
 * @returns {string}
 */
export const howEnded = ({ code, signal }) => (signal ? `killed by ${signal}` : `exited with code ${code}`);

// The uncaught error the suite died of: only Node's own report counts, exit
// code 1 with its `Node.js v...` trailer last on stderr. Its message is what
// Node printed under its caret (else a blank line) up to the first frame, an
// `Error: ` head stripped, any class name kept; null for any other end.
const thrownOf = (stderr, code) => {
  const lines = stderr.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  if (code !== 1 || !TRAILER.test(lines.at(-1) ?? '')) return null;
  const frame = lines.findLastIndex((line, i) => FRAME_LINE.test(line) && !FRAME_LINE.test(lines[i - 1] ?? ''));
  const end = frame === -1 ? lines.length - 1 : frame;
  const caret = lines.findLastIndex((line, i) => i < end && CARET_LINE.test(line));
  const start = caret === -1 ? lines.findLastIndex((line, i) => i < end && line === '') + 1 : caret + 1;
  const text = lines.slice(start, end).filter((line) => !TRACE_HINT.test(line)).join('\n').trim();
  return text === '' ? null : text.replace(ERROR_HEAD, '');
};

// Whether the suite process run() started still runs: its handle is the worker's one ProcessWrap.
const suiteRunning = () => process.getActiveResourcesInfo().includes('ProcessWrap');

// The first stack frame of a failure that names the suite file, an ES suite's
// file:// URL put in path form; the thrown error is the failure's cause.
const suiteFrame = (error, suite) => {
  const url = pathToFileURL(suite).href;
  const stack = String(error.cause?.stack ?? error.stack ?? '');
  const frame = stack.split('\n').map((line) => line.trim())
    .find((line) => line.startsWith('at ') && (line.includes(`${suite}:`) || line.includes(`${url}:`)));
  return frame?.replace(url, suite);
};

/**
 * Runs one suite through Node's runner, prints its block, and resolves its
 * counts. A case is headed by its describe path, `[outer › inner]`, and named
 * by it in a list. Its stdout, stderr and `t.diagnostic()` lines print as they
 * arrive, at CASE_INDENT. A file that throws before any case ran fails whole as
 * `load <rel>`, one that dies or fails otherwise as `run <rel>`, one with no
 * case as `empty <rel>`. Once the suite process exits, one PIPE_GRACE_MS ends
 * the wait for a process it started that holds its output open.
 * @param {string} suite the suite's absolute path
 * @param {string} rel the suite's path from the start folder, its name in a failure
 * @returns {Promise<{passed: number, failed: number, failures: object[], skips: object[]}>}
 */
export const runNodeTest = (suite, rel) => new Promise((resolve, reject) => {
  const result = { passed: 0, failed: 0, failures: [], skips: [] };
  // Everything the block printed, and the suite's stderr alone.
  const printed = [];
  let stderrText = '';
  const out = process.stdout.write.bind(process.stdout);
  const write = (text) => {
    printed.push(text);
    return out(text);
  };
  const writeOut = indentWriter(write);
  const writeErr = indentWriter((text, ...rest) => {
    printed.push(text);
    return process.stderr.write(text, ...rest);
  });
  const wholeFailure = (name, message) => {
    result.failed++;
    result.failures.push({ name, message, whole: true });
  };
  // The tests started at each depth down to the latest, outermost first: a
  // test's describe path is the part above its own depth.
  const open = [];
  const pathOf = (data) => open.slice(0, data.nesting);
  const fullName = (data) => [...pathOf(data).map((node) => node.name), data.name].join(JOINT);
  // Whether a case or describe has started, whether one was named at all,
  // whether the suite process has been heard from and has sent its own
  // summary, and a late error's message.
  let started = false;
  let registered = false;
  let heard = false;
  let summarized = false;
  let late = null;
  let done = false;
  // The test the last mark line sat under: null for none, undefined before the first.
  let lastParent;
  // One mark line. A case under another describe than the line before it gets
  // that describe path's heading first; a case under none after a headed one
  // gets a blank line.
  const mark = (data, text) => {
    const parent = open[data.nesting - 1] ?? null;
    if (parent !== lastParent) {
      if (parent) write(`\n\x1b[1m[${pathOf(data).map((node) => node.name).join(JOINT)}]\x1b[0m\n`);
      else if (lastParent !== undefined) write('\n');
      lastParent = parent;
    }
    write(`  ${text}\n`);
  };
  const skipCase = (data, reason) => {
    result.skips.push({ name: fullName(data), reason });
    mark(data, `\x1b[33m⊘\x1b[0m ${data.name}: \x1b[33m${indentRest(reason)}\x1b[0m`);
  };
  // The result as counted. A suite that named a case and never sent its summary
  // died, with code 0 when no failure of the file came; cut short, the file's
  // own failure never came, so a late error is its failure.
  const finish = (cutShort) => {
    if (done) return;
    done = true;
    clearInterval(watch);
    const failedWhole = result.failures.some((failure) => failure.whole);
    if (cutShort && late !== null) wholeFailure(`run ${rel}`, late);
    else if (cutShort && !summarized) wholeFailure(`run ${rel}`, endedMessage('exited, its output held open by a process it started,', printed.join('')));
    else if (!summarized && registered && !failedWhole) wholeFailure(`run ${rel}`, endedMessage('exited with code 0', printed.join('')));
    // A file in which no case ran proves nothing, so it is no pass.
    if (result.passed + result.failed + result.skips.length === 0) wholeFailure(`empty ${rel}`, 'registered no test');
    resolve(result);
  };
  // A process the suite started may hold the suite's stdout open after the
  // suite exits, and run() waits for it to close.
  const watch = setInterval(() => {
    if (suiteRunning()) heard = true;
    else if (heard) {
      clearInterval(watch);
      setTimeout(() => finish(true), PIPE_GRACE_MS);
    }
  }, EXIT_POLL_MS);
  const stream = run({ files: [suite], concurrency: 1 });
  stream.on('data', ({ type, data }) => {
    if (done) return;
    if (data.name !== suite && type !== 'test:enqueue' && type !== 'test:dequeue') heard = true;
    if (data.name !== undefined && data.name !== suite) registered = true;
    if (type === 'test:stdout') {
      writeOut(data.message);
    } else if (type === 'test:stderr') {
      writeErr(data.message);
      stderrText += data.message;
    } else if (type === 'test:summary') {
      if (data.file === suite) summarized = true;
    } else if (type === 'test:diagnostic') {
      // Node's own totals for the run carry no file, so they never print.
      if (data.file === undefined) return;
      write(`${CASE_INDENT}${indentRest(data.message)}\n`);
      const quoted = data.message.match(LATE_ERROR);
      if (quoted) late = quoted[1].replace(ERROR_HEAD, '');
    } else if (data.name === suite) {
      // The file's own test is no case: Node reports a file holding none as
      // one that passed. Its failure is the file failing whole.
      if (type !== 'test:fail') return;
      // That event says only `test failed`: a late error's message is in Node's
      // diagnostic, an uncaught one's in Node's report on stderr, else how it ended.
      const { error } = data.details;
      const thrown = thrownOf(stderrText, error.exitCode);
      const ended = error.exitCode === undefined ? error.message : endedMessage(howEnded({ code: error.exitCode, signal: error.signal }), printed.join(''));
      wholeFailure(`${started || thrown === null ? 'run' : 'load'} ${rel}`, late ?? thrown ?? ended);
    } else if (type === 'test:start') {
      started = true;
      open.length = data.nesting;
      open.push({ name: data.name });
    } else if (data.todo && (type === 'test:pass' || type === 'test:fail')) {
      // A todo test may throw; Node never counts it as a failure. A todo
      // describe counts nothing, a body that throws included.
      if (data.details.type === 'test') skipCase(data, data.todo === true ? 'todo' : data.todo);
    } else if (type === 'test:pass' && data.skip) {
      // A skipped describe emits nothing for its tests, so its own skip is
      // their one trace.
      skipCase(data, data.skip === true ? 'skipped' : data.skip);
    } else if (type === 'test:pass' && data.details.type === 'test') {
      result.passed++;
      mark(data, `\x1b[32m✓\x1b[0m ${data.name}`);
    } else if (type === 'test:fail' && data.details.error.failureType !== 'subtestsFailed') {
      // A test or describe whose only failure is a failed subtest is counted
      // there; it fails on its own only when its body or a hook threw.
      // A hook's failure says only which hook; why is the thrown error's own message.
      const { error } = data.details;
      const why = typeof error.cause?.message === 'string' && error.cause.message !== error.message ? error.cause.message : null;
      result.failed++;
      result.failures.push({ name: fullName(data), message: why === null ? error.message : `${error.message}: ${why}` });
      mark(data, `\x1b[31m✗\x1b[0m ${data.name}`);
      for (const text of why === null ? [error.message] : [error.message, why]) {
        write(`${CASE_INDENT}\x1b[31m${indentRest(String(text).trimEnd())}\x1b[0m\n`);
      }
      const frame = suiteFrame(error, suite);
      if (frame) write(`${CASE_INDENT}\x1b[2m${frame}\x1b[0m\n`);
    }
  });
  stream.on('error', reject);
  stream.on('end', () => finish(false));
});
