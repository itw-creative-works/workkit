// Tests for safety:test-bar's logic, testBarContext(facts) in
// hooks/mods/test-bar.js: the line it adds for each mechanical miss of the
// test bar in a written test file. The wiring cases (the chain, the opt-in,
// the session's repo) are test/mods/post-tool-use.test.ts.

const { describe, test, expect } = require('../lib/harness');
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
  expect(hit, `names ${rel}${line === undefined ? '' : `:${line}`} and the ${rule} rule, got: ${out}`).toBeTruthy();
};

// The lines of the context naming `rule` at any line of any file.
const ruleLines = (out, rule) => {
  const word = ruleWord(rule);
  return out.split('\n').filter((l) => /^test-bar: \S+:\d+ /.test(l) && word.test(l.replace(/^test-bar: \S+:\d+ /, '')));
};

// Every finding line of the context, whatever its rule, as one text.
const findings = (out) => out.split('\n').filter((l) => /^test-bar: \S+:\d+ /.test(l)).join('\n');

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
// A suite whose weak case sits inside a template literal spanning lines: a
// fixture's text, never a case of this suite.
const TEMPLATE_CASE = [
  "const fs = require('fs');",
  "const { test, assert } = require('./lib/harness');",
  'const SUITE = `',
  "test('the mark is there', () => {",
  "  assert(fs.existsSync('mark'), 'seen');",
  '});',
  '`;',
  "test('the suite is text', () => assert(SUITE.length > 0, 'a suite'));",
];

describe('test-bar: each mechanical miss names its line and rule', () => {
  test('fs.mkdtempSync outside tests/lib/scratch.js: the mkTmp rule', () => {
    const rel = 'tests/thing.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const { test, expect } = require('workkit-core/test');",
      "const dir = fs.mkdtempSync('thing-');",
      "test('reads it', () => expect(fs.readdirSync(dir).length, 'empty').toBe(0));",
    ]);
    names(out, rel, 3, 'mkTmp');
  });

  test('a mkdtempSync( inside a quoted fixture string: no mkTmp line', () => {
    const rel = 'tests/thing.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "const body = \"const dir = fs.mkdtempSync('thing-');\";",
      "test('holds the call', () => expect(body.length, 'the fixture text').toBe(37));",
    ]);
    expect(ruleLines(out, 'mkTmp').join('\n'), 'quoted text is a fixture, never a call').toBe('');
  });

  test('os.tmpdir() inside a template literal\'s ${...}: the mkTmp rule', () => {
    const rel = 'tests/thing.test.js';
    const out = write(rel, [
      "const os = require('os');",
      'const d = `${os.tmpdir()}/x`;',
    ]);
    names(out, rel, 2, 'mkTmp');
  });

  test('tests/lib/scratch.js itself, the one writer of a scratch folder: nothing added', () => {
    expect(write('tests/lib/scratch.js', SCRATCH_HOME), 'the mkTmp rule exempts its own home').toBe('');
  });

  test('a literal /tmp/ path and a literal port: the serial rule on each line', () => {
    const rel = 'tests/server.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "const LOG = '/tmp/server-test.log';",
      "const { get } = require('./lib/client');",
      "const URL = 'http://localhost:8080/health';",
      "test('answers', async () => expect((await get(URL, LOG)).status, 'ok').toBe(200));",
    ]);
    names(out, rel, 2, 'serial');
    names(out, rel, 4, 'serial');
  });

  test('a case whose only assertion is existsSync: the worth rule', () => {
    const rel = 'tests/install.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const { test } = require('./lib/harness');",
      "test('the script is there', () => { assert.ok(fs.existsSync('scripts/run.sh')); });",
    ]);
    names(out, rel, 4, 'worth');
  });

  test('a case with a skip option whose only assertion is existsSync: named on its own line, not its neighbour', () => {
    const rel = 'tests/skip.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const { test, expect } = require('workkit-core/test');",
      "test('the real one', () => { expect(1 + 1).toBe(2); });",
      "test('the file is there', { skip: process.platform === 'win32' && 'no pids' }, () => { expect(fs.existsSync('scripts/run.sh')).toBe(true); });",
    ]);
    names(out, rel, 4, 'worth');
    expect(!out.split('\n').some((l) => /^test-bar: tests\/skip\.test\.js:3 /.test(l)), `the real case is not named, got: ${out}`).toBeTruthy();
  });

  test('a case whose only assertion is expect(true).toBe(true): the worth rule', () => {
    const rel = 'tests/always.test.js';
    const out = write(rel, [
      "const { describe, test, expect } = require('workkit-core/test');",
      "describe('the thing', () => {",
      "  test('it holds', () => { expect(true).toBe(true); });",
      '});',
    ]);
    names(out, rel, 3, 'worth');
  });

  test('a describe holding an existsSync-only case and a case with a real expect beside one: only the first is named', () => {
    const rel = 'tests/list.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const { describe, test, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "describe('the list', () => {",
      "  test('the list is there', () => { expect(fs.existsSync('list.txt')).toBe(true); });",
      "  test('parses the list', () => {",
      "    expect(fs.existsSync('list.txt')).toBe(true);",
      "    expect(parse('a\\nb'), 'two items').toEqual(['a', 'b']);",
      '  });',
      '});',
    ]);
    expect(ruleLines(out, 'worth').join('\n'), 'the case with a real assertion is not named').toBe(`test-bar: ${rel}:5 worth`);
  });

  test('a weak case followed by a test.skip( case holding a real expect: the weak case named on its own line', () => {
    const rel = 'tests/skipped.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "test.skip('real after', () => { expect(parse('a'), 'one item').toEqual(['a']); });",
    ]);
    expect(findings(out), 'the test.skip( line starts a new case').toBe(`test-bar: ${rel}:3 worth`);
  });

  test('a weak case followed by a test.only( case holding a real expect: the weak case named on its own line', () => {
    const rel = 'tests/only.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "test.only('real after', () => { expect(parse('a'), 'one item').toEqual(['a']); });",
    ]);
    expect(findings(out), 'the test.only( line starts a new case').toBe(`test-bar: ${rel}:3 worth`);
  });

  test('a weak case followed by an it.skip( case holding a real expect: the weak case named on its own line', () => {
    const rel = 'tests/it-skip.test.js';
    const out = write(rel, [
      "const { test, it, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "it.skip('real after', () => { expect(parse('a'), 'one item').toEqual(['a']); });",
    ]);
    expect(findings(out), 'the it.skip( line starts a new case').toBe(`test-bar: ${rel}:3 worth`);
  });

  test('a weak case followed by a describe.skip( or describe.only( group holding a real expect: the weak case named on its own line', () => {
    const skipRel = 'tests/group-skip.test.js';
    const skipOut = write(skipRel, [
      "const { describe, test, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "describe.skip('later', () => {",
      "  expect(parse('a'), 'one item').toEqual(['a']);",
      '});',
    ]);
    expect(findings(skipOut), 'the describe.skip( line ends the open case').toBe(`test-bar: ${skipRel}:3 worth`);
    const onlyRel = 'tests/group-only.test.js';
    const onlyOut = write(onlyRel, [
      "const { describe, test, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "describe.only('later', () => {",
      "  expect(parse('a'), 'one item').toEqual(['a']);",
      '});',
    ]);
    expect(findings(onlyOut), 'the describe.only( line ends the open case').toBe(`test-bar: ${onlyRel}:3 worth`);
  });

  test('a test.todo( line with no function after a weak case: the weak case named, the todo line not', () => {
    const rel = 'tests/todo.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "test('weak first', () => { expect(true).toBe(true); });",
      "test.todo('later');",
    ]);
    expect(findings(out), 'a todo is no weak case').toBe(`test-bar: ${rel}:2 worth`);
  });

  test('a weak case followed by an after( hook holding a real expect, in one describe: the weak case named', () => {
    const rel = 'tests/after.test.js';
    const out = write(rel, [
      "const { describe, test, after, expect } = require('workkit-core/test');",
      "const { real } = require('./lib/real');",
      "describe('the thing', () => {",
      "  test('weak first', () => { expect(true).toBe(true); });",
      '  after(() => { expect(real()).toBe(3); });',
      '});',
    ]);
    expect(findings(out), 'the hook\'s expect counts to no case').toBe(`test-bar: ${rel}:4 worth`);
  });

  test('a weak case followed by an afterEach( hook holding a real expect: the weak case named', () => {
    const rel = 'tests/after-each.test.js';
    const out = write(rel, [
      "const { describe, test, afterEach, expect } = require('workkit-core/test');",
      "const { value } = require('./lib/value');",
      "describe('the thing', () => {",
      "  test('weak first', () => { expect(true).toBe(true); });",
      '  afterEach(() => { expect(value()).toBe(1); });',
      '});',
    ]);
    expect(findings(out), 'the hook\'s expect counts to no case').toBe(`test-bar: ${rel}:4 worth`);
  });

  test('a weak case beside a template literal holding one: only the real case is named, at its own line', () => {
    const rel = 'tests/fixture.test.js';
    const out = write(rel, [
      ...TEMPLATE_CASE,
      "test('the script is there', () => { assert(fs.existsSync('scripts/run.sh'), 'there'); });",
    ]);
    expect(ruleLines(out, 'worth').join('\n'), 'the fixture\'s case is text').toBe(`test-bar: ${rel}:9 worth`);
  });

  test('a readFileSync under the source tree followed by assert.match: the source-regex rule', () => {
    const rel = 'tests/hooks/thing.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const src = fs.readFileSync('hooks/mods/thing.js', 'utf8');",
      'assert.match(src, /export function thing/);',
    ]);
    const hit = out.split('\n').some((l) => /^test-bar: tests\/hooks\/thing\.test\.js:[34] /.test(l) && ruleWord('source-regex').test(l));
    expect(hit, `names the readFileSync or the assert.match line and the source-regex rule, got: ${out}`).toBeTruthy();
  });

  test('a readFileSync under the source tree reaching expect(...).toMatch inside a describe: the source-regex rule', () => {
    const rel = 'tests/hooks/thing.test.js';
    const out = write(rel, [
      "const fs = require('fs');",
      "const { describe, test, expect } = require('workkit-core/test');",
      "const src = fs.readFileSync('hooks/mods/thing.js', 'utf8');",
      "describe('the thing', () => {",
      "  test('exports it', () => { expect(src).toMatch(/export function thing/); });",
      '});',
    ]);
    const hit = out.split('\n').some((l) => /^test-bar: tests\/hooks\/thing\.test\.js:[35] /.test(l) && ruleWord('source-regex').test(l));
    expect(hit, `names the readFileSync or the toMatch line and the source-regex rule, got: ${out}`).toBeTruthy();
  });

  test('await sleep(300): one deadline finding, at that line', () => {
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
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('a setTimeout at 500 ms, under the old 1000 ms bar: the deadline rule', () => {
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

  test('a spawn timeout: 15000 is a deadline finding, timeout: SPAWN_DEADLINE is not', () => {
    const rel = 'tests/spawn.test.js';
    const out = write(rel, [
      "const { spawnSync } = require('child_process');",
      "const { test, expect } = require('workkit-core/test');",
      "const { SPAWN_DEADLINE } = require('./lib/process');",
      "test('exits clean', () => expect(spawnSync('node', ['a.js'], { encoding: 'utf8', timeout: 15000 }).status, 'ok').toBe(0));",
      "test('exits clean too', () => expect(spawnSync('node', ['b.js'], { encoding: 'utf8', timeout: SPAWN_DEADLINE }).status, 'ok').toBe(0));",
    ]);
    names(out, rel, 4, 'deadline');
    expect(ruleLines(out, 'deadline').length, `the shared deadline is not named, got: ${out}`).toBe(1);
  });

  test('an Atomics.wait of 1100 ms: the deadline rule', () => {
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

  test('await sleep(300) on a line after a fixture template closed: one deadline finding, at that line', () => {
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
    expect(ruleLines(out, 'deadline').length, `only the wait after the template, got: ${out}`).toBe(1);
  });

  test('a setTimeout at 500 ms on a line holding quoted words on both sides: still the deadline rule', () => {
    const rel = 'tests/timing.test.js';
    const out = write(rel, [
      "const { test, assert } = require('./lib/harness');",
      "test('waits', async () => { await new Promise((resolve) => { setTimeout(resolve, 500); }); assert(true, 'quoted'); });",
    ]);
    names(out, rel, 2, 'deadline');
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('a setTimeout at 500 ms after a comment holding one unclosed backtick: one deadline finding, at that line', () => {
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
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('await sleep(300) after a regex literal holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/rule.test.js';
    const out = write(rel, [
      "test('states the rule', async () => {",
      "  assert(/never write to `?x/.test(c), 'ok');",
      '  await sleep(300);',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('await sleep(300) after an arrow returning a regex literal holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/rule.test.js';
    const out = write(rel, [
      "test('states the rule', async () => {",
      '  const hit = lines.filter((l) => /never `x/.test(l));',
      '  await sleep(300);',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('a setTimeout at 500 ms after a trailing comment holding one backtick: one deadline finding, at that line', () => {
    const rel = 'tests/fixture.test.js';
    const out = write(rel, [
      "test('waits', async () => {",
      '  run(); // see `node x.js <file>',
      '  await new Promise((resolve) => { setTimeout(resolve, 500); });',
      '});',
    ]);
    names(out, rel, 3, 'deadline');
    expect(ruleLines(out, 'deadline').length, `one deadline finding, got: ${out}`).toBe(1);
  });

  test('a *.test.* write under tests/lib/: the helper-test rule', () => {
    const rel = 'tests/lib/scratch.test.js';
    const out = write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "const { mkTmp } = require('./scratch');",
      "test('makes a folder', () => expect(typeof mkTmp('x-'), 'a path').toBe('string'));",
    ]);
    names(out, rel, undefined, 'helper-test');
  });
});

describe('test-bar: silent where the bar holds or the file is not a test', () => {
  test('a test file with none of the misses: nothing added', () => {
    const out = write('tests/parse.test.js', [
      "const fs = require('fs');",
      "const path = require('path');",
      "const { describe, test, expect } = require('workkit-core/test');",
      "const { mkTmp } = require('./lib/scratch');",
      "const { parse } = require('../scripts/parse');",
      "describe('parse', () => {",
      "  test('parses the written list', async () => {",
      "    const file = path.join(mkTmp('parse-'), 'list.txt');",
      "    fs.writeFileSync(file, 'a\\nb\\n');",
      "    expect(parse(fs.readFileSync(file, 'utf8')), 'two items').toEqual(['a', 'b']);",
      '  });',
      '});',
    ]);
    expect(out, 'the bar holds').toBe('');
  });

  test('a case with no assertion followed by a beforeEach( hook whose expect is an existsSync: no worth line', () => {
    const out = write('tests/before-each.test.js', [
      "const fs = require('fs');",
      "const { describe, test, beforeEach, expect } = require('workkit-core/test');",
      "const { run } = require('../scripts/run');",
      "describe('the thing', () => {",
      "  test('runs it', () => { run(); });",
      "  beforeEach(() => { expect(fs.existsSync('y')).toBe(true); });",
      '});',
    ]);
    expect(findings(out), 'the hook\'s expect counts to no case').toBe('');
  });

  test('a before( hook holding expect(true).toBe(true) above a real case: no line for the hook, none for the case', () => {
    const out = write('tests/before.test.js', [
      "const { describe, test, before, expect } = require('workkit-core/test');",
      "const { parse } = require('../scripts/parse');",
      "describe('the list', () => {",
      '  before(() => { expect(true).toBe(true); });',
      "  test('parses', () => { expect(parse('a'), 'one item').toEqual(['a']); });",
      '});',
    ]);
    expect(findings(out), 'a hook is no case, and the case under it is real').toBe('');
  });

  test('a short bound passed to until or elapsedUntil, the sanctioned negative form: no deadline finding', () => {
    const out = write('tests/quiet.test.js', [
      "const { test, assert } = require('./lib/harness');",
      "const { until, elapsedUntil } = require('./lib/process');",
      'let seen = false;',
      "test('never shows', async () => {",
      "  assert(!(await until(() => seen, 300)), 'nothing came');",
      "  assert((await elapsedUntil(() => seen, 500)) === Infinity, 'nor later');",
      '});',
    ]);
    expect(ruleLines(out, 'deadline').join('\n'), 'the bound is the case').toBe('');
  });

  test('a zero setTimeout, a number on a comment line, a shell sleep in a string: no deadline finding', () => {
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
    expect(ruleLines(out, 'deadline').join('\n'), 'none of the three is a wait bound').toBe('');
  });

  test('a child program\'s setTimeout inside a string: no deadline finding', () => {
    const out = write('tests/child.test.js', [
      "const { execFileSync } = require('child_process');",
      "const { test, expect } = require('workkit-core/test');",
      "test('the child exits quiet', () => {",
      '  expect(execFileSync(process.execPath, [\'-e\', "setTimeout(() => {}, 2000)"]).length, \'no output\').toBe(0);',
      '});',
    ]);
    expect(ruleLines(out, 'deadline').join('\n'), 'the child\'s wait, not this test\'s').toBe('');
  });

  test('a wait inside a template literal spanning lines: no deadline finding', () => {
    const out = write('tests/runner.test.js', [
      "const { test, assert } = require('./lib/harness');",
      'const SUITE = (body) => body;',
      'const program = SUITE(`',
      "  const { sleep } = require('./lib/process');",
      '  await sleep(200);',
      '`);',
      "test('the program is text', () => assert(program.length > 0, 'a program'));",
    ]);
    expect(ruleLines(out, 'deadline').join('\n'), 'the fixture program\'s wait, not this test\'s').toBe('');
  });

  test('a wait inside a string in an array literal: no deadline finding', () => {
    const out = write('tests/fixture.test.js', [
      "const { test, expect } = require('workkit-core/test');",
      'const program = [',
      "  '  await sleep(300);',",
      '];',
      "test('the program is text', () => expect(program.length, 'one line').toBe(1));",
    ]);
    expect(ruleLines(out, 'deadline').join('\n'), 'a fixture line, not this test\'s wait').toBe('');
  });

  test('the deadline\'s own home, in the kit or a consumer repo: no deadline finding', () => {
    expect(ruleLines(write('packages/core/test/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), 'the kit\'s process.js is exempt').toBe('');
    expect(ruleLines(write('tests/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), 'and a consumer repo\'s').toBe('');
  });

  test('the grace in the kit\'s spawn.js: no deadline finding; the same line at test/lib/spawn.js still named', () => {
    expect(ruleLines(write('packages/core/test/lib/spawn.js', SPAWN_HOME), 'deadline').join('\n'), 'the kit\'s spawn.js is a deadline home').toBe('');
    names(write('test/lib/spawn.js', SPAWN_HOME), 'test/lib/spawn.js', 2, 'deadline');
  });

  test('the helpers\' homes under test/lib/: scratch.js and process.js exempt, a test file there named', () => {
    expect(ruleLines(write('test/lib/scratch.js', SCRATCH_HOME), 'mkTmp').join('\n'), 'test/lib/scratch.js is the scratch writer\'s home').toBe('');
    expect(ruleLines(write('test/lib/process.js', PROCESS_HOME), 'deadline').join('\n'), 'test/lib/process.js is the deadline\'s home').toBe('');
    const rel = 'test/lib/x.test.js';
    names(write(rel, [
      "const { test, expect } = require('workkit-core/test');",
      "test('adds', () => expect(1 + 1, 'two').toBe(2));",
    ]), rel, undefined, 'helper-test');
  });

  test('a readFileSync of a fixture under test/ followed by assert.match: no source-regex finding', () => {
    const out = write('test/x.test.js', [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const text = fs.readFileSync('test/fixtures/a.md', 'utf8');",
      'assert.match(text, /# Title/);',
    ]);
    expect(ruleLines(out, 'source-regex').join('\n'), 'a fixture under the suite folder is not source').toBe('');
  });

  test('a source file named with the word test, read then matched: the source-regex rule fires', () => {
    const out = write('test/x.test.js', [
      "const fs = require('fs');",
      "const assert = require('assert');",
      "const src = fs.readFileSync('hooks/mods/test-bar.js', 'utf8');",
      'assert.match(src, /function sourceRegexFindings/);',
    ]);
    expect(ruleLines(out, 'source-regex').length > 0, `the word test in a file name is not the suite folder, got: ${out}`).toBeTruthy();
  });

  test('a source file write, misses and all: the hook does not run', () => {
    const out = write('scripts/make.js', [
      "const fs = require('fs');",
      "const os = require('os');",
      "const dir = fs.mkdtempSync(`${os.tmpdir()}/make-`);",
      "fs.writeFileSync('/tmp/make.log', dir);",
      'setTimeout(() => process.exit(0), 5000);',
    ]);
    expect(out, 'only a test path is read').toBe('');
  });
});
