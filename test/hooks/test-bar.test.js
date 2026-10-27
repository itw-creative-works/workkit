// Tests for safety:test-bar's logic, testBarContext(facts) in
// hooks/mods/test-bar.js: the line it adds for each mechanical miss of the
// test bar in a written test file. The wiring cases (the chain, the opt-in,
// the session's repo) are test/mods/post-tool-use.test.ts.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

// The hook's answer for `lines` written at `rel`, as one text.
const write = (rel, lines) => textOf(mods('test-bar').testBarContext({ root: '/w/repo', rel, text: `${lines.join('\n')}\n` }));

// `rule` as a whole word of a finding line, never part of a longer rule name.
const ruleWord = (rule) => new RegExp(`(^|[^\\w-])${rule}([^\\w-]|$)`);

// The context holds a `test-bar: <rel>:<line> ...` line naming `rule`; `line`
// is one number, or undefined where the Contract names no line.
const names = (out, rel, line, rule) => {
  const head = line === undefined ? `test-bar: ${rel}:` : `test-bar: ${rel}:${line} `;
  const word = ruleWord(rule);
  const hit = out.split('\n').some((l) => l.startsWith(head) && word.test(l.slice(head.length)));
  assert(hit, `names ${rel}${line === undefined ? '' : `:${line}`} and the ${rule} rule, got: ${out}`);
};

// The lines of the context naming `rule` at any line of any file.
const ruleLines = (out, rule) => {
  const word = ruleWord(rule);
  return out.split('\n').filter((l) => /^test-bar: \S+:\d+ /.test(l) && word.test(l.replace(/^test-bar: \S+:\d+ /, '')));
};

// The scratch writer's and the deadline's homes as a repo keeps them: each holds
// the one thing its rule names everywhere else.
const SCRATCH_HOME = [
  "const fs = require('fs');",
  "const os = require('os');",
  "const path = require('path');",
  "const mkTmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));",
  'module.exports = { mkTmp };',
];
const PROCESS_HOME = [
  'const SPAWN_DEADLINE = 60000;',
  'const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });',
  'const until = async (predicate, ms = SPAWN_DEADLINE) => {',
  '  const end = Date.now() + ms;',
  '  while (Date.now() < end) { if (predicate()) return true; await sleep(100); }',
  '  return predicate();',
  '};',
  'module.exports = { SPAWN_DEADLINE, until };',
];
// The tree end's TERM-to-KILL grace, the one other wait bound a home writes.
const SPAWN_HOME = [
  "const kill = (child) => child.kill('SIGKILL');",
  'const end = (child) => { setTimeout(() => kill(child), 2000); };',
  'module.exports = { end };',
];

const cases = async () => {
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
    assertEq(write('tests/lib/scratch.js', SCRATCH_HOME), '', 'the mkTmp rule exempts its own home');
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
    const hit = out.split('\n').some((l) => /^test-bar: tests\/hooks\/thing\.test\.js:[34] /.test(l) && ruleWord('source-regex').test(l));
    assert(hit, `names the readFileSync or the assert.match line and the source-regex rule, got: ${out}`);
  });

  await test('await sleep(300): one deadline finding, at that line', () => {
    const rel = 'tests/timing.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      'const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });',
      "test('it settles', async () => {",
      '  await sleep(300);',
      "  assert(true, 'settled');",
      '});',
    ]);
    names(out, rel, 4, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
  });

  await test('a setTimeout at 500 ms, under the old 1000 ms bar: the deadline rule', () => {
    const rel = 'tests/timing.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      "test('it settles', async () => {",
      '  await new Promise((resolve) => { setTimeout(resolve, 500); });',
      "  assert(true, 'settled');",
      '});',
    ]);
    names(out, rel, 3, 'deadline');
  });

  await test('a spawn timeout: 15000 is a deadline finding, timeout: SPAWN_DEADLINE is not', () => {
    const rel = 'tests/spawn.test.js';
    const out = write(rel, [
      "const { spawnSync } = require('child_process');",
      "const { test, assertEq } = require('./lib/harness');",
      "const { SPAWN_DEADLINE } = require('./lib/process');",
      "test('exits clean', () => assertEq(spawnSync('node', ['a.js'], { encoding: 'utf8', timeout: 15000 }).status, 0, 'ok'));",
      "test('exits clean too', () => assertEq(spawnSync('node', ['b.js'], { encoding: 'utf8', timeout: SPAWN_DEADLINE }).status, 0, 'ok'));",
    ]);
    names(out, rel, 4, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `the shared deadline is not named, got: ${out}`);
  });

  await test('an Atomics.wait of 1100 ms: the deadline rule', () => {
    const rel = 'tests/block.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      'const arr = new Int32Array(new SharedArrayBuffer(4));',
      "test('it blocks', () => {",
      '  Atomics.wait(arr, 0, 0, 1100);',
      "  assert(true, 'woke');",
      '});',
    ]);
    names(out, rel, 4, 'deadline');
  });

  await test('await sleep(300) on a line after a fixture template closed: one deadline finding, at that line', () => {
    const rel = 'tests/runner.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      'const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });',
      'const SUITE = (body) => body;',
      'const program = SUITE(`',
      '  await sleep(200);',
      '`);',
      "test('it settles', async () => {",
      '  await sleep(300);',
      "  assert(program.length > 0, 'settled');",
      '});',
    ]);
    names(out, rel, 8, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `only the wait after the template, got: ${out}`);
  });

  await test('a setTimeout at 500 ms on a line holding quoted words on both sides: still the deadline rule', () => {
    const rel = 'tests/timing.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      "test('waits', async () => { await new Promise((resolve) => { setTimeout(resolve, 500); }); assert(true, 'quoted'); });",
    ]);
    names(out, rel, 2, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
  });

  await test('a setTimeout at 500 ms after a comment holding one unclosed backtick: one deadline finding, at that line', () => {
    const rel = 'tests/fixture.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      '// see `node x.js <file>',
      '// for the fixture it reads',
      "test('waits', async () => {",
      '  await new Promise((resolve) => { setTimeout(resolve, 500); });',
      "  assert(true, 'waited');",
      '});',
    ]);
    names(out, rel, 5, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
  });

  await test('await sleep(300) after a regex literal holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/rule.test.js';
    const out = write(rel, [
      "test('states the rule', async () => {",
      "  assert(/never write to `?x/.test(c), 'ok');",
      '  await sleep(300);',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
  });

  await test('await sleep(300) after an arrow returning a regex literal holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/rule.test.js';
    const out = write(rel, [
      "test('states the rule', async () => {",
      '  const hit = lines.filter((l) => /never `x/.test(l));',
      '  await sleep(300);',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
  });

  await test('a setTimeout at 500 ms after a trailing comment holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/fixture.test.js';
    const out = write(rel, [
      "test('waits', async () => {",
      '  run(); // see `node x.js <file>',
      '  await new Promise((resolve) => { setTimeout(resolve, 500); });',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    assertEq(ruleLines(out, 'deadline').length, 1, `one deadline finding, got: ${out}`);
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
      "  assertEq(parse(fs.readFileSync(file, 'utf8')), ['a', 'b'], 'two items');",
      '});',
    ]);
    assertEq(out, '', 'the bar holds');
  });

  await test('a short bound passed to until or elapsedUntil, the sanctioned negative form: no deadline finding', () => {
    const out = write('tests/quiet.test.js', [
      "const { test, assert } = require('./lib/harness');",
      "const { until, elapsedUntil } = require('./lib/process');",
      'let seen = false;',
      "test('never shows', async () => {",
      "  assert(!(await until(() => seen, 300)), 'nothing came');",
      "  assert((await elapsedUntil(() => seen, 500)) === Infinity, 'nor later');",
      '});',
    ]);
    assertEq(ruleLines(out, 'deadline').join('\n'), '', 'the bound is the case');
  });

  await test('a zero setTimeout, a number on a comment line, a shell sleep in a string: no deadline finding', () => {
    const out = write('tests/stub.test.js', [
      "const { test, assert } = require('./lib/harness');",
      "const STUB = 'exec sleep 30';",
      '// await sleep(5000);',
      "test('yields once', async () => {",
      '  const fn = () => {};',
      '  setTimeout(fn, 0);',
      "  assert(STUB.length > 0, 'a stub');",
      '});',
    ]);
    assertEq(ruleLines(out, 'deadline').join('\n'), '', 'none of the three is a wait bound');
  });

  await test('a child program\'s setTimeout inside a string: no deadline finding', () => {
    const out = write('tests/child.test.js', [
      "const { execFileSync } = require('child_process');",
      "const { test, assertEq } = require('./lib/harness');",
      "test('the child exits quiet', () => {",
      '  assertEq(execFileSync(process.execPath, [\'-e\', "setTimeout(() => {}, 2000)"]).length, 0, \'no output\');',
      '});',
    ]);
    assertEq(ruleLines(out, 'deadline').join('\n'), '', 'the child\'s wait, not this test\'s');
  });

  await test('a wait inside a template literal spanning lines: no deadline finding', () => {
    const out = write('tests/runner.test.js', [
      "const { test, assert } = require('./lib/harness');",
      'const SUITE = (body) => body;',
      'const program = SUITE(`',
      "  const { sleep } = require('./lib/process');",
      '  await sleep(200);',
      '`);',
      "test('the program is text', () => assert(program.length > 0, 'a program'));",
    ]);
    assertEq(ruleLines(out, 'deadline').join('\n'), '', 'the fixture program\'s wait, not this test\'s');
  });

  await test('a wait inside a string in an array literal: no deadline finding', () => {
    const out = write('tests/fixture.test.js', [
      "const { test, assertEq } = require('./lib/harness');",
      'const program = [',
      "  '  await sleep(300);',",
      '];',
      "test('the program is text', () => assertEq(program.length, 1, 'one line'));",
    ]);
    assertEq(ruleLines(out, 'deadline').join('\n'), '', 'a fixture line, not this test\'s wait');
  });

  await test('the deadline\'s own home, in the kit or a consumer repo: no deadline finding', () => {
    assertEq(ruleLines(write('workflow/test/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), '', 'the kit\'s process.js is exempt');
    assertEq(ruleLines(write('tests/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), '', 'and a consumer repo\'s');
  });

  await test('the grace in the kit\'s spawn.js: no deadline finding; the same line at test/lib/spawn.js still named', () => {
    assertEq(ruleLines(write('workflow/test/lib/spawn.js', SPAWN_HOME), 'deadline').join('\n'), '', 'the kit\'s spawn.js is a deadline home');
    names(write('test/lib/spawn.js', SPAWN_HOME), 'test/lib/spawn.js', 2, 'deadline');
  });

  await test('the helpers\' homes under test/lib/: scratch.js and process.js exempt, a test file there named', () => {
    assertEq(ruleLines(write('test/lib/scratch.js', SCRATCH_HOME), 'mkTmp').join('\n'), '', 'test/lib/scratch.js is the scratch writer\'s home');
    assertEq(ruleLines(write('test/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), '', 'test/lib/process.js is the deadline\'s home');
    const rel = 'test/lib/x.test.js';
    names(write(rel, [
      "const { test, assertEq } = require('./harness');",
      "test('adds', () => assertEq(1 + 1, 2, 'two'));",
    ]), rel, undefined, 'helper-test');
  });

  await test('a readFileSync of a fixture under test/ followed by assert.match: no source-regex finding', () => {
    const out = write('test/x.test.js', [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const text = fs.readFileSync('test/fixtures/a.md', 'utf8');",
      'assert.match(text, /# Title/);',
    ]);
    assertEq(ruleLines(out, 'source-regex').join('\n'), '', 'a fixture under the suite folder is not source');
  });

  await test('a source file named with the word test, read then matched: the source-regex rule fires', () => {
    const out = write('test/x.test.js', [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const src = fs.readFileSync('hooks/mods/test-bar.js', 'utf8');",
      'assert.match(src, /function sourceRegexFindings/);',
    ]);
    assert(ruleLines(out, 'source-regex').length > 0, `the word test in a file name is not the suite folder, got: ${out}`);
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
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
