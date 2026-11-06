// Tests for `workkit tools`: workkit-core's bin reads every suite the runner would
// run from the current folder and prints each needs() tool once, sorted; the global
// command runs that bin with node at the repo root, before any npm install. The shared
// prologue of the workflow/workkit.sh suites is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, run,
} = require('../../lib/harness');
const { NODE_DIR, joinPath, basePathWithout } = require('../../lib/platform');
const { cleanup, mkWorld, runCli } = require('./helpers');

const CORE_BIN = path.join(__dirname, '..', '..', '..', 'packages', 'core', 'bin', 'workkit.js');

// A suite whose top calls `call`, on its third line.
const SUITE = (call) => `const { needs, test, summary } = require('./lib/harness');
module.exports = async () => {
  ${call};
  await test('a case', () => {});
  return summary();
};
`;

// A scratch folder holding `files` (relative path to text), a git repo when `git` is set.
const mkSuites = (files, { git = false } = {}) => {
  const root = mkTmp('tools-');
  if (git) run('git', ['init', '-q'], { cwd: root });
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
};

// The bin run by node from `cwd` with `args`: its exit, stdout and whole output, colours stripped.
const coreBin = (cwd, args) => {
  const res = run(process.execPath, [CORE_BIN, ...args], { cwd });
  return { code: res.status, out: stripVTControlCharacters(res.stdout), said: stripVTControlCharacters(res.output) };
};

// Two suites naming hugo, a mod suite naming chrome, and a non-suite file under test/.
const TWO_HUGO = {
  'test/a.test.js': SUITE("needs('hugo', 'ffmpeg')"),
  'test/deep/b.test.js': SUITE('needs("hugo")'),
  'test/mods/c.test.ts': "import { needs } from 'workkit-core/test';\nneeds('chrome');\n",
  'test/lib/seam.js': "const { needs } = require('./harness');\nneeds('seam-only');\n",
};

// One real needs('hugo') beside needs( text in comments, strings, templates and a regex, and a division.
const NOT_CODE = [
  "const { needs, test, summary } = require('./lib/harness');",
  '// needs(x) is commented out',
  "/* needs(x)\n   needs('block-only') */",
  "const single = 'needs(tool) needs(\\'fixture-only\\')';",
  'const double = "needs(tool) needs(\'fixture-only\')";',
  "const template = `needs(tool)\nneeds('fixture-only')`;",
  "const re = /needs(x)'/;",
  'const half = a / 2;',
  'module.exports = async () => {',
  "  needs('hugo');",
  "  await test('a case', () => {});",
  '  return summary();',
  '};',
  '',
].join('\n');

// One real needs('hugo') beside needs( regexes after await, throw and void, and needs defined as a function and a method.
const NOT_CALLS = [
  "const { test, summary } = require('./lib/harness');",
  'function needs(x) { return x; }',
  'const helper = { needs(x) { return x; } };',
  "const viaAwait = async (s) => await /needs(x)'/.test(s);",
  'const viaThrow = () => { throw /needs(y)/; };',
  "const viaVoid = void /needs(z)'/;",
  'module.exports = async () => {',
  "  needs('hugo');",
  "  await test('a case', () => {});",
  '  return summary();',
  '};',
  '',
].join('\n');

const BAD = path.join('test', 'sub', 'bad.test.js');
const literalOnly = (line) => `✖ tools: ${BAD}:${line}: needs() takes string literals only`;

const cases = async () => {
  group('workkit-core bin: tools');

  await test('two suites naming hugo print it once; every suite tool, node and mod, sorted one per line; a non-suite file unread', () => {
    const root = mkSuites(TWO_HUGO);
    const { code, out, said } = coreBin(root, ['tools']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(out, 'chrome\nffmpeg\nhugo\n', 'each suite tool once, sorted, and nothing from test/lib/seam.js');
  });

  await test('a needs( in a comment or a string, template included, is never listed and never fails: only the real call prints', () => {
    const root = mkSuites({ 'test/a.test.js': NOT_CODE });
    const { code, out, said } = coreBin(root, ['tools']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(out, 'hugo\n', 'the one call in code, nothing from the comments or strings');
  });

  await test('a regex after await, throw or void, and a needs function or method definition, are no call: only the real call prints', () => {
    const root = mkSuites({ 'test/a.test.js': NOT_CALLS });
    const { code, out, said } = coreBin(root, ['tools']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(out, 'hugo\n', 'the one call, nothing from the regexes or the definitions');
  });

  await test('no needs() in any suite: prints nothing, exit 0', () => {
    const root = mkSuites({ 'test/a.test.js': SUITE('void 0') });
    const { code, said } = coreBin(root, ['tools']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(said, '', 'nothing printed');
  });

  await test('a needs() argument that is not a quoted string literal exits 1 naming its file:line', () => {
    for (const call of ['needs(tool)', 'needs(`hugo`)', "needs('hugo', tool)"]) {
      const root = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')"), [BAD]: SUITE(call) });
      const { code, said } = coreBin(root, ['tools']);
      assertEq(code, 1, `${call}: exit 1, got: ${said}`);
      assert(said.split(/\r?\n/).includes(literalOnly(3)), `${call}: the file:line error, got: ${said}`);
    }
  });

  await test('the bin with an unknown verb exits 2 and names both of its verbs, test and tools', () => {
    const root = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") });
    const { code, said } = coreBin(root, ['setup']);
    assertEq(code, 2, `exit 2, got: ${said}`);
    assert(/\btest\b/.test(said) && /\btools\b/.test(said), `names test and tools, got: ${said}`);
    assert(!said.split(/\r?\n/).includes('hugo'), `no tool list printed, got: ${said}`);
  });

  group('workkit tools: the global command');

  await test('from a nested folder of a repo with no npm install: prints the root\'s list, never the nested folder\'s', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({
      'test/a.test.js': SUITE("needs('hugo')"),
      'packages/foo/test/x.test.js': SUITE("needs('nested-only')"),
    }, { git: true });
    const { code, out, said } = runCli(world, ['tools'], {
      cwd: path.join(repo, 'packages', 'foo'), env: { PATH: joinPath(NODE_DIR, world.env.PATH) },
    });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(out, 'hugo\n', 'the root\'s suites, read without node_modules');
    cleanup(world.root); cleanup(repo);
  });

  await test('outside any git repo: reads the current folder', () => {
    const world = mkWorld({ claude: false });
    const dir = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") });
    const { code, out, said } = runCli(world, ['tools'], {
      cwd: dir, env: { PATH: joinPath(NODE_DIR, world.env.PATH), GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assertEq(out, 'hugo\n', 'the current folder\'s suites');
    cleanup(world.root); cleanup(dir);
  });

  await test('a non-literal needs() argument: the global command exits 1 with the bin\'s file:line error', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ [BAD]: SUITE('needs(tool)') }, { git: true });
    const { code, said } = runCli(world, ['tools'], { cwd: repo, env: { PATH: joinPath(NODE_DIR, world.env.PATH) } });
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(stripVTControlCharacters(said).split(/\r?\n/).includes(literalOnly(3)), `the file:line error, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('no node on PATH: one error line, exit 1', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") }, { git: true });
    const noNode = basePathWithout(world.root, 'node');
    const { code, said } = runCli(world, ['tools'], { cwd: repo, env: { PATH: joinPath(world.bin, noNode) } });
    assertEq(code, 1, `exit 1, got: ${said}`);
    const printed = stripVTControlCharacters(said).split(/\r?\n/).filter((line) => line.trim());
    assertEq(printed.length, 1, `one line, got: ${said}`);
    assert(/\bnode\b/.test(printed[0]), `the line names node, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
