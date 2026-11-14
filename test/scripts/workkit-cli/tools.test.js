// Tests for `workkit tools`: workkit-core's bin reads every suite the runner would
// run from the current folder and prints each needs() tool once, sorted; the global
// command runs that bin with node at the repo root, before any npm install. The shared
// prologue of the workflow/workkit.sh suites is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, mkTmp, run,
} = require('../../lib/harness');
const { NODE_DIR, joinPath, basePathWithout } = require('../../lib/platform');
const { cleanup, mkWorld, runCli } = require('./helpers');

const CORE_BIN = path.join(__dirname, '..', '..', '..', 'packages', 'core', 'bin', 'workkit.js');

// A suite whose outer describe takes `call` as its skip value, on its second line.
const SUITE = (call) => `const { describe, test, needs } = require('./lib/harness');
describe('x', { skip: ${call} }, () => {
  test('a case', () => {});
});
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

// Two suites naming hugo, a suite under src/, a mod suite naming chrome, and a helper under test/lib/.
const TWO_HUGO = {
  'test/a.test.js': SUITE("needs('hugo', 'ffmpeg')"),
  'test/deep/b.test.js': SUITE('needs("hugo")'),
  'src/checks/d.test.js': SUITE("needs('src-tool')"),
  'test/mods/c.test.ts': "import { needs } from 'workkit-core/test';\nneeds('chrome');\n",
  'test/lib/seam.js': "const { needs } = require('./harness');\nneeds('seam-only');\n",
};

// One real needs('hugo') beside needs( text in comments, strings, templates and a regex, and a division.
const NOT_CODE = [
  "const { describe, test, needs } = require('./lib/harness');",
  '// needs(x) is commented out',
  "/* needs(x)\n   needs('block-only') */",
  "const single = 'needs(tool) needs(\\'fixture-only\\')';",
  'const double = "needs(tool) needs(\'fixture-only\')";',
  "const template = `needs(tool)\nneeds('fixture-only')`;",
  "const re = /needs(x)'/;",
  'const half = a / 2;',
  "describe('x', { skip: needs('hugo') }, () => {",
  "  test('a case', () => {});",
  '});',
  '',
].join('\n');

// One real needs('hugo') beside needs( regexes after await, throw and void, and needs defined as a function and a method.
const NOT_CALLS = [
  "const { describe, test } = require('./lib/harness');",
  'function needs(x) { return x; }',
  'const helper = { needs(x) { return x; } };',
  "const viaAwait = async (s) => await /needs(x)'/.test(s);",
  'const viaThrow = () => { throw /needs(y)/; };',
  "const viaVoid = void /needs(z)'/;",
  "describe('x', { skip: needs('hugo') }, () => {",
  "  test('a case', () => {});",
  '});',
  '',
].join('\n');

// A regex literal holding a comment opener, on a line before a real needs('ffmpeg').
const REGEX_OPENER = `const { describe, test, needs } = require('./lib/harness');
const re = /[/*]/;
describe('x', { skip: needs('ffmpeg') }, () => {
  test('a case', () => {});
});
`;

// A needs('hugo') on the line of a division after a postfix `++`.
const AFTER_STEP = `const { describe, test, needs } = require('./lib/harness');
let i = 0;
const half = i++ / 2; describe('x', { skip: needs('hugo') }, () => {
  test('a case', () => {});
});
`;

// A suite whose one case, under a plain describe, takes needs('hugo') as its skip value.
const CASE_SKIP = `const { describe, test, needs } = require('./lib/harness');
describe('x', () => {
  test('a case', { skip: needs('hugo') }, () => {});
});
`;

const BAD = path.join('test', 'sub', 'bad.test.js');
const literalOnly = (line) => `✖ tools: ${BAD}:${line}: needs() takes string literals only`;

describe('workkit-core bin: tools', () => {
  test('two suites naming hugo print it once; every suite tool, under src/ and mod, sorted one per line; a helper unread', () => {
    const root = mkSuites(TWO_HUGO);
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'each suite tool once, sorted, and nothing from test/lib/seam.js').toBe('chrome\nffmpeg\nhugo\nsrc-tool\n');
  });

  test('a needs( in a comment or a string, template included, is never listed and never fails: only the real call prints', () => {
    const root = mkSuites({ 'test/a.test.js': NOT_CODE });
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the one call in code, nothing from the comments or strings').toBe('hugo\n');
  });

  test('a regex after await, throw or void, and a needs function or method definition, are no call: only the real call prints', () => {
    const root = mkSuites({ 'test/a.test.js': NOT_CALLS });
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the one call, nothing from the regexes or the definitions').toBe('hugo\n');
  });

  test('a regex literal holding a comment opener on a line before a skip option\'s needs() leaves that needs() read', () => {
    const root = mkSuites({ 'test/a.test.js': REGEX_OPENER });
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the call after the regex').toBe('ffmpeg\n');
  });

  test('a needs() after a division by a postfix ++ on its line is read', () => {
    const root = mkSuites({ 'test/a.test.js': AFTER_STEP });
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the call after the division').toBe('hugo\n');
  });

  test('a needs() given as the skip value of a describe and of a case is read in each', () => {
    const root = mkSuites({ 'test/a.test.js': SUITE("needs('ffmpeg')"), 'test/b.test.js': CASE_SKIP });
    const { code, out, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the describe\'s tool and the case\'s').toBe('ffmpeg\nhugo\n');
  });

  test('no needs() in any suite: prints nothing, exit 0', () => {
    const root = mkSuites({ 'test/a.test.js': SUITE('void 0') });
    const { code, said } = coreBin(root, ['tools']);
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(said, 'nothing printed').toBe('');
  });

  test('a needs() argument that is not a quoted string literal exits 1 naming its file:line', () => {
    for (const call of ['needs(tool)', 'needs(`hugo`)', "needs('hugo', tool)"]) {
      const root = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')"), [BAD]: SUITE(call) });
      const { code, said } = coreBin(root, ['tools']);
      expect(code, `${call}: exit 1, got: ${said}`).toBe(1);
      expect(said.split(/\r?\n/).includes(literalOnly(2)), `${call}: the file:line error, got: ${said}`).toBeTruthy();
    }
  });

  test('the bin with an unknown verb exits 2 and names its three verbs, test, tools and convert', () => {
    const root = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") });
    const { code, said } = coreBin(root, ['setup']);
    expect(code, `exit 2, got: ${said}`).toBe(2);
    expect(/\btest\b/.test(said) && /\btools\b/.test(said) && /\bconvert\b/.test(said), `names test, tools and convert, got: ${said}`).toBeTruthy();
    expect(!said.split(/\r?\n/).includes('hugo'), `no tool list printed, got: ${said}`).toBeTruthy();
  });
});

describe('workkit tools: the global command', () => {
  // The nested folder's own list would be nested-only alone.
  test('from a nested folder with no package.json of its own, in a repo with no npm install: prints the root\'s list, the nested folder\'s suites among it', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({
      'test/a.test.js': SUITE("needs('hugo')"),
      'packages/foo/test/x.test.js': SUITE("needs('nested-only')"),
    }, { git: true });
    const { code, out, said } = runCli(world, ['tools'], {
      cwd: path.join(repo, 'packages', 'foo'), env: { PATH: joinPath(NODE_DIR, world.env.PATH) },
    });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the root\'s suites, read without node_modules').toBe('hugo\nnested-only\n');
    cleanup(world.root); cleanup(repo);
  });

  test('outside any git repo: reads the current folder', () => {
    const world = mkWorld({ claude: false });
    const dir = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") });
    const { code, out, said } = runCli(world, ['tools'], {
      cwd: dir, env: { PATH: joinPath(NODE_DIR, world.env.PATH), GIT_CEILING_DIRECTORIES: path.dirname(dir) },
    });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    expect(out, 'the current folder\'s suites').toBe('hugo\n');
    cleanup(world.root); cleanup(dir);
  });

  test('a non-literal needs() argument: the global command exits 1 with the bin\'s file:line error', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ [BAD]: SUITE('needs(tool)') }, { git: true });
    const { code, said } = runCli(world, ['tools'], { cwd: repo, env: { PATH: joinPath(NODE_DIR, world.env.PATH) } });
    expect(code, `exit 1, got: ${said}`).toBe(1);
    expect(stripVTControlCharacters(said).split(/\r?\n/).includes(literalOnly(2)), `the file:line error, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });

  test('no node on PATH: one error line, exit 1', () => {
    const world = mkWorld({ claude: false });
    const repo = mkSuites({ 'test/a.test.js': SUITE("needs('hugo')") }, { git: true });
    const noNode = basePathWithout(world.root, 'node');
    const { code, said } = runCli(world, ['tools'], { cwd: repo, env: { PATH: joinPath(world.bin, noNode) } });
    expect(code, `exit 1, got: ${said}`).toBe(1);
    const printed = stripVTControlCharacters(said).split(/\r?\n/).filter((line) => line.trim());
    expect(printed.length, `one line, got: ${said}`).toBe(1);
    expect(/\bnode\b/.test(printed[0]), `the line names node, got: ${said}`).toBeTruthy();
    cleanup(world.root); cleanup(repo);
  });
});
