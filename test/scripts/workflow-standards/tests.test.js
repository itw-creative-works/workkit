// Tests for standards.sh: a participating repo's `npm test` either is the kit's
// `workkit test` or prints the totals line, else the heal says so in one line
// and never bounces; a suite folder at tests/ is named as drift the same way.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const { cleanup, makeRepo, makeGhStub, runScript } = require('./helpers');

const LINE = 'standards: npm test does not print the totals line';

// A participating repo whose package.json runs `script` as its test, with
// `files` (name to body) beside it.
const repoTesting = (script, files = {}) => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: script } }, null, 2)}\n`);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), body);
  return repo;
};

const linesOf = (output) => output.split(/\r?\n/).filter((line) => line.includes(LINE));

const run = async () => {
  group('standards.sh: the test script');

  await test('an npm test that prints no totals line gets the one heal line and exit 0', () => {
    const repo = repoTesting('node x.js', { 'x.js': "console.log('all good');\n" });
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assertEq(linesOf(output).length, 1, `the line, once, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an npm test of workkit test gets no line', () => {
    const repo = repoTesting('workkit test');
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(linesOf(output).length === 0, `no test-script line, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal reads the file a node, bash or sh script names, one level down,
  // for `/run.js` or the totals wording; a miss is a warning, never a bounce.
  const HANDOFF = [
    "const path = require('path');",
    "const engine = process.env.WORKKIT_ENGINE || path.join(require('os').homedir(), '.claude', 'workkit');",
    "require(path.join(engine, 'test/run.js'));",
    '',
  ].join('\n');

  await test('an npm test of node tests/run.js handing off to the kit runner gets no line', () => {
    const repo = repoTesting('node tests/run.js');
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests', 'run.js'), HANDOFF);
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(linesOf(output).length === 0, `no test-script line, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('an npm test of bash tests/run.sh running node "$here/run.js" gets no line', () => {
    const repo = repoTesting('bash tests/run.sh');
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests', 'run.sh'), '#!/usr/bin/env bash\nhere="$(cd "$(dirname "$0")" && pwd)"\nnode "$here/run.js"\n');
    fs.writeFileSync(path.join(repo, 'tests', 'run.js'), HANDOFF);
    const stub = makeGhStub();
    const { code, output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(linesOf(output).length === 0, `no test-script line, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the suite folder');

  const DRIFT = "tests/: the suites live under tests/; Node's convention is test/ (git mv tests test)";
  const driftLines = (output) => output.split(/\r?\n/).filter((line) => line.includes(DRIFT));

  // The suite folder alone differs between the two repos.
  await test('suites under tests/ get the drift line once, suites under test/ none, exit 0 both ways', () => {
    const stub = makeGhStub();
    for (const [folder, count] of [['tests', 1], ['test', 0]]) {
      const repo = repoTesting('workkit test');
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
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
