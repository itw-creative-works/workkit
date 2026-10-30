// The runner's second suite shape (test/run.js): a file written on
// `node:test`, told apart by its text since requiring it runs its tests, and run
// through Node's own `run()` into the result object a kit-harness suite sends.

import { run } from 'node:test';

// Met outside any quote: a `require('node:test')` call, or the specifier of an
// `import ... from` or bare `import` naming it.
const IMPORT_AT = /\brequire\(\s*(['"])node:test\1\s*\)|\b(?:from|import)\s*(['"])node:test\2/y;
const COMMENT = /^(?:\/\/|\/\*|\*)/;
// The line Node prints for an uncaught error, `Error: msg` or `Error [CODE]: msg`.
const ERROR_LINE = /^\w*Error(?: \[[^\]]+\])?: (.+)$/;

/**
 * Whether a suite's source imports `node:test`. Comment lines, quoted strings
 * and template literals (a fixture another suite writes) never count; only a
 * template literal runs past its line, and a backtick inside a quote opens none.
 * @param {string} text the suite file's source
 * @returns {boolean}
 */
export const isNodeTestSuite = (text) => {
  let quote = '';
  for (const line of text.split('\n')) {
    if (!quote && COMMENT.test(line.trim())) continue;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\') {
        i++;
      } else if (quote) {
        if (c === quote) quote = '';
      } else if (c === '/' && line[i + 1] === '/') {
        break;
      } else if (c === "'" || c === '"' || c === '`') {
        quote = c;
      } else {
        IMPORT_AT.lastIndex = i;
        if (IMPORT_AT.test(line)) return true;
      }
    }
    if (quote !== '`') quote = '';
  }
  return false;
};

/**
 * Runs one `node:test` suite and resolves the kit harness's result object.
 * Its stdout and stderr are written through as they arrive; a load failure is
 * the whole-suite failure `load <rel>`.
 * @param {string} suite the suite's absolute path
 * @param {string} rel the suite's path relative to test/, its name in a failure
 * @returns {Promise<{passed: number, failed: number, failures: object[], skips: object[]}>}
 */
export const runNodeTest = (suite, rel) => new Promise((resolve, reject) => {
  const result = { passed: 0, failed: 0, failures: [], skips: [] };
  const stderrLines = [];
  const stream = run({ files: [suite], concurrency: 1 });
  stream.on('data', ({ type, data }) => {
    if (type === 'test:stdout') {
      process.stdout.write(data.message);
    } else if (type === 'test:stderr') {
      process.stderr.write(data.message);
      stderrLines.push(data.message.trimEnd());
    } else if (type === 'test:fail' && data.name === suite) {
      // A load failure's event says only `test failed`; the thrown error's
      // message is in the child's stderr, the last line Node printed for it.
      const thrown = stderrLines.map((line) => line.match(ERROR_LINE)).filter(Boolean).pop();
      result.failed++;
      result.failures.push({ name: `load ${rel}`, message: thrown ? thrown[1] : data.details.error.message, whole: true });
    } else if (data.todo && (type === 'test:pass' || type === 'test:fail')) {
      // A todo test may throw; Node never counts it as a failure. A todo
      // describe counts nothing, a body that throws included.
      if (data.details.type === 'test') result.skips.push({ name: data.name, reason: 'todo' });
    } else if (type === 'test:pass' && data.skip) {
      // A skipped describe emits nothing for its tests, so its own skip is
      // their one trace.
      result.skips.push({ name: data.name, reason: data.skip === true ? 'skipped' : data.skip });
    } else if (type === 'test:pass' && data.details.type === 'test') {
      result.passed++;
    } else if (type === 'test:fail' && (data.details.type === 'test' || data.details.error.failureType !== 'subtestsFailed')) {
      // A suite fails on its own only when its body or a hook threw; a failed
      // test inside it is already counted.
      result.failed++;
      result.failures.push({ name: data.name, message: data.details.error.message });
    }
  });
  stream.on('error', reject);
  stream.on('end', () => resolve(result));
});
