// Tests for `workkit convert`, the package bin's verb that rewrites a suite in the
// kit harness's shape onto Node's own test functions in place: only a file whose
// runner function holds labels, cases and constants alone is rewritten, every other
// file is left byte for byte with the line that stopped it, and a second run changes nothing.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, mkTmp, run,
} = require('./lib/harness');
const { NODE_DIR, joinPath, basePathWithout } = require('./lib/platform');
const { aloneEnv } = require('./lib/alone-env');
const { cleanup, mkWorld, runCli } = require('./scripts/workkit-cli/helpers');

const CORE_BIN = path.join(__dirname, '..', 'packages', 'core', 'bin', 'workkit.js');
const DOOR = path.join(__dirname, '..', 'packages', 'core', 'test', 'index.js');

// A fixture's test/lib/harness.js as a repo keeps it, the door's re-export, so a
// converted fixture runs through the door's own words.
const DOOR_REEXPORT = `module.exports = require(${JSON.stringify(DOOR)});\n`;

const OLD_TAIL = [
  'module.exports = async () => {',
  '  await cases();',
  '  return summary();',
  '};',
  '',
  'if (require.main === module) selfRun(module.exports);',
  '',
];

// Two groups of two awaited cases each.
const TWO_GROUPS = [
  "const { group, test, assert, summary, selfRun } = require('./lib/harness');",
  '',
  'const add = (a, b) => a + b;',
  '',
  'const cases = async () => {',
  "  group('adding');",
  '',
  "  await test('one and two make three', () => {",
  "    assert(add(1, 2) === 3, 'adds');",
  '  });',
  '',
  "  await test('zero changes nothing', () => {",
  "    assert(add(5, 0) === 5, 'zero adds nothing');",
  '  });',
  '',
  "  group('ordering');",
  '',
  "  await test('the order does not matter', () => {",
  "    assert(add(2, 7) === add(7, 2), 'commutes');",
  '  });',
  '',
  "  await test('a negative subtracts', () => {",
  "    assert(add(4, -1) === 3, 'subtracts');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

// Every mapped word once, a constant among the cases, the require over three lines.
const MAPPING = [
  'const {',
  '  group, test, assert, assertEq, skip, testUnless, summary, selfRun,',
  "} = require('./lib/harness');",
  '',
  'const ODD = process.pid % 2 === 1;',
  'const double = (n) => n * 2;',
  '',
  'const cases = async () => {',
  "  group('mapping');",
  '',
  '  const base = 4;',
  '',
  "  await test('the asserts map to expect', () => {",
  "    assert(double(base) === 8, 'doubles the base');",
  "    assertEq(double(base), 8, 'eight from four');",
  '  });',
  '',
  "  skip('a skipped case', 'no widget on this machine');",
  '',
  "  await testUnless(ODD, 'odd pids only')('a gated case', () => {",
  "    assertEq(double(1), 2, 'two from one');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

// A case whose line divides after a postfix `++`, an assertEq after it.
const STEP_DIVIDES = [
  "const { group, test, assertEq, summary, selfRun } = require('./lib/harness');",
  '',
  'const cases = async () => {',
  "  group('steps');",
  "  await test('a step before a division', () => {",
  '    let count = 2;',
  '    let total = 0;',
  "    total = count++ / 2; assertEq(total, 1, 'half the count');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

// A statement that is no constant sits between two cases, on line 10.
const BETWEEN = [
  "const { group, test, assert, summary, selfRun } = require('./lib/harness');",
  '',
  'const cases = async () => {',
  "  group('state');",
  '',
  "  await test('first case', () => {",
  "    assert(1 + 1 === 2, 'sums');",
  '  });',
  '',
  "  process.env.FIXTURE_STATE = 'set';",
  '',
  "  await test('second case', () => {",
  "    assert(process.env.FIXTURE_STATE === 'set', 'set between');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

const IN_LOOP = [
  "const { group, test, assert, summary, selfRun } = require('./lib/harness');",
  '',
  'const cases = async () => {',
  "  group('loop');",
  '',
  '  for (const n of [1, 2]) {',
  '    await test(`case ${n}`, () => {',
  "      assert(n > 0, 'positive');",
  '    });',
  '  }',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

const IN_HELPER = [
  "const { group, test, assert, summary, selfRun } = require('./lib/harness');",
  '',
  'const named = async (name) => {',
  '  await test(name, () => {',
  "    assert(name.length > 0, 'named');",
  '  });',
  '};',
  '',
  'const cases = async () => {',
  "  group('helper');",
  '',
  "  await named('first');",
  "  await named('second');",
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

const ON_DOOR = [
  "const { describe, test, expect } = require('./lib/harness');",
  '',
  "describe('already on the door', () => {",
  "  test('a case', () => {",
  '    expect(1 + 1).toBe(2);',
  '  });',
  '});',
  '',
].join('\n');

const ON_NODE_TEST = [
  "const { describe, test } = require('node:test');",
  "const assert = require('node:assert');",
  '',
  "describe('already on node:test', () => {",
  "  test('a case', () => {",
  '    assert.strictEqual(1 + 1, 2);',
  '  });',
  '});',
  '',
].join('\n');

// Two testUnless aliases, one beside the runner and one in it, the outer on a `||`
// condition, each under a comment and between blank lines.
const ALIASED = [
  "const { group, test, assert, testUnless, summary, selfRun } = require('./lib/harness');",
  '',
  "const IS_A = process.env.FIXTURE_A === '1';",
  "const IS_B = process.env.FIXTURE_B === '1';",
  'const ODD = process.pid % 2 === 1;',
  '',
  '// Neither flag may be set for the outer case.',
  "const lockTest = testUnless(IS_A || IS_B, 'needs neither flag');",
  '',
  'const cases = async () => {',
  "  group('aliases');",
  '',
  '  // Only an even pid runs the inner case.',
  "  const runTest = testUnless(ODD, 'odd pids only');",
  '',
  "  await lockTest('a case on the outer alias', () => {",
  "    assert(!IS_A, 'no flag a');",
  '  });',
  '',
  "  await runTest('a case on the inner alias', () => {",
  "    assert(!ODD, 'an even pid');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

// A testUnless alias imported from a helper file, beside that helper.
const IMPORTED_ALIAS = [
  "const { group, assert, summary, selfRun } = require('./lib/harness');",
  "const { pidTest } = require('./lib/pid-test');",
  '',
  'const cases = async () => {',
  "  group('an imported alias');",
  '',
  "  await pidTest('a case on a helper alias', () => {",
  "    assert(process.pid > 0, 'a pid');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');
const PID_TEST_HELPER = [
  "const { testUnless } = require('./harness');",
  '',
  "module.exports = { pidTest: testUnless(process.platform === 'win32', 'no pid on Windows') };",
  '',
].join('\n');

// One case gated by testUnless on the constant MISSING, whose value is `missing`.
const GATED = (missing) => [
  "const { group, test, assert, testUnless, summary, selfRun } = require('./lib/harness');",
  '',
  `const MISSING = ${missing};`,
  '',
  'const cases = async () => {',
  "  group('gated');",
  '',
  "  await testUnless(MISSING, 'needs the tool')('the gated case', () => {",
  "    assert(1 + 1 === 2, 'sums');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');

// One case whose assertEq first argument is a template with a template nested in its
// placeholder, a comma between that inner template's placeholders; `rest` follows it.
const NESTED_TEMPLATE = (rest) => [
  "const { group, test, assertEq, summary, selfRun } = require('./lib/harness');",
  '',
  'const cases = async () => {',
  "  group('nested');",
  '',
  "  await test('a template nested in a placeholder', () => {",
  "    const rows = ['a', 'b'];",
  `    assertEq(\`\${rows.map((row) => \`\${row},\${row}\`).join('')}\`, ${rest});`,
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');
// No message, and a wanted value the rows never equal.
const NESTED_BARE = NESTED_TEMPLATE("'not the rows'");
const NESTED_WITH_MESSAGE = NESTED_TEMPLATE("'not the rows', 'rows joined'");

// A testUnless alias declared and used in the first group, its condition ODD declared
// there too or at the top; the second group's one case is on the alias or a plain
// test, and no case body reads ODD.
const ALIAS_IN_GROUPS = ({ topLevelOdd, secondOnAlias }) => [
  "const { group, test, assert, testUnless, summary, selfRun } = require('./lib/harness');",
  '',
  ...(topLevelOdd ? ['const ODD = process.pid % 2 === 1;', ''] : []),
  'const cases = async () => {',
  "  group('first');",
  '',
  ...(topLevelOdd ? [] : ['  const ODD = process.pid % 2 === 1;']),
  "  const oddTest = testUnless(ODD, 'odd pids only');",
  '',
  "  await oddTest('a case in the first group', () => {",
  "    assert(1 + 1 === 2, 'sums');",
  '  });',
  '',
  "  group('second');",
  '',
  `  await ${secondOnAlias ? 'oddTest' : 'test'}('a case in the second group', () => {`,
  "    assert(2 + 2 === 4, 'sums again');",
  '  });',
  '};',
  '',
  ...OLD_TAIL,
].join('\n');
const ALIAS_ACROSS_GROUPS = ALIAS_IN_GROUPS({ topLevelOdd: false, secondOnAlias: true });
const ALIAS_IN_FIRST_GROUP = ALIAS_IN_GROUPS({ topLevelOdd: false, secondOnAlias: false });
const ALIAS_ON_TOP_CONSTANT = ALIAS_IN_GROUPS({ topLevelOdd: true, secondOnAlias: true });

const crlf = (text) => text.replace(/\n/g, '\r\n');

// A scratch folder holding `files` (path from it to text); returns the folder.
const mkSuites = (files) => {
  const root = mkTmp('convert-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
};

const read = (root, rel) => fs.readFileSync(path.join(root, rel));
const readText = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Every file under `root` as path to bytes, so a run that writes nothing leaves it equal.
const snapshot = (root) => Object.fromEntries(fs.readdirSync(root, { recursive: true })
  .filter((rel) => fs.statSync(path.join(root, rel)).isFile())
  .sort()
  .map((rel) => [rel, fs.readFileSync(path.join(root, rel))]));
const sameBytes = (a, b) => Object.keys(a).join('\n') === Object.keys(b).join('\n')
  && Object.keys(a).every((rel) => a[rel].equals(b[rel]));

// A scratch parent holding `repo/` (the start folder: a convertible suite, a helper,
// a test/ folder) and, beside it, a suite outside the start folder.
const mkRefusals = () => {
  const parent = mkSuites({
    'repo/test/two.test.js': TWO_GROUPS,
    'repo/test/lib/seam.js': "module.exports = { seam: true };\n",
    'outside.test.js': TWO_GROUPS,
  });
  return { parent, repo: path.join(parent, 'repo') };
};

// The four paths no suite matches: a folder, a non-suite file, a missing file, one outside.
const NO_SUITE_ARGS = ['test', 'test/lib/seam.js', 'test/missing.test.js', '../outside.test.js'];

// `workkit convert` run from `root` with `args`: its exit, every printed line
// (stdout's and stderr's, colours stripped, blanks dropped) and the whole output.
const convert = (root, args) => {
  const res = run(process.execPath, [CORE_BIN, 'convert', ...args], { cwd: root });
  const said = stripVTControlCharacters(res.output);
  return { code: res.status, lines: said.split(/\r?\n/).filter((line) => line.trim()), said };
};

// The names the require line of the converted `text` destructures, sorted.
const requiredNames = (text) => {
  const line = text.match(/const \{([^}]*)\} = require\('\.\/lib\/harness'\)/);
  expect(line, `a destructured require of ./lib/harness, got:\n${text}`).toBeTruthy();
  return line[1].split(',').map((name) => name.trim()).filter(Boolean).sort();
};

// Each `ok`/`not ok` line of a TAP run as `<indent> <ok|not ok> <name>`.
const tapResults = (output) => output.split(/\r?\n/)
  .map((line) => line.match(/^( *)(ok|not ok) \d+ - (.*)$/))
  .filter(Boolean)
  .map(([, indent, verdict, name]) => `${indent.length} ${verdict} ${name}`);

describe('workkit convert: a convertible suite', () => {
  test('two groups of two awaited cases become two describe blocks of two test calls, on the door\'s names, with no export, summary or selfRun', () => {
    const root = mkSuites({ 'test/two.test.js': TWO_GROUPS, 'test/lib/harness.js': DOOR_REEXPORT });
    const { code, said } = convert(root, ['test/two.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const text = readText(root, 'test/two.test.js');
    expect(requiredNames(text).join(', '), `the door's names the file uses, got:\n${text}`).toBe('describe, expect, test');
    expect(!text.includes('module.exports'), `no export, got:\n${text}`).toBeTruthy();
    expect(!text.includes('summary'), `no summary, got:\n${text}`).toBeTruthy();
    expect(!text.includes('selfRun'), `no selfRun, got:\n${text}`).toBeTruthy();
    const ran = run(process.execPath, ['--test-reporter=tap', 'test/two.test.js'], { cwd: root, env: aloneEnv() });
    expect(ran.status, `the converted file runs green on Node's runner, got: ${ran.output}`).toBe(0);
    expect(tapResults(ran.stdout).join('\n'), 'two describe blocks, each holding its two cases').toBe([
      '4 ok one and two make three',
      '4 ok zero changes nothing',
      '0 ok adding',
      '4 ok the order does not matter',
      '4 ok a negative subtracts',
      '0 ok ordering',
    ].join('\n'));
  });

  test('assert, assertEq, skip and testUnless each map as the Spec lists, every message kept', () => {
    const root = mkSuites({ 'test/mapping.test.js': MAPPING });
    const { code, said } = convert(root, ['test/mapping.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const text = readText(root, 'test/mapping.test.js');
    for (const mapped of [
      "expect(double(base) === 8, 'doubles the base').toBeTruthy()",
      "expect(double(base), 'eight from four').toBe(8)",
      "test('a skipped case', { skip: 'no widget on this machine' })",
      "test('a gated case', { skip: ODD ? 'odd pids only' : false }, () => {",
      "expect(double(1), 'two from one').toBe(2)",
    ]) expect(text.includes(mapped), `holds ${mapped}, got:\n${text}`).toBeTruthy();
  });

  test('a division after a postfix ++, on a line with an assertEq, converts whole: no removed word left', () => {
    const root = mkSuites({ 'test/steps.test.js': STEP_DIVIDES });
    const { code, said } = convert(root, ['test/steps.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(readText(root, 'test/steps.test.js')).toBe([
      "const { describe, test, expect } = require('./lib/harness');",
      '',
      "describe('steps', () => {",
      "  test('a step before a division', () => {",
      '    let count = 2;',
      '    let total = 0;',
      "    total = count++ / 2; expect(total, 'half the count').toBe(1);",
      '  });',
      '});',
      '',
    ].join('\n'));
  });

  test('a converted suite passes node --check', () => {
    const root = mkSuites({ 'test/mapping.test.js': MAPPING });
    const { code, said } = convert(root, ['test/mapping.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(readText(root, 'test/mapping.test.js') !== MAPPING, 'the file was rewritten').toBeTruthy();
    const checked = run(process.execPath, ['--check', 'test/mapping.test.js'], { cwd: root });
    expect(checked.status, `node --check passes, got: ${checked.output}`).toBe(0);
  });
});

describe('workkit convert: a testUnless condition at run time', () => {
  test('a condition that is an empty string: the converted case runs and passes, never skipped', () => {
    const root = mkSuites({ 'test/gated.test.js': GATED("''"), 'test/lib/harness.js': DOOR_REEXPORT });
    const { code, said } = convert(root, ['test/gated.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const ran = run(process.execPath, ['--test-reporter=tap', 'test/gated.test.js'], { cwd: root, env: aloneEnv() });
    expect(ran.status, `the converted file runs green, got: ${ran.output}`).toBe(0);
    expect(tapResults(ran.stdout).join('\n'), `the case ran, got: ${ran.stdout}`).toBe(['4 ok the gated case', '0 ok gated'].join('\n'));
    expect(ran.stdout.split(/\r?\n/).filter((line) => /^# (pass|skipped) /.test(line)).join('\n'), 'one pass, none skipped').toBe('# pass 1\n# skipped 0');
  });

  test('a true condition: the converted case is skipped with its reason', () => {
    const root = mkSuites({ 'test/gated.test.js': GATED("'no tool here'"), 'test/lib/harness.js': DOOR_REEXPORT });
    const { code, said } = convert(root, ['test/gated.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const ran = run(process.execPath, ['--test-reporter=tap', 'test/gated.test.js'], { cwd: root, env: aloneEnv() });
    expect(ran.status, `a skip is no failure, got: ${ran.output}`).toBe(0);
    expect(tapResults(ran.stdout).join('\n'), `skipped with the reason, got: ${ran.stdout}`).toBe(['4 ok the gated case # SKIP needs the tool', '0 ok gated'].join('\n'));
    expect(ran.stdout.split(/\r?\n/).filter((line) => /^# (pass|skipped) /.test(line)).join('\n'), 'none passed, one skipped').toBe('# pass 0\n# skipped 1');
  });

  test('a template nested in a placeholder: left and listed naming the nested template, or converted to an expect whose matcher runs', () => {
    const root = mkSuites({ 'test/nested.test.js': NESTED_BARE, 'test/lib/harness.js': DOOR_REEXPORT });
    const { code, lines, said } = convert(root, ['test/nested.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    if (readText(root, 'test/nested.test.js') === NESTED_BARE) {
      const left = lines.find((line) => /^left test\/nested\.test\.js:\d+ \S/.test(line));
      expect(left, `listed as left with its line, got: ${said}`).toBeTruthy();
      expect(/nested/i.test(left) && /template/i.test(left), `the why names a nested template, got: ${left}`).toBeTruthy();
      return;
    }
    expect(lines.some((line) => line.startsWith('converted test/nested.test.js (')), `listed as converted, got: ${said}`).toBeTruthy();
    const ran = run(process.execPath, ['--test-reporter=tap', 'test/nested.test.js'], { cwd: root, env: aloneEnv() });
    expect(ran.status, `the wanted value never matches, so the matcher fails the run, got: ${ran.output}\n${readText(root, 'test/nested.test.js')}`).toBe(1);
  });

  test('a nested template in an assertEq with a message: the suite is left byte for byte and listed', () => {
    const root = mkSuites({ 'test/nested.test.js': NESTED_WITH_MESSAGE });
    const { code, lines, said } = convert(root, ['test/nested.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(readText(root, 'test/nested.test.js'), 'left as it was').toBe(NESTED_WITH_MESSAGE);
    expect(lines.some((line) => /^left test\/nested\.test\.js:\d+ \S/.test(line)), `listed as left with its line and why, got: ${said}`).toBeTruthy();
  });
});

describe('workkit convert: a file it leaves', () => {
  test('a statement between two cases that is no constant: the file is left byte for byte and listed at its line with why', () => {
    const root = mkSuites({ 'test/between.test.js': BETWEEN });
    const before = read(root, 'test/between.test.js');
    const { code, lines, said } = convert(root, ['test/between.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(read(root, 'test/between.test.js').equals(before), `left byte for byte, got:\n${readText(root, 'test/between.test.js')}`).toBeTruthy();
    const prefix = 'left test/between.test.js:10 ';
    expect(lines.some((line) => line.startsWith(prefix) && line.length > prefix.length), `a "${prefix}<why>" line, got: ${said}`).toBeTruthy();
  });

  test('cases in a loop or in a helper function: each file is left byte for byte and listed', () => {
    const root = mkSuites({ 'test/helper.test.js': IN_HELPER, 'test/loop.test.js': IN_LOOP });
    const { code, lines, said } = convert(root, ['test/helper.test.js', 'test/loop.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    for (const [rel, text] of [['test/helper.test.js', IN_HELPER], ['test/loop.test.js', IN_LOOP]]) {
      expect(readText(root, rel), `${rel} left as it was`).toBe(text);
      const listed = new RegExp(`^left ${rel.replace(/\./g, '\\.')}:\\d+ \\S`);
      expect(lines.some((line) => listed.test(line)), `${rel} listed as left with its line and why, got: ${said}`).toBeTruthy();
    }
  });

  test('a file already on Node\'s functions, through the door or node:test: left untouched and never listed as converted', () => {
    const root = mkSuites({ 'test/door.test.js': ON_DOOR, 'test/node.test.js': ON_NODE_TEST });
    const { code, lines, said } = convert(root, ['test/door.test.js', 'test/node.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(readText(root, 'test/door.test.js'), 'the door suite untouched').toBe(ON_DOOR);
    expect(readText(root, 'test/node.test.js'), 'the node:test suite untouched').toBe(ON_NODE_TEST);
    expect(!lines.some((line) => line.startsWith('converted ')), `nothing listed as converted, got: ${said}`).toBeTruthy();
  });
});

describe('workkit convert: runs and lines', () => {
  test('run twice: the second run changes no file', () => {
    const root = mkSuites({ 'test/mapping.test.js': MAPPING, 'test/two.test.js': TWO_GROUPS });
    const args = ['test/mapping.test.js', 'test/two.test.js'];
    const first = convert(root, args);
    expect(first.lines.includes('converted test/two.test.js (4 cases)'), `the first run converts, got: ${first.said}`).toBeTruthy();
    const once = args.map((rel) => read(root, rel));
    const second = convert(root, args);
    expect(second.code, `the second run exits 0, got: ${second.said}`).toBe(0);
    args.forEach((rel, i) => expect(read(root, rel).equals(once[i]), `${rel} unchanged by the second run, got:\n${readText(root, rel)}`).toBeTruthy());
  });

  test('no path converts every suite the runner finds, and nothing under node_modules', () => {
    const root = mkSuites({
      'test/a.test.js': TWO_GROUPS,
      'test/deep/b.test.js': TWO_GROUPS,
      'node_modules/pkg/c.test.js': TWO_GROUPS,
    });
    const { code, lines, said } = convert(root, []);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect([...lines].sort().join('\n'), 'one line per suite found, none for node_modules').toBe([
      'converted test/a.test.js (4 cases)',
      'converted test/deep/b.test.js (4 cases)',
    ].join('\n'));
    expect(readText(root, 'node_modules/pkg/c.test.js'), 'the node_modules file untouched').toBe(TWO_GROUPS);
  });

  test('one line per file, converted with its case count or left with its line, and exit 0 though a file was left', () => {
    const root = mkSuites({ 'test/between.test.js': BETWEEN, 'test/two.test.js': TWO_GROUPS });
    const { code, lines, said } = convert(root, ['test/between.test.js', 'test/two.test.js']);
    expect(code, `exit 0 whatever it left, got: ${said}`).toBe(0);
    expect(lines.length, `one line per file, got: ${said}`).toBe(2);
    expect(lines.includes('converted test/two.test.js (4 cases)'), `the converted line, got: ${said}`).toBeTruthy();
    expect(lines.some((line) => /^left test\/between\.test\.js:10 \S/.test(line)), `the left line, got: ${said}`).toBeTruthy();
  });

  test('a suite of one case: its converted line counts 1 case', () => {
    const root = mkSuites({ 'test/one.test.js': GATED("''") });
    const { code, lines, said } = convert(root, ['test/one.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/one.test.js (1 case)'), `the singular count, got: ${said}`).toBeTruthy();
  });
});

describe('workkit convert: testUnless aliases', () => {
  test('a testUnless alias in the file, beside the runner or in it: each call maps to test with its skip, the alias line is gone, its comment stays and no blank run is left', () => {
    const root = mkSuites({ 'test/aliased.test.js': ALIASED });
    const { code, lines, said } = convert(root, ['test/aliased.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/aliased.test.js (2 cases)'), `converted with its two cases, got: ${said}`).toBeTruthy();
    const text = readText(root, 'test/aliased.test.js');
    for (const mapped of [
      [
        'const ODD = process.pid % 2 === 1;',
        '',
        '// Neither flag may be set for the outer case.',
        '',
        "describe('aliases', () => {",
        '',
      ].join('\n'),
      [
        '  // Only an even pid runs the inner case.',
        '',
        "  test('a case on the outer alias', { skip: (IS_A || IS_B) ? 'needs neither flag' : false }, () => {",
        '',
      ].join('\n'),
      "test('a case on the inner alias', { skip: ODD ? 'odd pids only' : false }, () => {",
    ]) expect(text.includes(mapped), `holds ${JSON.stringify(mapped)}, got:\n${text}`).toBeTruthy();
    for (const gone of ['lockTest', 'runTest', 'testUnless']) expect(!text.includes(gone), `no ${gone} left, got:\n${text}`).toBeTruthy();
  });

  test('a testUnless alias imported from a helper file: the suite is left byte for byte and listed', () => {
    const root = mkSuites({ 'test/imported.test.js': IMPORTED_ALIAS, 'test/lib/pid-test.js': PID_TEST_HELPER });
    const { code, lines, said } = convert(root, ['test/imported.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(readText(root, 'test/imported.test.js'), 'the suite left as it was').toBe(IMPORTED_ALIAS);
    expect(readText(root, 'test/lib/pid-test.js'), 'the helper untouched').toBe(PID_TEST_HELPER);
    expect(lines.some((line) => /^left test\/imported\.test\.js:\d+ \S/.test(line)), `listed as left with its line and why, got: ${said}`).toBeTruthy();
  });

  test('a testUnless alias on a first-group constant, used in the second group: the suite is left byte for byte and listed naming the constant', () => {
    const root = mkSuites({ 'test/across.test.js': ALIAS_ACROSS_GROUPS });
    const before = read(root, 'test/across.test.js');
    const { code, lines, said } = convert(root, ['test/across.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(read(root, 'test/across.test.js').equals(before), `left byte for byte, got:\n${readText(root, 'test/across.test.js')}`).toBeTruthy();
    const left = lines.find((line) => /^left test\/across\.test\.js:\d+ \S/.test(line));
    expect(left, `listed as left with its line and why, got: ${said}`).toBeTruthy();
    expect(/\bODD\b/.test(left), `the why names ODD, got: ${left}`).toBeTruthy();
  });

  test('a testUnless alias on a first-group constant, used only in the first group: it converts', () => {
    const root = mkSuites({ 'test/first.test.js': ALIAS_IN_FIRST_GROUP });
    const { code, lines, said } = convert(root, ['test/first.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/first.test.js (2 cases)'), `converted with its two cases, got: ${said}`).toBeTruthy();
    const text = readText(root, 'test/first.test.js');
    for (const mapped of [
      "test('a case in the first group', { skip: ODD ? 'odd pids only' : false }, () => {",
      "test('a case in the second group', () => {",
    ]) expect(text.includes(mapped), `holds ${mapped}, got:\n${text}`).toBeTruthy();
  });

  test('a testUnless alias on a top-level constant, used in two groups: it converts', () => {
    const root = mkSuites({ 'test/top.test.js': ALIAS_ON_TOP_CONSTANT });
    const { code, lines, said } = convert(root, ['test/top.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/top.test.js (2 cases)'), `converted with its two cases, got: ${said}`).toBeTruthy();
    const text = readText(root, 'test/top.test.js');
    for (const mapped of [
      "test('a case in the first group', { skip: ODD ? 'odd pids only' : false }, () => {",
      "test('a case in the second group', { skip: ODD ? 'odd pids only' : false }, () => {",
    ]) expect(text.includes(mapped), `holds ${mapped}, got:\n${text}`).toBeTruthy();
  });
});

describe('workkit convert: CRLF line ends', () => {
  test('a CRLF suite converts with CRLF on every line', () => {
    const root = mkSuites({ 'test/two.test.js': crlf(TWO_GROUPS) });
    const { code, lines, said } = convert(root, ['test/two.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/two.test.js (4 cases)'), `converted, got: ${said}`).toBeTruthy();
    const text = readText(root, 'test/two.test.js');
    expect(text.includes("describe('adding', "), `rewritten onto describe, got:\n${JSON.stringify(text)}`).toBeTruthy();
    expect(!/(^|[^\r])\n/.test(text), `no bare LF, got:\n${JSON.stringify(text)}`).toBeTruthy();
  });

  test('a CRLF suite that is left keeps its exact bytes', () => {
    const root = mkSuites({ 'test/between.test.js': crlf(BETWEEN) });
    const before = read(root, 'test/between.test.js');
    const { code, lines, said } = convert(root, ['test/between.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(read(root, 'test/between.test.js').equals(before), `left byte for byte, got:\n${JSON.stringify(readText(root, 'test/between.test.js'))}`).toBeTruthy();
    expect(lines.some((line) => /^left test\/between\.test\.js:10 \S/.test(line)), `listed at line 10, got: ${said}`).toBeTruthy();
  });
});

describe('workkit convert: paths', () => {
  test('a path written with \\ is read as written with /', () => {
    const root = mkSuites({ 'test/two.test.js': TWO_GROUPS });
    const { code, lines, said } = convert(root, ['test\\two.test.js']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(lines.includes('converted test/two.test.js (4 cases)'), `converted, got: ${said}`).toBeTruthy();
    expect(readText(root, 'test/two.test.js') !== TWO_GROUPS, 'the file was rewritten').toBeTruthy();
  });

  test('a folder, a non-suite file, a missing file and a file outside the start folder: each is No suite matches <arg>, exit 1, nothing written', () => {
    for (const arg of NO_SUITE_ARGS) {
      const { parent, repo } = mkRefusals();
      const before = snapshot(parent);
      const { code, lines, said } = convert(repo, [arg]);
      expect(code, `${arg}: exit 1, got: ${said}`).toBe(1);
      expect(lines.includes(`No suite matches ${arg}`), `${arg}: the refusal line, got: ${said}`).toBeTruthy();
      expect(sameBytes(snapshot(parent), before), `${arg}: no file changed`).toBeTruthy();
    }
  });

  test('a good path before a refused one: the refusal stands and the good file is not written either', () => {
    for (const arg of NO_SUITE_ARGS) {
      const { parent, repo } = mkRefusals();
      const before = snapshot(parent);
      const { code, lines, said } = convert(repo, ['test/two.test.js', arg]);
      expect(code, `${arg}: exit 1, got: ${said}`).toBe(1);
      expect(lines.includes(`No suite matches ${arg}`), `${arg}: the refusal line, got: ${said}`).toBeTruthy();
      expect(sameBytes(snapshot(parent), before), `${arg}: no file changed, test/two.test.js included`).toBeTruthy();
    }
  });
});

describe('workkit convert: the global command', () => {
  test('workflow/workkit.sh convert <file> in a repo converts it as the package bin does', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ 'test/two.test.js': TWO_GROUPS });
    run('git', ['init', '-q'], { cwd: repo });
    const { code, said } = runCli(world, ['convert', 'test/two.test.js'], { cwd: repo, env: { PATH: joinPath(NODE_DIR, world.env.PATH) } });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(stripVTControlCharacters(said).split(/\r?\n/).includes('converted test/two.test.js (4 cases)'), `the converted line, got: ${said}`).toBeTruthy();
    const twin = mkSuites({ 'test/two.test.js': TWO_GROUPS });
    expect(convert(twin, ['test/two.test.js']).code, 'the package bin converts the twin').toBe(0);
    expect(readText(repo, 'test/two.test.js'), 'the same file the package bin writes').toBe(readText(twin, 'test/two.test.js'));
    cleanup(world.root);
  });

  test('from a nested folder of a repo: a path written from the repo root is found and converted', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ 'test/two.test.js': TWO_GROUPS, 'packages/foo/index.js': 'module.exports = {};\n' });
    run('git', ['init', '-q'], { cwd: repo });
    const { code, said } = runCli(world, ['convert', 'test/two.test.js'], {
      cwd: path.join(repo, 'packages', 'foo'), env: { PATH: joinPath(NODE_DIR, world.env.PATH) },
    });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(stripVTControlCharacters(said).split(/\r?\n/).includes('converted test/two.test.js (4 cases)'), `the converted line, got: ${said}`).toBeTruthy();
    expect(readText(repo, 'test/two.test.js').includes("describe('adding', "), `the root's suite rewritten, got:\n${readText(repo, 'test/two.test.js')}`).toBeTruthy();
    cleanup(world.root);
  });

  test('no node on PATH: one convert: error line naming node, exit 1, the file untouched', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ 'test/two.test.js': TWO_GROUPS });
    run('git', ['init', '-q'], { cwd: repo });
    const noNode = basePathWithout(world.root, 'node');
    const { code, said } = runCli(world, ['convert', 'test/two.test.js'], { cwd: repo, env: { PATH: joinPath(world.bin, noNode) } });
    expect(code, `exit 1, got: ${said}`).toBe(1);
    const printed = stripVTControlCharacters(said).split(/\r?\n/).filter((line) => line.trim());
    expect(printed.length, `one line, got: ${said}`).toBe(1);
    expect(printed[0].includes('convert:') && /\bnode\b/.test(printed[0]), `a convert: line naming node, got: ${said}`).toBeTruthy();
    expect(readText(repo, 'test/two.test.js'), 'the file untouched').toBe(TWO_GROUPS);
    cleanup(world.root);
  });
});
