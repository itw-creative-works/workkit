// Tests for hooks/safety/proof-guard at the flip to status:qa over a nested
// package: its touched test files run from its own folder under its test
// script's preloads, the root's from the root under the root script's.

const fs = require('fs');
const path = require('path');
const { group, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  dropPathWithoutGh, runHook, QA, runLog, RUN_LOG, GREEN, COMMIT, git, write, runs, qaCase, notice,
} = require('./helpers');

const PKG = 'packages/client';
const WIN = `${PKG}/test/win.test.js`;
// A nested test file sits three folders below the repo root, where runs.log is.
const NESTED_RUN_LOG = runLog(3);
// Green only where the package's setup file defined the global first.
const WIN_TEST = `${NESTED_RUN_LOG}\nrequire('node:test').test('w', () => require('node:assert').equal(window.ready, 1));\n`;
const SETUP_CJS = ['test/setup.js', 'global.window = { ready: 1 };\n'];
const SETUP_ESM = ['test/setup.mjs', 'globalThis.window = { ready: 1 };\n'];

// The client package committed into the fixture repo: its test script, and
// its setup file when it has one.
const addClient = (dir, script, setup = SETUP_CJS) => {
  write(dir, `${PKG}/package.json`, `${JSON.stringify({ name: 'client', scripts: { test: script } })}\n`);
  if (setup) write(dir, `${PKG}/${setup[0]}`, setup[1]);
  git(dir, 'add -A');
  git(dir, `${COMMIT} -m client`);
};

// The root package's test script, committed with any files it needs.
const setRoot = (dir, script, files = []) => {
  write(dir, 'package.json', `${JSON.stringify({ name: 'fixture', scripts: { test: script } })}\n`);
  for (const [name, content] of files) write(dir, name, content);
  git(dir, 'add -A');
  git(dir, `${COMMIT} -m root`);
};

const preloadNote = (flags, group = PKG) => `under ${group}'s test preloads (${flags})`;
const count = (text, part) => text.split(part).length - 1;

const run = async () => {
  group('proof-guard: a nested package runs under its own test preloads');

  await qaCase('a nested package with a --require preload: its file runs under it, green, the notice names the preload', (dir, stub) => {
    addClient(dir, 'node --require ./test/setup.js --test');
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `the preload defines the global, so the file is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes(WIN), `listed green, got: ${msg}`);
    assert(msg.includes(preloadNote('--require ./test/setup.js')), `names the package and its preload, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  for (const [flags, setup] of [['-r ./test/setup.js', SETUP_CJS], ['--import ./test/setup.mjs', SETUP_ESM]]) {
    await qaCase(`a nested package preloading with ${flags}: the file passes`, (dir, stub) => {
      addClient(dir, `node ${flags} --test`, setup);
      write(dir, WIN, WIN_TEST);
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `the preload defines the global, so the file is green, got: ${out.stderr}`);
      const msg = notice(out);
      assert(msg.includes('ran 1 touched test file(s) green') && msg.includes(WIN), `listed green, got: ${msg}`);
      assert(msg.includes(preloadNote(flags)), `names the preload as written, got: ${msg}`);
      assertEq(runs(dir), 1, 'the file ran once');
    });
  }

  await qaCase('a root test file and the nested package file in one flip: both run green, one notice counts 2', (dir, stub) => {
    addClient(dir, 'node --require ./test/setup.js --test');
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `both groups are green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 2 touched test file(s) green'), `one count over both groups, got: ${msg}`);
    assert(msg.includes('tests/a.test.js') && msg.includes(WIN), `lists both files, got: ${msg}`);
    assertEq(count(msg, 'touched test file(s) green'), 1, `one green line, got: ${msg}`);
    assertEq(count(msg, preloadNote('--require ./test/setup.js')), 1, `the preloaded group named once, got: ${msg}`);
    assertEq(runs(dir), 2, 'each file ran once');
  });

  // The file is green only when the run's working folder is its package's.
  const CWD_TEST = `${NESTED_RUN_LOG}\nconst fs = require('fs');\n`
    + "require('node:test').test('cwd', () => require('node:assert').equal(fs.realpathSync(process.cwd()), "
    + "fs.realpathSync(require('path').join(__dirname, '..'))));\n";

  await qaCase('a nested package whose script is plain node --test: its file runs from the package folder, no preload named', (dir, stub) => {
    addClient(dir, 'node --test', null);
    write(dir, `${PKG}/test/cwd.test.js`, CWD_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `run from the package folder, the file is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes(`${PKG}/test/cwd.test.js`), `listed green, got: ${msg}`);
    assert(!msg.includes('test preloads'), `a group with no preloads adds nothing, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  await qaCase("the preload resolves against the package folder: the root's file runs green with no preload", (dir, stub) => {
    addClient(dir, 'node --require ./test/setup.js --test');
    assert(!fs.existsSync(path.join(dir, 'test', 'setup.js')), 'the root holds no test/setup.js');
    write(dir, 'tests/a.test.js',
      `${RUN_LOG}\nrequire('node:test').test('bare', () => require('node:assert').equal(typeof window, 'undefined'));\n`);
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `the root file runs bare and the package file preloaded, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 2 touched test file(s) green'), `both green, got: ${msg}`);
    assert(msg.includes('tests/a.test.js') && msg.includes(WIN), `lists both files, got: ${msg}`);
    assertEq(runs(dir), 2, 'each file ran once');
  });

  await qaCase('a preload that fails to load: exit 2, the block shows the run\'s first lines with the module', (dir, stub) => {
    addClient(dir, 'node --require ./test/missing.js --test');
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 2, `a run that died before any test blocks, got: ${out.stderr}`);
    for (const want of ['No not ok entry', 'Cannot find module', 'missing.js']) {
      assert(out.stderr.includes(want), `the block names ${want}, got: ${out.stderr}`);
    }
  });

  await qaCase('a red file inside the nested group, after a green root group: exit 2, the block names the group', (dir, stub) => {
    addClient(dir, 'node --require ./test/setup.js --test');
    // The groups run in path order, so a root file sorting before packages/ makes the root group run first.
    write(dir, 'lib/a.test.js', `${GREEN}// touched\n`);
    write(dir, WIN, `${NESTED_RUN_LOG}\nrequire('node:test').test('w', () => require('node:assert').equal(window.ready, 2));\n`);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 2, `a red file in the group blocks, got: ${out.stderr}`);
    assert(out.stderr.includes(WIN), `names the file from the root, got: ${out.stderr}`);
    assert(out.stderr.includes(`First failure (run from ${PKG}):`) && out.stderr.includes('not ok 1 - w') && out.stderr.includes("name: 'AssertionError'"), `the block carries the red group's failure, not the green root group's output, got: ${out.stderr}`);
    assertEq(runs(dir), 2, 'the root group ran green before the nested group went red');
    assertEq(out.stdout, '', 'a block speaks on stderr alone');
  });
  await qaCase("the root package's own preload: a root file runs under it, green, the notice names the repo root", (dir, stub) => {
    setRoot(dir, 'node --require ./test/setup.js --test', [SETUP_CJS]);
    write(dir, 'tests/w.test.js', `${RUN_LOG}\nrequire('node:test').test('w', () => require('node:assert').equal(window.ready, 1));\n`);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `the root preload defines the global, so the file is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes('tests/w.test.js'), `listed green, got: ${msg}`);
    assert(msg.includes(preloadNote('--require ./test/setup.js', 'the repo root')), `names the root and its preload, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  // A -r before the node command belongs to another program, never to node.
  for (const script of ['rm -r dist && node --test', 'c8 -r text node --test']) {
    await qaCase(`a root script ${script}: no preload is carried, a plain root file runs green`, (dir, stub) => {
      setRoot(dir, script, [['dist/keep.txt', 'built\n']]);
      write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
      const out = runHook(QA, stub, dir);
      assertEq(out.code, 0, `nothing is preloaded, so the file is green, got: ${out.stderr}`);
      const msg = notice(out);
      assert(msg.includes('ran 1 touched test file(s) green') && msg.includes('tests/a.test.js'), `listed green, got: ${msg}`);
      assert(!msg.includes('test preloads'), `no preload named, got: ${msg}`);
      assertEq(runs(dir), 1, 'the file ran once');
    });
  }

  await qaCase('a nested package with a quoted preload value: its file runs green', (dir, stub) => {
    addClient(dir, "node --require './test/setup.js' --test");
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `the unquoted value resolves, so the file is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes(WIN), `listed green, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });

  await qaCase('a nested package preloading with --import=: its file runs green, the notice shows the flag as written', (dir, stub) => {
    addClient(dir, 'node --import=./test/setup.mjs --test', SETUP_ESM);
    write(dir, WIN, WIN_TEST);
    const out = runHook(QA, stub, dir);
    assertEq(out.code, 0, `the preload defines the global, so the file is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes('ran 1 touched test file(s) green') && msg.includes(WIN), `listed green, got: ${msg}`);
    assert(msg.includes(preloadNote('--import=./test/setup.mjs')), `the = form unsplit, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
