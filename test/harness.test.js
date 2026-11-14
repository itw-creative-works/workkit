// Tests for the door, packages/core/test/index.js: Node's own test functions handed out
// untouched, `test` and `it` behind the case deadline with Node's skip, todo and only
// forms, `needs` as a skip value, every concern's export behind the one require, and a
// suite on that require run by file and under the runner.

const fs = require('fs');
const path = require('path');
const nodeTest = require('node:test');
const { stripVTControlCharacters } = require('util');
const door = require('./lib/harness');
const { IS_WINDOWS, NO_EXEC_BIT, stubTool } = require('./lib/platform');
const { aloneEnv } = require('./lib/alone-env');
const { listsOf } = require('./lib/run-lists');

const { describe, test, expect, mkTmp, run, needs } = door;

const CORE_TEST = path.join(__dirname, '..', 'packages', 'core', 'test');
const KIT_LIB = path.join(CORE_TEST, 'lib');
const ENTRY = path.join(CORE_TEST, 'index.js');
const CASES = path.join(KIT_LIB, 'cases.js');
const RUNNER = path.join(CORE_TEST, 'run.js');
const BIN = path.join(CORE_TEST, '..', 'bin', 'workkit.js');
const CONCERNS = ['process', 'scratch', 'seed', 'suites', 'log', 'spawn'];
const NODE_WORDS = ['describe', 'before', 'after', 'beforeEach', 'afterEach', 'mock'];

// A suite on the one require alone, reaching a scratch folder, a wait and a child
// run through it: three cases that pass.
const ONE_REQUIRE = `
const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, until, run } = require('./lib/harness');
describe('the one require', () => {
  test('a scratch folder and a wait', async () => {
    const file = path.join(mkTmp('one-'), 'mark');
    fs.writeFileSync(file, 'x');
    expect(await until(() => fs.existsSync(file)), 'the mark is seen').toBeTruthy();
  });
  test('a child run', () => {
    expect(run(process.execPath, ['-e', 'process.stdout.write("hi")']).stdout, 'the child spoke').toBe('hi');
  });
  test('a third case', () => {});
});
`;

// Two cases that never end, through `test` and `it` given a 200 ms limit by the wrap's
// seam; the after hook clears what holds them open, so the file exits once both fail.
const NEVER_ENDS = `
const { test, it, after } = require('node:test');
const { withDeadline } = require(${JSON.stringify(CASES)});
const handles = [];
after(() => { for (const handle of handles) clearInterval(handle); });
withDeadline(test, 200)('never ends through test', () => new Promise(() => { handles.push(setInterval(() => {}, 1000)); }));
withDeadline(it, 200)('never ends through it', () => new Promise(() => { handles.push(setInterval(() => {}, 1000)); }));
`;

// A case through the door that states its own 500 ms limit and runs for a second.
const OWN_LIMIT = `
const { test } = require(${JSON.stringify(ENTRY)});
test('runs a second', { timeout: 500 }, () => new Promise((resolve) => { setTimeout(resolve, 1000); }));
`;

// The skip and todo forms of the door's `test` and `it`: a skip body throws if it runs,
// and a todo body runs and throws, which Node reports as a todo, never a failure.
const SKIP_TODO = `
const { test, it } = require(${JSON.stringify(ENTRY)});
test.skip('skipped by test.skip', () => { throw new Error('test.skip ran its body'); });
it.skip('skipped by it.skip', () => { throw new Error('it.skip ran its body'); });
test.todo('todo by test.todo', () => { throw new Error('a todo failure'); });
it.todo('todo by it.todo');
`;

// The only forms of the door's `test` and `it` beside a case not marked only that fails if it ran.
const ONLY = `
const { test, it } = require(${JSON.stringify(ENTRY)});
test.only('only by test.only', () => {});
it.only('only by it.only', () => {});
test('not marked only', () => { throw new Error('ran without only'); });
`;

// The door loaded over spies standing in for node:test's `test` and `it`, then one case
// through each of its words: prints what options each spy was handed.
const SPIED = `
const nodeTest = require('node:test');
const calls = [];
const spy = (word) => (...args) => { calls.push({ word, options: args.find((arg) => arg !== null && typeof arg === 'object') }); };
nodeTest.test = spy('test');
nodeTest.it = spy('it');
require('node:module').syncBuiltinESMExports();
const door = require(${JSON.stringify(ENTRY)});
door.test('through test', () => {});
door.it('through it', () => {});
console.log(JSON.stringify(calls));
`;

// A suite whose one describe takes needs() over `tools` as its skip value, and a sibling.
const NEEDING = (...tools) => `
const { describe, test, needs } = require('./lib/harness');
describe('needy', { skip: needs(${tools.map((tool) => JSON.stringify(tool)).join(', ')}) }, () => {
  test('the needing case', () => { throw new Error('the needing case ran'); });
});
`;
const NEEDY = NEEDING('no-such-tool-here');
const PLAIN = `
const { test } = require('./lib/harness');
test('the plain case', () => {});
`;
// A suite whose one describe needs node, a tool every machine running it has.
const PRESENT = `
const { describe, test, needs } = require('./lib/harness');
describe('present', { skip: needs('node') }, () => {
  test('the present case', () => {});
});
`;

// This process's env for a child in a cloud session, CLAUDE_CODE_REMOTE set to `remote`,
// or outside one when `remote` is null, the variable gone; `extra` over it.
const sessionEnv = (remote, extra = {}) => {
  const env = aloneEnv(extra);
  delete env.CLAUDE_CODE_REMOTE;
  return remote === null ? env : { ...env, CLAUDE_CODE_REMOTE: remote };
};

// node with `args` from `cwd`, a run of its own under `env`: its exit and both streams, colours stripped.
const node = (cwd, args, env = aloneEnv()) => {
  const res = run(process.execPath, args, { cwd, env });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

// needs(...args) called in a child node under `env`: what it returned, or the name and message it threw.
const needsIn = (env, args) => {
  const probe = `const { needs } = require(${JSON.stringify(ENTRY)});
try { console.log(JSON.stringify({ returned: needs(...${JSON.stringify(args)}) })); }
catch (error) { console.log(JSON.stringify({ threw: error.name, message: error.message })); }`;
  const { code, output } = node(mkTmp('needs-probe-'), ['-e', probe], env);
  expect(code, `the probe ran, got:\n${output}`).toBe(0);
  return JSON.parse(output.trim().split(/\r?\n/).pop());
};

// The suite file `name` of a repo run by node alone under `env`.
const byFile = (root, name, env) => node(root, [path.join('test', name)], env);

// The fixture `source` written to a scratch folder and run by file on Node's TAP reporter, after `flags`.
const tapRun = (source, flags = []) => {
  const dir = mkTmp('door-');
  fs.writeFileSync(path.join(dir, 'fixture.test.js'), source);
  return node(dir, [...flags, '--test-reporter=tap', 'fixture.test.js']);
};

// The top-level result lines of a TAP run, the duration-free part of each.
const results = (output) => output.split(/\r?\n/).filter((l) => /^(not )?ok \d+ - /.test(l));

// A scratch git repo whose test/ holds the door's re-export and `suites`, file name to source.
const mkRepo = (suites) => {
  const root = mkTmp('door-repo-');
  run('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'test', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'lib', 'harness.js'), `module.exports = require(${JSON.stringify(ENTRY)});\n`);
  for (const [name, source] of Object.entries(suites)) fs.writeFileSync(path.join(root, 'test', name), source);
  return root;
};

// How many case lines in `output` carry the pass mark, and the fail mark.
const marks = (output) => {
  const lines = output.split(/\r?\n/).map((l) => l.trim());
  return { passed: lines.filter((l) => l.startsWith('✓')).length, failed: lines.filter((l) => l.startsWith('✗')).length };
};

describe('harness: Node\'s own words', () => {
  test('describe, before, after, beforeEach, afterEach and mock from the door are node:test\'s own', () => {
    for (const word of NODE_WORDS) expect(door[word], `${word} is node:test's own`).toBe(nodeTest[word]);
  });

  test('a case through the seam that states no timeout and never ends fails as timed out at the seam\'s limit, through test and it', () => {
    const { code, output } = tapRun(NEVER_ENDS);
    expect(code, `the file fails, got:\n${output}`).toBe(1);
    expect(results(output)).toEqual(['not ok 1 - never ends through test', 'not ok 2 - never ends through it']);
    expect(output.split(/\r?\n/).filter((l) => l.includes('test timed out after 200ms')), `both name the timeout, got:\n${output}`).toHaveLength(2);
  });

  test('a case through the door that states { timeout: 500 } and runs a second fails at 500 ms, not at the default', () => {
    const { code, output } = tapRun(OWN_LIMIT);
    expect(code, `the file fails, got:\n${output}`).toBe(1);
    expect(results(output)).toEqual(['not ok 1 - runs a second']);
    expect(output, 'the failure names its own limit').toContain('test timed out after 500ms');
  });

  test('test.skip, it.skip, test.todo and it.todo through the door skip and mark todo as Node does, the run green', () => {
    const { code, output } = tapRun(SKIP_TODO);
    expect(code, `the file passes, got:\n${output}`).toBe(0);
    expect(results(output)).toEqual([
      'ok 1 - skipped by test.skip # SKIP',
      'ok 2 - skipped by it.skip # SKIP',
      'not ok 3 - todo by test.todo # TODO',
      'ok 4 - todo by it.todo # TODO',
    ]);
    expect(output, 'no skipped body ran').not.toMatch(/\.skip ran its body/);
  });

  test('test.only and it.only through the door, under --test-only, run alone', () => {
    const { code, output } = tapRun(ONLY, ['--test-only']);
    expect(code, `the file passes, got:\n${output}`).toBe(0);
    expect(results(output)).toEqual(['ok 1 - only by test.only', 'ok 2 - only by it.only']);
    expect(output, 'the case not marked only never ran').not.toContain('ran without only');
  });

  test('a case through the door\'s test and it that states no timeout hands Node 120000 ms', () => {
    const dir = mkTmp('door-spied-');
    fs.writeFileSync(path.join(dir, 'spied.js'), SPIED);
    const { code, output } = node(dir, ['spied.js']);
    expect(code, `the probe ran, got:\n${output}`).toBe(0);
    expect(JSON.parse(output.trim().split(/\r?\n/).pop())).toEqual([
      { word: 'test', options: { timeout: 120000 } },
      { word: 'it', options: { timeout: 120000 } },
    ]);
  });

  // A getter of Node's may build a new object per read, so the descriptors are compared, not the reads.
  test('the door\'s test and it carry every own key of node:test\'s, each Node\'s own getter or value', () => {
    for (const word of ['test', 'it']) {
      expect(Object.keys(door[word]).sort(), `${word}: the same own keys`).toEqual(Object.keys(nodeTest[word]).sort());
      for (const key of Object.keys(nodeTest[word])) {
        const node = Object.getOwnPropertyDescriptor(nodeTest[word], key);
        const carried = Object.getOwnPropertyDescriptor(door[word], key);
        if (node.get) expect(carried.get, `${word}.${key}: Node's own getter`).toBe(node.get);
        else expect(carried.value, `${word}.${key}: Node's own value`).toBe(node.value);
      }
    }
    expect(door.test.mock.fn, 'test.mock.fn through the door').toBeTypeOf('function');
  });
});

describe('harness: the one entry', () => {
  test('the entry exposes every export of process, scratch, seed, suites, log and spawn', () => {
    const entry = new Set(Object.keys(door));
    const missing = CONCERNS
      .flatMap((name) => Object.keys(require(path.join(KIT_LIB, `${name}.js`))).sort().map((key) => `${name}.${key}`))
      .filter((named) => !entry.has(named.slice(named.indexOf('.') + 1)));
    expect(missing.join(', '), 'every concern export reachable through the one require').toBe('');
  });

  test('a suite on the one require alone runs by file and under the runner with the same totals', () => {
    const root = mkRepo({ 'one.test.js': ONE_REQUIRE });
    const alone = node(root, ['--test-reporter=tap', path.join('test', 'one.test.js')]);
    expect(alone.code, `by file exits 0, got:\n${alone.output}`).toBe(0);
    expect(alone.output, 'by file, three passes').toMatch(/^# pass 3$/m);
    expect(alone.output, 'by file, no failure').toMatch(/^# fail 0$/m);
    const pooled = node(root, [RUNNER]);
    expect(pooled.code, `under the runner exits 0, got:\n${pooled.output}`).toBe(0);
    expect(marks(pooled.output), `under the runner, the same three, got:\n${pooled.output}`).toEqual({ passed: 3, failed: 0 });
    expect(pooled.output, 'the runner\'s totals agree').toContain('3 passed, 0 failed');
  });
});

describe('harness: needs', () => {
  test('needs(\'node\') is false', () => {
    expect(needs('node')).toBe(false);
  });

  test('outside a cloud session, a suite whose describe needs a missing tool fails by file: exit 1, the error naming the tool as not installed, its case never run', () => {
    const root = mkRepo({ 'needy.test.js': NEEDY });
    const { code, output } = byFile(root, 'needy.test.js', sessionEnv(null));
    expect(code, `exit 1, got:\n${output}`).toBe(1);
    expect(output.split(/\r?\n/), `the error line, got:\n${output}`).toContain('Error: needs no-such-tool-here, not installed');
    expect(output, 'the needing case never ran').not.toContain('the needing case ran');
  });

  test('outside a cloud session, the kit runner lists that suite as load <suite> with the message, exit 1, no pass counted', () => {
    const root = mkRepo({ 'needy.test.js': NEEDY });
    const { code, output } = node(root, [BIN, 'test'], sessionEnv(null));
    expect(code, `exit 1, got:\n${output}`).toBe(1);
    expect(output, 'no pass, the one failure').toMatch(/^0 passed, 1 failed/m);
    expect(listsOf(output), `the load failure with the message, got:\n${output}`).toContain('  - load test/needy.test.js: needs no-such-tool-here, not installed');
  });

  test('CLAUDE_CODE_REMOTE set to 1, false or empty is no cloud session: the suite fails by file as outside one', () => {
    const root = mkRepo({ 'needy.test.js': NEEDY });
    for (const remote of ['1', 'false', '']) {
      const { code, output } = byFile(root, 'needy.test.js', sessionEnv(remote));
      expect(code, `CLAUDE_CODE_REMOTE=${JSON.stringify(remote)}: exit 1, got:\n${output}`).toBe(1);
      expect(output.split(/\r?\n/), `CLAUDE_CODE_REMOTE=${JSON.stringify(remote)}: the error line, got:\n${output}`).toContain('Error: needs no-such-tool-here, not installed');
    }
  });

  test('two missing tools, one given twice, beside a present one: the error and the skip reason list both once, in the order given', () => {
    const args = ['no-such-tool-b', 'node', 'no-such-tool-a', 'no-such-tool-b'];
    expect(needsIn(sessionEnv(null), args), 'outside a cloud session').toEqual({ threw: 'Error', message: 'needs no-such-tool-b, no-such-tool-a, not installed' });
    expect(needsIn(sessionEnv('true'), args), 'in a cloud session').toEqual({ returned: 'needs no-such-tool-b, no-such-tool-a' });
  });

  test('needs with no argument or a non-string one throws its TypeError', () => {
    for (const args of [[], [42], ['node', 42]]) {
      expect(() => needs(...args), `needs(${args.map((a) => JSON.stringify(a)).join(', ')})`).toThrow(TypeError);
    }
  });

  test('a file of the tool\'s name on PATH without the executable bit is not the command', { skip: IS_WINDOWS && NO_EXEC_BIT }, () => {
    const bin = mkTmp('needs-bin-');
    stubTool(bin, 'wk-tool-a', ['#!/bin/sh', 'exit 0']);
    fs.writeFileSync(path.join(bin, 'hugo'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    expect(needsIn(sessionEnv('true', { PATH: bin }), ['wk-tool-a', 'hugo']), 'the stub found, the file without the bit missing').toEqual({ returned: 'needs hugo' });
  });

  test('in a cloud session, a describe skipped with needs(\'no-such-tool-here\') skips with that reason by file and in a real run\'s skips, its sibling run', () => {
    const root = mkRepo({ 'needy.test.js': NEEDY, 'plain.test.js': PLAIN });
    const alone = node(root, ['--test-reporter=tap', path.join('test', 'needy.test.js')], sessionEnv('true'));
    expect(alone.code, `by file, a skip exits 0, got:\n${alone.output}`).toBe(0);
    expect(results(alone.output), 'by file, the describe skipped with the reason').toEqual(['ok 1 - needy # SKIP needs no-such-tool-here']);
    const { code, output } = node(root, [BIN, 'test'], sessionEnv('true'));
    expect(code, `a skip keeps the run green, got:\n${output}`).toBe(0);
    expect(output, 'the totals count the sibling\'s one case').toMatch(/^1 passed, 0 failed/m);
    const listed = listsOf(output).filter((l) => l.includes('test/needy.test.js') && l.includes('needs no-such-tool-here'));
    expect(listed, `one skip line after the totals names the suite and the reason, got:\n${output}`).toHaveLength(1);
    expect(output, 'the skipped describe\'s case never ran').not.toContain('the needing case ran');
  });

  test('a describe that needs a present tool runs its case by file, in and outside a cloud session', () => {
    const root = mkRepo({ 'present.test.js': PRESENT });
    for (const remote of [null, 'true']) {
      const { code, output } = node(root, ['--test-reporter=tap', path.join('test', 'present.test.js')], sessionEnv(remote));
      expect(code, `CLAUDE_CODE_REMOTE=${remote}: exit 0, got:\n${output}`).toBe(0);
      expect(results(output), `CLAUDE_CODE_REMOTE=${remote}: the describe ran, not skipped`).toEqual(['ok 1 - present']);
      expect(output, `CLAUDE_CODE_REMOTE=${remote}: its case passed`).toMatch(/^ {4}ok 1 - the present case$/m);
    }
  });
});
