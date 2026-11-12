// Tests for isNodeTestSuite in packages/core/test/lib/node-test.js: the shape check
// the runner reads from a suite's text before loading it, over known source
// texts that do and do not import a node:test runner name.

const {
  group, test, assertEq, summary, selfRun,
} = require('./lib/harness');
const { isNodeTestSuite } = require('../packages/core/test/lib/node-test');

const cases = async () => {
  group('isNodeTestSuite: a real import reads true');

  await test('a one-line CJS require', () => {
    assertEq(isNodeTestSuite("const { test } = require('node:test');\n"), true);
  });

  await test('a require on the closing line of a multi-line destructure', () => {
    assertEq(isNodeTestSuite("const {\n  describe,\n  test,\n} = require('node:test');\n"), true);
  });

  await test('a named ESM import', () => {
    assertEq(isNodeTestSuite("import { describe, test } from 'node:test';\n"), true);
  });

  await test('a default ESM import', () => {
    assertEq(isNodeTestSuite("import test from 'node:test';\n"), true);
  });

  await test('a multi-line ESM import', () => {
    assertEq(isNodeTestSuite("import {\n  describe,\n  test,\n} from 'node:test';\n"), true);
  });

  await test('a quoted string holding a backtick on a line before a real import', () => {
    assertEq(isNodeTestSuite("const tick = '`';\nconst { test } = require('node:test');\n"), true);
  });

  await test('a regex literal holding a backtick on a line before a real require', () => {
    assertEq(isNodeTestSuite("const re = /[`]/;\nconst { test } = require('node:test');\n"), true);
  });

  await test('a regex literal holding a comment opener on a line before a real import', () => {
    assertEq(isNodeTestSuite("const re = /[/*]/;\nimport { test } from 'node:test';\n"), true);
  });

  group('isNodeTestSuite: a mention that is not an import reads false');

  await test('a require inside a comment line', () => {
    assertEq(isNodeTestSuite("// const { test } = require('node:test');\nconst value = 1;\n"), false);
  });

  await test('a require inside a template literal', () => {
    assertEq(isNodeTestSuite("const src = `\nconst { test } = require('node:test');\n`;\n"), false);
  });

  await test('a require inside a quoted string', () => {
    assertEq(isNodeTestSuite("const src = \"const { test } = require('node:test');\";\n"), false);
  });

  await test('a bare, namespace or multi-line import inside a comment, a quoted string or a template literal', () => {
    const texts = [
      "// import 'node:test';\nconst value = 1;\n",
      "/* import * as nt from 'node:test'; */\nconst value = 1;\n",
      "const src = \"import * as nt from 'node:test';\";\n",
      "const src = `\nimport {\n  test,\n} from 'node:test';\n`;\n",
      "const src = `import 'node:test';`;\n",
    ];
    assertEq(texts.filter((text) => isNodeTestSuite(text)).join('\n---\n'), '', 'texts read as a node:test suite');
  });

  group('isNodeTestSuite: a runner name reads true, a helper alone reads false');

  await test('every import holding a runner name, or binding the module whole, reads true', () => {
    const texts = [
      "import { mock, test } from 'node:test';\n",
      "import { test as t } from 'node:test';\n",
      "import * as nt from 'node:test';\n",
      "import 'node:test';\n",
      "const nt = require('node:test');\n",
      "const { describe: d } = require('node:test');\n",
    ];
    assertEq(texts.filter((text) => !isNodeTestSuite(text)).join('\n---\n'), '', 'texts not read as a node:test suite');
  });

  await test('a kit-harness suite importing only mock from node:test, by import or require, reads false', () => {
    const texts = [
      "import { mock } from 'node:test';\n",
      "const { mock } = require('node:test');\nconst { test, summary } = require('./lib/harness');\n",
    ];
    assertEq(texts.filter((text) => isNodeTestSuite(text)).join('\n---\n'), '', 'texts read as a node:test suite');
  });

  await test('a helper-only import written over several lines reads false', () => {
    const texts = [
      "import {\n  mock,\n  before,\n  snapshot,\n} from 'node:test';\n",
      "const {\n  mock,\n  before,\n} = require('node:test');\n",
    ];
    assertEq(texts.filter((text) => isNodeTestSuite(text)).join('\n---\n'), '', 'texts read as a node:test suite');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
