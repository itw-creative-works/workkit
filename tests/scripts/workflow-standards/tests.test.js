// Tests for standards.sh: a participating repo's `npm test` either is the kit's
// `workkit test` or prints the totals line, else the heal says so in one line
// and never bounces. The shared prologue is ./helpers.js.

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
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
