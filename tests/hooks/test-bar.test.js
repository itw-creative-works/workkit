// Tests for safety:test-bar's logic, testBarContext(facts) in
// hooks/mods/test-bar.js: the line it adds for each mechanical miss of the
// test bar in a written test file. The wiring cases (the chain, the opt-in,
// the session's repo) are tests/mods/post-tool-use.test.ts.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

// The hook's answer for `lines` written at `rel`, as one text.
const write = (rel, lines) => textOf(mods('test-bar').testBarContext({ root: '/w/repo', rel, text: `${lines.join('\n')}\n` }));

// The context holds a `test-bar: <rel>:<line> ...` line naming `rule`; `line`
// is one number, or undefined where the Contract names no line.
const names = (out, rel, line, rule) => {
  const head = line === undefined ? `test-bar: ${rel}:` : `test-bar: ${rel}:${line} `;
  const word = new RegExp(`(^|[^\\w-])${rule}([^\\w-]|$)`);
  const hit = out.split('\n').some((l) => l.startsWith(head) && word.test(l.slice(head.length)));
  assert(hit, `names ${rel}${line === undefined ? '' : `:${line}`} and the ${rule} rule, got: ${out}`);
};

const run = async () => {
  group('test-bar: each mechanical miss names its line and rule');

  await test('fs.mkdtempSync outside tests/lib/scratch.js: the mkTmp rule', () => {
    const rel = 'tests/thing.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const { test, assertEq } = require('./lib/harness');",
      "const dir = fs.mkdtempSync('thing-');",
      "test('reads it', () => assertEq(fs.readdirSync(dir).length, 0, 'empty'));",
    ]);
    names(out, rel, 3, 'mkTmp');
  });

  await test('tests/lib/scratch.js itself, the one writer of a scratch folder: nothing added', () => {
    assertEq(write('tests/lib/scratch.js', [
      "const fs = require('fs');",
      "const os = require('os');",
      "const path = require('path');",
      "const mkTmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));",
      'module.exports = { mkTmp };',
    ]), '', 'the mkTmp rule exempts its own home');
  });

  await test('a literal /tmp/ path and a literal port: the serial rule on each line', () => {
    const rel = 'tests/server.test.js';
    const out = write(rel, [
      "const { test, assertEq } = require('./lib/harness');",
      "const LOG = '/tmp/server-test.log';",
      "const { get } = require('./lib/client');",
      "const URL = 'http://localhost:8080/health';",
      "test('answers', async () => assertEq((await get(URL, LOG)).status, 200, 'ok'));",
    ]);
    names(out, rel, 2, 'serial');
    names(out, rel, 4, 'serial');
  });

  await test('a case whose only assertion is existsSync: the worth rule', () => {
    const rel = 'tests/install.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const { test } = require('./lib/harness');",
      "test('the script is there', () => { assert.ok(fs.existsSync('scripts/run.sh')); });",
    ]);
    names(out, rel, 4, 'worth');
  });

  await test('a testUnless(...)(...) case whose only assertion is existsSync: named on its own line, not its neighbour', () => {
    const rel = 'tests/skip.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const { test, testUnless } = require('./lib/harness');",
      "test('the real one', () => { assert.strictEqual(1 + 1, 2); });",
      "testUnless(process.platform === 'win32', 'no pids')('the file is there', () => { assert.ok(fs.existsSync('scripts/run.sh')); });",
    ]);
    names(out, rel, 5, 'worth');
    assert(!out.split('\n').some((l) => /^test-bar: tests\/skip\.test\.js:4 /.test(l)), `the real case is not named, got: ${out}`);
  });

  await test('a readFileSync under the source tree followed by assert.match: the source-regex rule', () => {
    const rel = 'tests/hooks/thing.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const src = fs.readFileSync('hooks/mods/thing.js', 'utf8');",
      'assert.match(src, /export function thing/);',
    ]);
    const hit = out.split('\n').some((l) => /^test-bar: tests\/hooks\/thing\.test\.js:[34] /.test(l) && /(^|[^\w-])source-regex([^\w-]|$)/.test(l));
    assert(hit, `names the readFileSync or the assert.match line and the source-regex rule, got: ${out}`);
  });

  await test('a setTimeout past 1000 ms: the sleep rule', () => {
    const rel = 'tests/timing.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      "test('it settles', async () => {",
      '  await new Promise((resolve) => setTimeout(resolve, 1500));',
      "  assert(true, 'settled');",
      '});',
    ]);
    names(out, rel, 3, 'sleep');
  });

  await test('a *.test.* write under tests/lib/: the helper-test rule', () => {
    const rel = 'tests/lib/scratch.test.js';
    const out = write(rel, [
      "const { test, assertEq } = require('./harness');",
      "const { mkTmp } = require('./scratch');",
      "test('makes a folder', () => assertEq(typeof mkTmp('x-'), 'string', 'a path'));",
    ]);
    names(out, rel, undefined, 'helper-test');
  });

  group('test-bar: silent where the bar holds or the file is not a test');

  await test('a test file with none of the misses: nothing added', () => {
    const out = write('tests/parse.test.js', [
      "const fs = require('fs');",
      "const path = require('path');",
      "const { test, assertEq } = require('./lib/harness');",
      "const { mkTmp } = require('./lib/scratch');",
      "const { parse } = require('../scripts/parse');",
      "test('parses the written list', async () => {",
      "  const file = path.join(mkTmp('parse-'), 'list.txt');",
      "  fs.writeFileSync(file, 'a\\nb\\n');",
      '  await new Promise((resolve) => setTimeout(resolve, 10));',
      "  assertEq(parse(fs.readFileSync(file, 'utf8')), ['a', 'b'], 'two items');",
      '});',
    ]);
    assertEq(out, '', 'the bar holds');
  });

  await test('a source file write, misses and all: the hook does not run', () => {
    const out = write('scripts/make.js', [
      "const fs = require('fs');",
      "const os = require('os');",
      "const dir = fs.mkdtempSync(`${os.tmpdir()}/make-`);",
      "fs.writeFileSync('/tmp/make.log', dir);",
      'setTimeout(() => process.exit(0), 5000);',
    ]);
    assertEq(out, '', 'only a test path is read');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
