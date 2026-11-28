// Tests for the workkit-core package as a repo installs it: `npm test` of
// `workkit test` reaches the runner through the package's bin, whole or narrowed
// to one file, the bin refuses every other verb, `workkit-core/test` gives exactly the
// door's names to `require()` and `import` alike, a packed package carries the
// kit's run.js as `workkit-core/run`, and a root run from it runs its workspace members.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, run, mkTmp,
} = require('../lib/harness');
const { NODE_DIR, SYSTEM_PATH, joinPath, RUN_JS } = require('../lib/platform');
const {
  CORE, TOTALS, skipWithoutNpm, npmIn, mkCoreRepo,
} = require('../lib/core-repo');
const { linesOf, totalsOf } = require('../lib/run-lists');

const KIT = path.join(CORE, '..', '..');
// What the kit's workflow/lib/run.js exports, sorted: the one source `workkit-core/run` must match.
const RUN_EXPORTS = Object.keys(require(RUN_JS)).sort();
// One win32 launch no file is read for: a .cmd by path through the parent's ComSpec.
const WIN32_CMD = [
  'C:\\tools\\x.cmd', ['a b'], {}, { platform: 'win32', parentEnv: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } },
];
const WIN32_LAUNCH = {
  file: 'C:\\Windows\\system32\\cmd.exe',
  args: ['/d', '/s', '/c', '"C:\\tools\\x.cmd ^"a b^""'],
  options: { argv0: '"C:\\Windows\\system32\\cmd.exe"', windowsVerbatimArguments: true },
};

/**
 * The package as npm packs it, installed into a scratch repo: packages/core, the
 * kit's LICENSE.md and workflow/lib/ copied at their real depths, so the
 * prepack copies run.
 * @returns {string} the scratch repo the tarball is installed in
 */
const packedRepo = () => {
  const kit = mkTmp('core-pack-');
  const core = path.join(kit, 'packages', 'core');
  fs.cpSync(CORE, core, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' });
  fs.copyFileSync(path.join(KIT, 'LICENSE.md'), path.join(kit, 'LICENSE.md'));
  fs.cpSync(path.join(KIT, 'workflow', 'lib'), path.join(kit, 'workflow', 'lib'), { recursive: true });
  const packs = mkTmp('core-tgz-');
  const packed = npmIn(core, ['pack', '--offline', '--pack-destination', packs]);
  expect(packed.code, `npm pack, got: ${packed.output}`).toBe(0);
  const [tgz] = fs.readdirSync(packs).filter((f) => f.endsWith('.tgz'));
  const repo = mkTmp('core-packed-');
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true })}\n`);
  const installed = npmIn(repo, ['install', '--offline', '--no-audit', '--no-fund', '--no-package-lock', path.join(packs, tgz)]);
  expect(installed.code, `npm install of the tarball, got: ${installed.output}`).toBe(0);
  return repo;
};

// Every name the door exports, and nothing else, which `workkit-core/test` carries: Node's
// words and `expect`, the helpers Node has no equal for, the deadlines, the app seam, and the rest.
const DOOR_EXPORTS = [
  'describe', 'test', 'it', 'before', 'after', 'beforeEach', 'afterEach', 'mock', 'expect',
  'mkTmp', 'seeded', 'until', 'elapsedUntil', 'alive', 'readPid', 'run', 'start', 'endTree', 'endGroup', 'groupLives',
  'needs', 'hasLaunchd', 'SPAWN_DEADLINE', 'SUITE_DEADLINE', 'CASE_DEADLINE',
  'CASE_INDENT', 'PIPE_GRACE_MS', 'POOL', 'WORKKIT_DIR', 'findSuites', 'modCase', 'pidIn', 'suiteName',
  'indentRest', 'indentWriter', 'EVENT_PREFIX', 'eventLine', 'parseEventLine', 'appCases',
];

const ran = (output, name) => linesOf(output).some((line) => line.includes(name));

// The installed bin by its name, through the shim npm made for it.
const bin = (repo, args) => {
  const res = run(path.join(repo, 'node_modules', '.bin', 'workkit'), args, {
    cwd: repo, env: { ...process.env, PATH: joinPath(NODE_DIR, SYSTEM_PATH) },
  });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

// The names `workkit-core/test` gives a `require()` and an `import` in a repo on the package, by file.
const doorKeys = () => {
  const repo = mkCoreRepo();
  const print = 'console.log(JSON.stringify(Object.keys(h)))';
  fs.writeFileSync(path.join(repo, 'cjs.cjs'), `const h = require('workkit-core/test');\n${print};\n`);
  fs.writeFileSync(path.join(repo, 'esm.mjs'), `import * as h from 'workkit-core/test';\n${print};\n`);
  return ['cjs.cjs', 'esm.mjs'].map((file) => {
    const res = run(process.execPath, [file], { cwd: repo });
    expect(res.status, `${file} loads the package, got: ${res.output}`).toBe(0);
    return { file, keys: JSON.parse(res.stdout.trim().split('\n').pop()) };
  });
};

describe('workkit-core', { skip: skipWithoutNpm() }, () => {
  describe('npm test runs the runner through the bin', () => {
    test('npm test in a repo on the package runs every suite and prints the totals line', () => {
      const repo = mkCoreRepo();
      const { code, output } = npmIn(repo, ['test']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(ran(output, 'a case') && ran(output, 'b case'), `both suites ran, got: ${output}`).toBe(true);
      expect(linesOf(output).some((line) => TOTALS(2, 2).test(line)), `the totals line counts both, got: ${output}`).toBe(true);
    });

    test('npm test -- test/a.test.js runs only that suite', () => {
      const repo = mkCoreRepo();
      const { code, output } = npmIn(repo, ['test', '--', 'test/a.test.js']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(ran(output, 'a case') && !ran(output, 'b case'), `only the named suite ran, got: ${output}`).toBe(true);
      expect(linesOf(output).some((line) => TOTALS(1, 1).test(line)), `the totals count the one suite, got: ${output}`).toBe(true);
    });
  });

  describe('the bin\'s other verbs', () => {
    test('the bin with a verb of the global command exits 2, naming the global command, running nothing', () => {
      const repo = mkCoreRepo();
      const { code, output } = bin(repo, ['setup']);
      expect(code, `exit 2, got: ${output}`).toBe(2);
      expect(output, 'the global command\'s error shape').toMatch(/^\u2716 setup: /);
      expect(/global/i.test(output) && output.includes('workkit'), `names the global workkit command, got: ${output}`).toBe(true);
      expect(!ran(output, 'a case') && totalsOf(output) === '', `no suite ran, got: ${output}`).toBe(true);
    });

    test('the bin with no verb exits 2, naming the global command, running nothing', () => {
      const repo = mkCoreRepo();
      const { code, output } = bin(repo, []);
      expect(code, `exit 2, got: ${output}`).toBe(2);
      expect(output, 'the global command\'s error shape').toMatch(/^\u2716 workkit: /);
      expect(output, 'names the global workkit command').toMatch(/global/i);
      expect(!ran(output, 'a case') && totalsOf(output) === '', `no suite ran, got: ${output}`).toBe(true);
    });
  });

  describe('workkit-core/test: the door through require and import', () => {
    test('require(\'workkit-core/test\') and import both carry exactly the names the door keeps', () => {
      for (const { file, keys } of doorKeys()) {
        expect([...keys].sort(), `${file}: exactly the kept names`).toEqual([...DOOR_EXPORTS].sort());
      }
    });
  });

  describe('workkit-core/run: the kit\'s run.js, packed', () => {
    test('require(\'workkit-core/run\') from the packed package carries run.js\'s exports and its win32 launch', () => {
      const repo = packedRepo();
      const script = [
        "const r = require('workkit-core/run');",
        `const launch = r.launchOf(...${JSON.stringify(WIN32_CMD)});`,
        'console.log(JSON.stringify({ keys: Object.keys(r).sort(), launch }));',
      ].join('\n');
      fs.writeFileSync(path.join(repo, 'check.cjs'), `${script}\n`);
      const res = run(process.execPath, ['check.cjs'], { cwd: repo });
      expect(res.status, `check.cjs loads workkit-core/run, got: ${res.output}`).toBe(0);
      const { keys, launch } = JSON.parse(res.stdout.trim().split('\n').pop());
      expect(keys.join(', '), 'the same exports as run.js').toBe(RUN_EXPORTS.join(', '));
      expect(launch, 'the same win32 launch').toEqual(WIN32_LAUNCH);
    });
  });

  describe('a root run from the packed package', () => {
    test('a root on the packed package whose workspaces list a member runs the member\'s npm test after its own suite', () => {
      const repo = packedRepo();
      const write = (rel, text) => {
        fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
        fs.writeFileSync(path.join(repo, rel), text);
      };
      const suite = (name) => `const { test } = require('workkit-core/test');\ntest('the ${name} case', () => {});\n`;
      write('package.json', `${JSON.stringify({
        name: 'fixture', private: true, workspaces: ['packages/*'], scripts: { test: 'workkit test' },
      })}\n`);
      write('test/root.test.js', suite('root'));
      write('packages/a/package.json', `${JSON.stringify({ name: 'a', private: true, scripts: { test: 'workkit test' } })}\n`);
      write('packages/a/test/a.test.js', suite('a'));
      const { code, output } = npmIn(repo, ['test']);
      expect(code, `exit 0, got: ${output}`).toBe(0);
      const lines = linesOf(output).map((line) => line.trim());
      expect(lines.includes('▶ a: npm test') && ran(output, 'the a case') && lines.includes('✓ a'), `the member ran under its heading, got: ${output}`).toBe(true);
      expect(lines.some((line) => TOTALS(2, 1, { members: 1 }).test(line)), `the totals count the member, got: ${output}`).toBe(true);
    });
  });
});
