//
// Tests for the state directory name agreeing across layers, and
// standards.sh writing .gitignore: the .workkit/ pattern and the basics.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  SCRIPT, IGNORE_GLOB, IGNORE_GLOB_ALL, IGNORE_NEGATION, HOOK_LIB, cleanup, makeRepo, makeGhStub,
  readFile, runScript,
} = require('./helpers');

const run = async () => {
  group('the state directory name is one string per layer');

  // Three layers hold the name (the engine, the hooks, and this harness) and
  // a rename that misses one leaves a hook reading a directory nothing writes.
  const assignment = (file, variable) => {
    const found = new RegExp(`^\\s*(?:const\\s+)?${variable}\\s*=\\s*['"]([^'"]+)['"]`, 'm')
      .exec(fs.readFileSync(file, 'utf8'));
    assert(found, `${variable} is assigned in ${file}`);
    return found[1];
  };

  await test('the engine, the hooks, and the harness all say the same name', () => {
    assertEq(assignment(SCRIPT, 'WORKKIT_DIR'), W, 'standards.sh matches the harness');
    assertEq(assignment(HOOK_LIB, 'WORKKIT_DIR'), W, 'hooks/_lib.sh matches the harness');
  });

  group('standards.sh: .workkit/ in .gitignore');

  await test('adds the .workkit/ pattern when .gitignore is absent', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(IGNORE_GLOB.test(ignore), `${W}/* line written, got: ${ignore}`);
    assert(IGNORE_NEGATION.test(ignore), `settings.json re-included, got: ${ignore}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('git honors the pattern: settings.json tracked, the rest ignored', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), '{ "version": 1 }\n');
    fs.writeFileSync(path.join(repo, W, 'capture.md'), '- a note\n');
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'settings.json is committable');
    assert(ignored(`${W}/capture.md`), 'the local capture file stays untracked');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('second run neither duplicates the lines nor reports a change', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const first = readFile(path.join(repo, '.gitignore'));
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const second = readFile(path.join(repo, '.gitignore'));
    assertEq(second, first, 'file untouched on re-run');
    assertEq((second.match(IGNORE_GLOB_ALL) || []).length, 1, `exactly one ${W}/* line`);
    assert(stdout.includes('already ignored'), `reports the existing state, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('appending to a file with no trailing newline keeps the last line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/');
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(/^node_modules\/$/m.test(ignore), `existing entry intact, got: ${ignore}`);
    assert(IGNORE_GLOB.test(ignore), `${W}/* appended on its own line`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a generated .gitignore does not start with a blank line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(!ignore.startsWith('\n'), `no leading blank line, got: ${JSON.stringify(ignore.slice(0, 20))}`);
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal is verified by OUTCOME (git check-ignore), not by grepping for its
  // own block: the two cases below both passed a string check while leaving
  // settings.json untrackable (review regression, 2026-07-24).
  await test('a .gitignore with only .workkit/* gains the negation', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${W}/*\n`);
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assert(IGNORE_NEGATION.test(ignore), `negation added, got: ${ignore}`);
    assertEq((ignore.match(IGNORE_GLOB_ALL) || []).length, 1, `no duplicate ${W}/* line`);
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    assert(!ignored(`${W}/settings.json`), 'the opt-in file is committable');
    assert(ignored(`${W}/capture.md`), 'session state still ignored');
    assert(!stdout.includes('already ignored'), `the broken state is not reported as correct, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the DIRECTORY form .workkit/ is named as needing a human', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `${W}/\n`);
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    // Non-zero means "not fully standardized", which is what lets the hook retry
    // next session instead of caching a half-heal. The hook handles it and still
    // exits 0, so a session start is never wedged.
    assertEq(code, 1, 'a heal needing a human reports itself as unfinished');
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', `${W}/settings.json`], { cwd: repo }).status === 0;
    assert(ignored, 'git cannot descend into an excluded directory, still ignored');
    assert(stdout.includes('STILL ignored'), `the run says so plainly, got: ${stdout}`);
    assert(stdout.includes(`.gitignore:1:${W}/`), `and names the offending line, got: ${stdout}`);
    assert(stdout.includes('not fully standardized'), `the run reports the repo as needing attention, got: ${stdout}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: the .gitignore basics');

  // The two entries every repo needs, read from the engine so the suite asks
  // for whatever the engine actually heals.
  const BASICS = /^GITIGNORE_BASICS="([^"]+)"/m
    .exec(fs.readFileSync(SCRIPT, 'utf8'))[1].split(' ');
  const countLine = (text, entry) =>
    (text.match(new RegExp(`^${entry.replace(/\./g, '\\.')}$`, 'gm')) || []).length;

  await test('a repo with no .gitignore gets both entries', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      assertEq(countLine(ignore, entry), 1, `${entry} written once, got: ${ignore}`);
    }
    assert(output.includes(`gitignore: added ${BASICS.join(' ')}`),
      `the run reports what it added, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a partial .gitignore gains only the missing entry', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${BASICS[0]}\n`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    assertEq(countLine(ignore, BASICS[0]), 1, `${BASICS[0]} not duplicated, got: ${ignore}`);
    assertEq(countLine(ignore, BASICS[1]), 1, `${BASICS[1]} appended, got: ${ignore}`);
    assert(output.includes(`gitignore: added ${BASICS[1]}`),
      `only the missing one is reported, got: ${output}`);
    assert(!output.includes(`added ${BASICS[0]}`), 'the present one is not claimed');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('glob forms already covering them are left untouched, and a re-run changes nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const covered = `node_modules\n**/.DS_Store\n*.env\n`;
    fs.writeFileSync(path.join(repo, '.gitignore'), covered);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      assertEq(countLine(ignore, entry), 0, `${entry} not appended over a covering glob, got: ${ignore}`);
    }
    assert(output.includes(`${BASICS.join(' ')} already ignored`),
      `the run reports the existing state, got: ${output}`);
    const { output: second } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(path.join(repo, '.gitignore')), ignore, 'second run leaves the file alone');
    assert(second.includes('already ignored'), `and says so, got: ${second}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
