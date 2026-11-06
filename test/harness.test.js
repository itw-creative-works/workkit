// Tests for the one entry, packages/core/test/lib/harness.js: every export behind it, a
// suite on that one require run by file and under the runner, a failure's first frame
// outside the library, every later line of a message, skip reason or case body's own print
// off column zero with the real writers back after, and needs() skipping only in the cloud.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { stripVTControlCharacters } = require('util');
const {
  group, test, testUnless, assert, assertEq, summary, selfRun, mkTmp, run,
} = require('./lib/harness');
const { IS_WINDOWS, NO_EXEC_BIT, stubTool } = require('./lib/platform');

const KIT_LIB = path.join(__dirname, '..', 'packages', 'core', 'test', 'lib');
const RUNNER = path.join(__dirname, '..', 'packages', 'core', 'test', 'run.js');
const CONCERNS = ['process', 'scratch', 'seed', 'suites', 'log', 'spawn'];
const ENTRY = path.join(KIT_LIB, '..', 'index.js');

// A suite on the one require alone, reaching a scratch folder, a wait, a child
// run and the log through it: three cases that pass.
const ONE_REQUIRE = `
const fs = require('fs');
const path = require('path');
const { test, assert, assertEq, summary, selfRun, mkTmp, until, run, log } = require('./lib/harness');
const cases = async () => {
  await test('a scratch folder and a wait', async () => {
    const file = path.join(mkTmp('one-'), 'mark');
    fs.writeFileSync(file, 'x');
    assert(await until(() => fs.existsSync(file)), 'the mark is seen');
  });
  await test('a child run', () => {
    assertEq(run(process.execPath, ['-e', 'process.stdout.write("hi")']).stdout, 'hi', 'the child spoke');
  });
  await test('a logged case', () => { log('a', 'note'); });
};
module.exports = async () => { await cases(); return summary(); };
if (require.main === module) selfRun(module.exports);
`;

// A scratch repo whose test/ holds the harness re-export and the one suite.
const mkRepo = () => {
  const root = mkTmp('one-require-');
  run('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'test', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'lib', 'harness.js'), `module.exports = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});\n`);
  fs.writeFileSync(path.join(root, 'test', 'one.test.js'), ONE_REQUIRE);
  return root;
};

// A node run from `root`: its exit and both streams with the colors stripped.
const node = (root, args) => {
  const res = run(process.execPath, args, { cwd: root });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

// A suite on the library whose one case throws an error carrying `stack` and `message`.
const THROWS = (stack, message = 'boom') => `
const { test, summary, selfRun } = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});
module.exports = async () => {
  await test('throws', () => { const err = new Error(${JSON.stringify(message)}); err.stack = ${JSON.stringify(stack)}; throw err; });
  return summary();
};
if (require.main === module) selfRun(module.exports);
`;

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// `stack` thrown by a one-case suite run by file: the suite's exit, its output,
// and the dimmed frame lines under the failure message.
const framesOf = (dir, stack, message) => {
  const file = path.join(dir, 'throws.test.js');
  fs.writeFileSync(file, THROWS(stack, message));
  const res = run(process.execPath, [file]);
  const frames = res.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(DIM))
    .map((l) => l.slice(DIM.length, l.lastIndexOf(RESET)));
  return { status: res.status, output: res.output, frames };
};

// A one-case suite on the library whose case runs `body`, then a group header and `after`.
const BODY = (body, after = '') => `
const { group, test, summary, selfRun } = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});
module.exports = async () => {
  await test('the case', ${body});
  group('after');
  ${after}
  return summary();
};
if (require.main === module) selfRun(module.exports);
`;

// The BODY suite over `body`, run by file: its exit, its whole output and each stream, colours stripped.
const bodyRun = (body, after) => {
  const dir = mkTmp('body-');
  const file = path.join(dir, 'body.test.js');
  fs.writeFileSync(file, BODY(body, after));
  const res = run(process.execPath, [file], { cwd: dir });
  const [output, stdout, stderr] = [res.output, res.stdout, res.stderr].map((text) => stripVTControlCharacters(text));
  return { code: res.status, output, stdout, stderr };
};

// How many case lines in `output` carry the pass mark, and the fail mark.
const marks = (output) => {
  const lines = output.split(/\r?\n/).map((l) => l.trim());
  return { passed: lines.filter((l) => l.startsWith('✓')).length, failed: lines.filter((l) => l.startsWith('✗')).length };
};

// A suite on the package entry whose top runs `call`, then one case.
const NEEDS = (call) => `
const { needs, test, summary, selfRun } = require(${JSON.stringify(ENTRY)});
module.exports = async () => {
  ${call};
  await test('the needing case', () => {});
  return summary();
};
if (require.main === module) selfRun(module.exports);
`;

// A scratch PATH folder holding one runnable stub per name in `tools`.
const toolBin = (tools = []) => {
  const bin = mkTmp('needs-bin-');
  for (const name of tools) stubTool(bin, name, ['#!/bin/sh', 'exit 0']);
  return bin;
};

// The env a needs() suite runs under: PATH the one folder `bin`, CLAUDE_CODE_REMOTE `remote`, unset when undefined.
const needsEnv = (bin, remote) => {
  const env = { ...process.env, PATH: bin };
  delete env.CLAUDE_CODE_REMOTE;
  return remote === undefined ? env : { ...env, CLAUDE_CODE_REMOTE: remote };
};

// The NEEDS suite over `call`, run by file under needsEnv(bin, remote): its exit and output, colours stripped.
const needsRun = (call, bin, remote) => {
  const dir = mkTmp('needs-');
  const file = path.join(dir, 'needs.test.js');
  fs.writeFileSync(file, NEEDS(call));
  const res = run(process.execPath, [file], { cwd: dir, env: needsEnv(bin, remote) });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

const SKIP_LINE = (tools) => `⊘ skipped: needs ${tools}, not installed in this cloud session`;
const trimmed = (output) => output.split(/\r?\n/).map((l) => l.trim());

const cases = async () => {
  group('harness: the one entry');

  await test('the entry exposes every export of process, scratch, seed, suites, log and spawn', () => {
    const entry = new Set(Object.keys(require('./lib/harness')));
    const missing = CONCERNS
      .flatMap((name) => Object.keys(require(path.join(KIT_LIB, `${name}.js`))).sort().map((key) => `${name}.${key}`))
      .filter((named) => !entry.has(named.slice(named.indexOf('.') + 1)));
    assertEq(missing.join(', '), '', 'every concern export reachable through the one require');
  });

  await test('a suite on the one require alone runs by file and under the runner with the same totals', () => {
    const root = mkRepo();
    const alone = node(root, [path.join('test', 'one.test.js')]);
    assertEq(alone.code, 0, `by file exits 0, got:\n${alone.output}`);
    assertEq(JSON.stringify(marks(alone.output)), JSON.stringify({ passed: 3, failed: 0 }), `by file, three passes, got:\n${alone.output}`);
    const pooled = node(root, [RUNNER]);
    assertEq(pooled.code, 0, `under the runner exits 0, got:\n${pooled.output}`);
    assertEq(JSON.stringify(marks(pooled.output)), JSON.stringify({ passed: 3, failed: 0 }), `under the runner, the same three, got:\n${pooled.output}`);
    assert(pooled.output.includes('3 passed, 0 failed'), `the runner's totals agree, got:\n${pooled.output}`);
  });

  group('harness: the failure frame');

  await test('a stack carrying only a file:/// frame outside the library prints that frame as its path', () => {
    const dir = mkTmp('frame-');
    const outside = path.join(dir, 'x.js');
    const url = pathToFileURL(outside).href;
    for (const frame of [`at ${url}:3:5`, `at fn (${url}:3:5)`]) {
      const { status, output, frames } = framesOf(dir, `Error: boom\n    ${frame}`);
      assertEq(status, 1, `the case failed, got:\n${output}`);
      assertEq(frames.length, 1, `one frame line for "${frame}", got:\n${output}`);
      assert(frames[0].includes(`${outside}:3:5`) && !frames[0].includes('file:'), `"${frame}" prints as its path, got: ${frames[0]}`);
    }
  });

  await test('an `at async` frame with no parentheses, outside the library, prints as its path', () => {
    const dir = mkTmp('frame-');
    const outside = path.join(dir, 'x.js');
    for (const frame of [`at async ${outside}:3:5`, `at async ${pathToFileURL(outside).href}:3:5`]) {
      const { status, output, frames } = framesOf(dir, `Error: boom\n    ${frame}`);
      assertEq(status, 1, `the case failed, got:\n${output}`);
      assertEq(frames.length, 1, `one frame line for "${frame}", got:\n${output}`);
      assert(frames[0].includes(`${outside}:3:5`) && !frames[0].includes('file:'), `"${frame}" prints as its path, got: ${frames[0]}`);
    }
  });

  await test('a file:/// frame inside the library is skipped and the next frame, outside it, prints', () => {
    const dir = mkTmp('frame-');
    const inside = pathToFileURL(path.join(KIT_LIB, 'harness.js')).href;
    const outside = path.join(dir, 'y.js');
    const { status, output, frames } = framesOf(dir, `Error: boom\n    at ${inside}:10:5\n    at ${outside}:7:9`);
    assertEq(status, 1, `the case failed, got:\n${output}`);
    assertEq(frames.length, 1, `one frame line, got:\n${output}`);
    assert(frames[0].includes(`${outside}:7:9`), `the outside frame prints, not the library's, got: ${frames[0]}`);
  });

  group('harness: the failure message');

  await test('a failing message of two lines prints both at the case indent', () => {
    const dir = mkTmp('message-');
    const outside = path.join(dir, 'x.js');
    const { status, output } = framesOf(dir, `Error: first\nsecond\n    at ${outside}:3:5`, 'first\nsecond');
    assertEq(status, 1, `the case failed, got:\n${output}`);
    const printed = stripVTControlCharacters(output).split(/\r?\n/);
    const frame = printed.find((l) => l.trim().startsWith(`at ${outside}`));
    assert(frame, `the frame line printed, got:\n${output}`);
    const indent = frame.slice(0, frame.indexOf('at '));
    assert(indent.length > 0, `the case indent is not column zero, got:\n${output}`);
    assert(printed.includes(`${indent}first`), `the first line at the case indent, got:\n${output}`);
    assert(printed.includes(`${indent}second`), `the second line at the case indent, got:\n${output}`);
  });

  group('harness: selfRun');

  await test('selfRun over a suite skipped with a two-line reason prints the second line at the case indent', () => {
    const dir = mkTmp('skip-');
    const file = path.join(dir, 'skipped.test.js');
    fs.writeFileSync(file, `
const { skipSuite, selfRun } = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});
module.exports = async () => skipSuite('skip first\\nskip second');
if (require.main === module) selfRun(module.exports);
`);
    const { code, output } = node(dir, [file]);
    assertEq(code, 0, `a skipped suite exits 0, got:\n${output}`);
    const printed = output.split(/\r?\n/);
    assert(printed.some((l) => l.includes('skip first')), `the reason's first line printed, got:\n${output}`);
    assert(printed.includes('    skip second'), `the second line at the case indent, got:\n${output}`);
    assert(!printed.some((l) => l.startsWith('skip second')), `the second line never at column zero, got:\n${output}`);
  });

  group('harness: a skipped case');

  await test('a skipped case whose reason holds two lines prints the second line indented, never at column zero', () => {
    const dir = mkTmp('skip-case-');
    const file = path.join(dir, 'gated.test.js');
    fs.writeFileSync(file, `
const { skip, summary, selfRun } = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});
module.exports = async () => { skip('the gated case', 'reason first\\nreason second'); return summary(); };
if (require.main === module) selfRun(module.exports);
`);
    const { code, output } = node(dir, [file]);
    assertEq(code, 0, `a skipped case keeps the suite green, got:\n${output}`);
    const printed = output.split(/\r?\n/);
    assert(printed.some((l) => l.includes('the gated case') && l.includes('reason first')), `the skip line names the case and the first line, got:\n${output}`);
    assert(printed.some((l) => /^\s+reason second/.test(l)), `the second line indented, got:\n${output}`);
    assert(!printed.some((l) => l.startsWith('reason second')), `the second line never at column zero, got:\n${output}`);
  });

  group('harness: a case body\'s own prints');

  await test('a passing case whose body writes two lines with console.log prints both at the case indent, the next header at column zero', () => {
    const { code, output } = bodyRun("() => { console.log('one\\ntwo'); }");
    assertEq(code, 0, `the case passed, got:\n${output}`);
    assertEq(output, '    one\n    two\n  ✓ the case\n\n[after]\n', 'the body lines indented, the mark and the header on the real writer');
  });

  await test('a passing case whose body writes two lines with process.stdout.write prints both at the case indent, the next header at column zero', () => {
    const { code, output } = bodyRun("() => { process.stdout.write('one\\ntwo\\n'); }");
    assertEq(code, 0, `the case passed, got:\n${output}`);
    assertEq(output, '    one\n    two\n  ✓ the case\n\n[after]\n', 'the body lines indented, the mark and the header on the real writer');
  });

  await test('a passing case whose body writes two lines with console.error prints both at the case indent on stderr, a print after the case at column zero', () => {
    const { code, stdout, stderr } = bodyRun("() => { console.error('one\\ntwo'); }", "console.error('after on stderr');");
    assertEq(code, 0, `the case passed, got:\n${stdout}${stderr}`);
    assertEq(stderr, '    one\n    two\nafter on stderr\n', 'the body lines on stderr at the case indent, the real writer back after the case');
    assertEq(stdout, '  ✓ the case\n\n[after]\n', 'the mark and the header on stdout, untouched');
  });

  await test('a failing case\'s body print is indented the same, and the body that threw gets its writer put back', () => {
    const { code, output } = bodyRun("() => { console.log('one\\ntwo'); const err = new Error('boom'); err.stack = 'Error: boom'; throw err; }");
    assertEq(code, 1, `the case failed, got:\n${output}`);
    assertEq(output, '    one\n    two\n  ✗ the case\n    boom\n\n[after]\n', 'the body lines indented, the mark, the message and the header on the real writer');
  });

  group('harness: needs');

  await test('needs() with every tool on PATH returns and prints nothing, locally and in a cloud session', () => {
    const bin = toolBin(['wk-tool-a', 'wk-tool-b']);
    for (const remote of [undefined, 'true']) {
      const { code, output } = needsRun("needs('wk-tool-a', 'wk-tool-b')", bin, remote);
      assertEq(code, 0, `CLAUDE_CODE_REMOTE=${remote}: the suite passes, got:\n${output}`);
      assertEq(output, '  ✓ the needing case\n', `CLAUDE_CODE_REMOTE=${remote}: the case ran and needs() printed nothing`);
    }
  });

  await test('in a cloud session the run prints the skip line under the suite missing hugo, and its sibling still runs', () => {
    const root = mkTmp('needs-run-');
    run('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, 'test'));
    fs.writeFileSync(path.join(root, 'test', 'needy.test.js'), NEEDS("needs('hugo')"));
    fs.writeFileSync(path.join(root, 'test', 'plain.test.js'), NEEDS('void 0'));
    const res = run(process.execPath, [RUNNER], { cwd: root, env: needsEnv(toolBin(), 'true') });
    const output = stripVTControlCharacters(res.output);
    assertEq(res.status, 0, `a skipped suite keeps the run green, got:\n${output}`);
    const lines = trimmed(output);
    const header = lines.indexOf('▶ needy.test.js');
    assert(header >= 0, `the suite's header printed, got:\n${output}`);
    assertEq(lines.slice(header + 1).find(Boolean), SKIP_LINE('hugo'), `the skip line under the suite's header, got:\n${output}`);
    assertEq(marks(output).passed, 1, `only the sibling's case ran, got:\n${output}`);
    assert(output.includes('1 passed, 0 failed, 1 suite skipped'), `the totals count the skipped suite, got:\n${output}`);
  });

  await test('in a cloud session the skip names every missing tool in argument order, and no tool that is there', () => {
    const { code, output } = needsRun("needs('wk-tool-a', 'hugo', 'ffmpeg')", toolBin(['wk-tool-a']), 'true');
    assertEq(code, 0, `a skipped suite exits 0, got:\n${output}`);
    assert(trimmed(output).includes(SKIP_LINE('hugo, ffmpeg')), `the one skip line naming both, got:\n${output}`);
    assertEq(marks(output).passed, 0, `the suite's case never ran, got:\n${output}`);
  });

  await test('off a cloud session (CLAUDE_CODE_REMOTE unset or false) a missing tool fails the suite, naming it', () => {
    for (const remote of [undefined, 'false']) {
      const { code, output } = needsRun("needs('hugo')", toolBin(), remote);
      assertEq(code, 1, `CLAUDE_CODE_REMOTE=${remote}: the suite fails, got:\n${output}`);
      assert(output.includes('needs hugo, not installed'), `CLAUDE_CODE_REMOTE=${remote}: the failure names the tool, got:\n${output}`);
      assert(!output.includes('cloud session') && !output.includes('⊘'), `CLAUDE_CODE_REMOTE=${remote}: never the cloud skip, got:\n${output}`);
      assertEq(marks(output).passed, 0, `CLAUDE_CODE_REMOTE=${remote}: the suite's case never ran, got:\n${output}`);
    }
  });

  await testUnless(IS_WINDOWS, NO_EXEC_BIT)('a file of the tool\'s name on PATH without the executable bit is not the command', () => {
    const bin = toolBin();
    fs.writeFileSync(path.join(bin, 'hugo'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const { code, output } = needsRun("needs('hugo')", bin, undefined);
    assertEq(code, 1, `the suite fails as with no hugo at all, got:\n${output}`);
    assert(output.includes('needs hugo, not installed'), `the failure names the tool, got:\n${output}`);
  });

  await test('needs() with no argument or a non-string one fails the suite even in a cloud session, never a skip', () => {
    for (const call of ['needs()', 'needs(42)', "needs('hugo', 42)"]) {
      const { code, output } = needsRun(call, toolBin(), 'true');
      assertEq(code, 1, `${call}: a programmer error fails the suite, got:\n${output}`);
      assert(!output.includes('⊘'), `${call}: never the skip path, got:\n${output}`);
      assertEq(marks(output).passed, 0, `${call}: the suite's case never ran, got:\n${output}`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
