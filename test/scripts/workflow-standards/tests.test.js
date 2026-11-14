// Tests for standards.sh: a participating repo passes the test runner check when
// its devDependencies name workkit-core, whatever script wraps `workkit test`,
// read off package.json alone; any other repo gets one warning naming both
// changes, never a bounce. The suite folder's name changes nothing the heal prints.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect,
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
  .filter((line) => line.trim().startsWith('⚠ test script:'));
const asksForCore = (line) => line.includes('npm i -D workkit-core') && line.includes('"test": "workkit test"');

// The old hand-off to the kit's runner, which names `/run.js` and the totals
// wording a file grep would have accepted.
const HANDOFF = [
  "const path = require('path');",
  "const engine = process.env.WORKKIT_ENGINE || path.join(require('os').homedir(), '.claude', 'workkit');",
  "require(path.join(engine, 'test/run.js')); // prints N passed, M failed",
  '',
].join('\n');

describe('standards.sh: the test runner', () => {
  // A wrapper is a script of the repo's own that runs `workkit test` inside it.
  for (const [shape, script, files] of [
    ['a test script of workkit test', 'workkit test', {}],
    ['a wrapper test script', 'bash test/run.sh', { 'test/run.sh': '#!/usr/bin/env bash\nworkkit test "$@"\n' }],
  ]) {
    test(`devDependencies naming workkit-core and ${shape}: no warning, exit 0`, () => {
      const repo = repoTesting(script, files, ON_CORE);
      const stub = makeGhStub();
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      expect(code, `exit 0, got: ${output}`).toBe(0);
      expect(warnings(output).join('\n'), `no test-runner warning, got: ${output}`).toBe('');
      cleanup(repo); cleanup(stub.dir);
    });
  }

  // The hand-off file beside each script is one a file grep would pass.
  for (const [shape, script, pkg] of [
    ['a node test/run.js hand-off with no workkit-core', 'node test/run.js', {}],
    ['a test script of workkit test with no workkit-core', 'workkit test', {}],
  ]) {
    test(`${shape}: one warning naming npm i -D workkit-core and "test": "workkit test", exit 0`, () => {
      const repo = repoTesting(script, { 'test/run.js': HANDOFF }, pkg);
      const stub = makeGhStub();
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      expect(code, `a warning, never a failed heal, got: ${output}`).toBe(0);
      const lines = warnings(output);
      expect(lines.length, `one test-runner warning, got: ${output}`).toBe(1);
      expect(asksForCore(lines[0]), `it names both changes, got: ${lines[0]}`).toBeTruthy();
      cleanup(repo); cleanup(stub.dir);
    });
  }
});

describe('standards.sh: the suite folder', () => {
  // The suite folder alone differs between the two repos, so any line about its name shows as a difference.
  test('suites under tests/: the heal prints what it prints for the same suites under test/, exit 0', () => {
    const stub = makeGhStub();
    const printed = {};
    for (const folder of ['tests', 'test']) {
      const repo = repoTesting('workkit test', { [`${folder}/a.test.js`]: 'module.exports = async () => ({ passed: 0, failed: 0, failures: [], skips: [] });\n' }, ON_CORE);
      const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
      expect(code, `${folder}/: exit 0, got: ${output}`).toBe(0);
      printed[folder] = stripVTControlCharacters(output).split(repo).join('<repo>');
      cleanup(repo);
    }
    expect(printed.tests, 'the same lines for tests/ as for test/').toBe(printed.test);
    cleanup(stub.dir);
  });
});
