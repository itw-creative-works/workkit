// Tests for workflow/workkit.sh: the `test` verb, the kit's runner over the cwd
// repo's tests/ folder, reading its tests/lib/serial.js when present.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { NODE_DIR, joinPath } = require('../../lib/platform');
const {
  cleanup, mkWorld, runCli, mkRepo,
} = require('./helpers');

// A suite in the harness's shape, its one case `body` under `name`.
const SUITE = (name, body) => `
const fs = require('fs');
const path = require('path');
const { test, assert, summary } = require('./lib/harness');
const root = path.join(__dirname, '..');
module.exports = async () => {
  await test('${name}', () => { ${body} });
  return summary();
};
`;

// A repo on the kit harness: a package.json, the harness re-exported through
// WORKKIT_ENGINE, and suites a and b, b leaving a file behind.
// `serial` writes tests/lib/serial.js; a serial a asserts b's file is there.
const mkTestRepo = (serial = null) => {
  const repo = mkRepo();
  const tests = path.join(repo, 'tests');
  fs.mkdirSync(path.join(tests, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'workkit test' } }, null, 2)}\n`);
  fs.writeFileSync(path.join(tests, 'lib', 'harness.js'), "module.exports = require(`${process.env.WORKKIT_ENGINE}/test/lib/harness.js`);\n");
  if (serial) fs.writeFileSync(path.join(tests, 'lib', 'serial.js'), `module.exports = { SERIAL: ${JSON.stringify(serial)} };\n`);
  const aWaits = Boolean(serial && serial.includes('a.test.js'));
  fs.writeFileSync(path.join(tests, 'a.test.js'), aWaits
    ? SUITE('a case', "assert(fs.existsSync(path.join(root, 'b.done')), 'a ran before b had finished');")
    : SUITE('a case', 'assert(true);'));
  fs.writeFileSync(path.join(tests, 'b.test.js'), SUITE('b case', "fs.writeFileSync(path.join(root, 'b.done'), ''); assert(true);"));
  return repo;
};

// `workkit test <args>` in the repo, node on PATH; the world's env carries no
// WORKKIT_ENGINE, so the harness re-export resolves through the verb's own.
const runTest = (repo, args = [], cwd = repo) => {
  const world = mkWorld({ claude: false });
  assertEq(world.env.WORKKIT_ENGINE, undefined, 'the world names no engine');
  const res = runCli(world, ['test', ...args], {
    cwd,
    env: { PATH: joinPath(NODE_DIR, world.env.PATH) },
  });
  cleanup(world.root);
  return { ...res, lines: stripVTControlCharacters(res.said).split(/\r?\n/) };
};

const ran = (lines, name) => lines.some((line) => line.includes(name));

// The totals line: `passed` passing cases, none failed, across `suites` suites.
const TOTALS = (passed, suites) => new RegExp(`^${passed} passed, 0 failed \\(\\d+(?:\\.\\d+)?s, ${suites} suites?\\)$`);

const run = async () => {
  group('workkit test: the kit runner over the cwd repo');

  await test('with no serial list and no WORKKIT_ENGINE set, every suite loads through the exported engine and the totals line prints', () => {
    const repo = mkTestRepo();
    const { code, said, lines } = runTest(repo);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(ran(lines, 'a case') && ran(lines, 'b case'), `both suites ran, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `the totals line, got: ${said}`);
    cleanup(repo);
  });

  // a sorts first, so it prints after b only when it was held past the wave,
  // and it passes only when b had finished before it started.
  await test('a suite tests/lib/serial.js names runs after the wave, alone', () => {
    const repo = mkTestRepo(['a.test.js']);
    const { code, said, lines } = runTest(repo);
    assertEq(code, 0, `exit 0: a ran once b had finished, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `both passed, got: ${said}`);
    const at = (name) => lines.findIndex((line) => line.includes(name));
    assert(at('b case') >= 0 && at('a case') > at('b case'), `the serial suite prints after the wave, got: ${said}`);
    cleanup(repo);
  });

  await test('a serial entry matching no suite exits 1 naming it before any suite runs', () => {
    const repo = mkTestRepo(['gone.test.js']);
    const { code, said, lines } = runTest(repo);
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(said.includes('gone.test.js'), `names the entry, got: ${said}`);
    assert(!ran(lines, 'a case') && !ran(lines, 'b case'), `no suite ran, got: ${said}`);
    assert(!fs.existsSync(path.join(repo, 'b.done')), 'b never wrote its file');
    cleanup(repo);
  });

  await test('from a subfolder of the repo the verb still runs the repo\'s suites', () => {
    const repo = mkTestRepo();
    const docs = path.join(repo, 'docs');
    fs.mkdirSync(docs);
    const { code, said, lines } = runTest(repo, [], docs);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `both suites ran from the subfolder, got: ${said}`);
    cleanup(repo);
  });

  await test('a repo with no suite at all exits 1 saying so, never a silent pass', () => {
    const repo = mkTestRepo();
    fs.rmSync(path.join(repo, 'tests', 'a.test.js'));
    fs.rmSync(path.join(repo, 'tests', 'b.test.js'));
    const { code, said } = runTest(repo);
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(said.includes('No *.test.js suites found'), `says nothing ran, got: ${said}`);
    cleanup(repo);
  });

  await test('workkit test tests/a.test.js runs only that suite', () => {
    const repo = mkTestRepo();
    const { code, said, lines } = runTest(repo, ['tests/a.test.js']);
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(ran(lines, 'a case'), `the named suite ran, got: ${said}`);
    assert(!ran(lines, 'b case') && !fs.existsSync(path.join(repo, 'b.done')), `the other never ran, got: ${said}`);
    assert(lines.some((line) => TOTALS(1, 1).test(line)), `the totals count the one suite, got: ${said}`);
    cleanup(repo);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
