// Tests for isNodeTestSuite in workflow/test/lib/node-test.js: the shape check
// the runner reads from a suite's text before loading it, over known source
// texts that do and do not import node:test.

const {
  group, test, assertEq, summary, selfRun,
} = require('./lib/harness');
const { isNodeTestSuite } = require('../workflow/test/lib/node-test');

const run = async () => {
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
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
