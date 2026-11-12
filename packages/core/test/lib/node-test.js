// The runner's second suite shape (test/run.js): a file written on
// `node:test`, told apart by its text since requiring it runs its tests, and run
// through Node's own `run()` into the result object a kit-harness suite sends.

import { run } from 'node:test';
import { indentWriter } from './log.js';
import { lexLine } from './lexer.js';

// The names whose binding runs a suite: Node's runner functions, and the
// default export, which is `test` itself.
const RUNNER_NAMES = new Set(['test', 'it', 'describe', 'suite', 'default']);
// Over the code alone (codeOf): an `import` of `node:test`, its clause (absent
// for a bare import), and a `require('node:test')` call.
const IMPORT = /\bimport\b\s*(?:([\w$\s{},*]*?)\s*\bfrom\s*)?'node:test'/g;
const REQUIRE = /\brequire\(\s*'node:test'\s*\)/g;
// A lexer span that is `node:test` in single or double quotes, no template.
const QUOTED_NODE_TEST = /^(['"])node:test\1$/;
// The object pattern a require's result is destructured into, just before it.
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*$/;
// The line Node prints for an uncaught error, `Error: msg` or `Error [CODE]: msg`.
const ERROR_LINE = /^\w*Error(?: \[[^\]]+\])?: (.+)$/;

// The source over the kit's lexer spans: every comment a space, every string,
// template or regex literal `''`, save a quoted `node:test`, kept as `'node:test'`.
const codeOf = (text) => {
  let open = '';
  return text.split('\n').map((line) => {
    const lexed = lexLine(line, open);
    open = lexed.open;
    let code = '';
    let at = 0;
    for (const { start, end, comment } of lexed.spans) {
      const span = line.slice(start, end);
      code += `${line.slice(at, start)}${comment ? ' ' : QUOTED_NODE_TEST.test(span) ? "'node:test'" : "''"}`;
      at = end;
    }
    return `${code}${line.slice(at)}`;
  }).join('\n');
};

// Whether a list of bindings, each its source name first, holds a runner name;
// a rest element holds them all.
const holdsRunner = (names) => names.some((name) => RUNNER_NAMES.has(name) || name.startsWith('...'));

// An import clause's bindings: a default or namespace binding is the runner
// itself, a named one counts by the name it imports.
const importsRunner = (clause) => {
  const named = clause.match(/\{([^}]*)\}/);
  if (/[\w$*]/.test(clause.replace(/\{[^}]*\}/, ''))) return true;
  return named !== null && holdsRunner(named[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0]));
};

/**
 * Whether a suite's source binds a `node:test` runner name: a default,
 * namespace or bare import, a `require('node:test')` not destructured, or a
 * named import or destructure holding `test`, `it`, `describe` or `suite`.
 * Comments, quoted strings, template literals (a fixture another suite
 * writes) and regex literals never count, and a backtick inside one opens none.
 * @param {string} text the suite file's source
 * @returns {boolean}
 */
export const isNodeTestSuite = (text) => {
  const code = codeOf(text);
  for (const [, clause] of code.matchAll(IMPORT)) {
    if (clause === undefined || importsRunner(clause)) return true;
  }
  for (const call of code.matchAll(REQUIRE)) {
    const pattern = code.slice(0, call.index).match(DESTRUCTURE);
    if (!pattern || holdsRunner(pattern[1].split(',').map((part) => part.split(/[:=]/)[0].trim()))) return true;
  }
  return false;
};

/**
 * Runs one `node:test` suite and resolves the kit harness's result object.
 * Its stdout and stderr are written through as they arrive, every line at
 * CASE_INDENT; a load failure is the whole-suite failure `load <rel>`.
 * @param {string} suite the suite's absolute path
 * @param {string} rel the suite's path relative to test/, its name in a failure
 * @returns {Promise<{passed: number, failed: number, failures: object[], skips: object[]}>}
 */
export const runNodeTest = (suite, rel) => new Promise((resolve, reject) => {
  const result = { passed: 0, failed: 0, failures: [], skips: [] };
  const stderrLines = [];
  const writeOut = indentWriter(process.stdout.write.bind(process.stdout));
  const writeErr = indentWriter(process.stderr.write.bind(process.stderr));
  const stream = run({ files: [suite], concurrency: 1 });
  stream.on('data', ({ type, data }) => {
    if (type === 'test:stdout') {
      writeOut(data.message);
    } else if (type === 'test:stderr') {
      writeErr(data.message);
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
