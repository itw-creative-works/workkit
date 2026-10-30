// Tests for standards.sh: a participating repo passes the test runner check when
// its devDependencies name workkit-core, whatever script wraps `workkit test`,
// read off package.json alone; any other repo gets one warning naming both
// changes, never a bounce. A suite folder at tests/ is named as drift the same way.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { stripVTControlCharacters } = require('util');
const { cleanup, makeRepo, makeGhStub, runScript } = require('./helpers');

// A participating repo whose package.json runs `script` as its test, `pkg`
// merged over it, with `files` (name to body) beside it.
const repoTesting = (script, files = {}, pkg = {}) => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: script }, ...pkg }, null, 2)}\n`);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), body);
  }
  return repo;
};

const ON_CORE = { devDependencies: { 'workkit-core': '^1.0.0' } };

// The heal's test-runner warnings, and the one naming both changes the check asks for.
const warnings = (output) => stripVTControlCharacters(output).split(/\r?\n/)
  .filter((line) => line.trim().startsWith('\u26a0 test script:'));
const asksForCore = (line) => line.includes('npm i -D workkit-core') && line.includes('"test": "workkit test"');

// The old hand-off to the kit's runner, which names `/run.js` and the totals
// wording a file grep would have accepted.
const HANDOFF = [
  "const path = require('path');",
  "const engine = process.env.WORKKIT_ENGINE || path.join(require('os').homedir(), '.claude', 'workkit');",
  "require(path.join(engine, 'test/run.js')); // prints N passed, M failed",
  '',
].join('\n');

const cases = async () => {
  group('standards.sh: the test runner');

  // A wrapper is a script of the repo's own that runs `workkit test` inside it.
  for (const [shape, script, files] of [
    ['a test script of workkit test', 'workkit test', {}],
    ['a wrapper test script', 'bash test/run.sh', { 'test/run.sh': '#!/usr/bin/env bash\nworkkit test "$@"\n' }],
  ]) {
    await test(`devDependencies naming workkit-core and ${shape}: no warning, exit 0`, () => {
      const repo = repoTesting(script, files, ON_CORE);
      const stub = makeGhStub();
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(code, 0, `exit 0, got: ${output}`);
      assertEq(warnings(output).join('\n'), '', `no test-runner warning, got: ${output}`);
      cleanup(repo); cleanup(stub.dir);
    });
  }

  // The hand-off file beside each script is one a file grep would pass.
  for (const [shape, script, pkg] of [
    ['a node test/run.js hand-off with no workkit-core', 'node test/run.js', {}],
    ['a test script of workkit test with no workkit-core', 'workkit test', {}],
  ]) {
    await test(`${shape}: one warning naming npm i -D workkit-core and "test": "workkit test", exit 0`, () => {
      const repo = repoTesting(script, { 'test/run.js': HANDOFF }, pkg);
      const stub = makeGhStub();
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(code, 0, `a warning, never a failed heal, got: ${output}`);
      const lines = warnings(output);
      assertEq(lines.length, 1, `one test-runner warning, got: ${output}`);
      assert(asksForCore(lines[0]), `it names both changes, got: ${lines[0]}`);
      cleanup(repo); cleanup(stub.dir);
    });
  }

  group('standards.sh: the suite folder');

  const DRIFT = "tests/: the suites live under tests/; Node's convention is test/ (git mv tests test)";
  const driftLines = (output) => output.split(/\r?\n/).filter((line) => line.includes(DRIFT));

  // The suite folder alone differs between the two repos.
  await test('suites under tests/ get the drift line once, suites under test/ none, exit 0 both ways', () => {
    const stub = makeGhStub();
    for (const [folder, count] of [['tests', 1], ['test', 0]]) {
      const repo = repoTesting('node run.js', { 'run.js': HANDOFF });
      fs.mkdirSync(path.join(repo, folder));
      fs.writeFileSync(path.join(repo, folder, 'a.test.js'), 'module.exports = async () => ({ passed: 0, failed: 0, failures: [], skips: [] });\n');
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(code, 0, `${folder}/: exit 0, got: ${output}`);
      assertEq(driftLines(output).length, count, `${folder}/: the drift line ${count} time(s), got: ${output}`);
      cleanup(repo);
    }
    cleanup(stub.dir);
  });

  await test('a repo with no package.json gets no drift line for its tests/', () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'module.exports = async () => ({ passed: 0, failed: 0, failures: [], skips: [] });\n');
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assertEq(driftLines(output).length, 0, `no drift line, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
