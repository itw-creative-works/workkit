// Tests for standards.sh writing .gitignore: the .workkit/ pattern and the
// basics.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, WORKKIT_DIR: W,
} = require('../../lib/harness');
const {
  SCRIPT, IGNORE_GLOB, IGNORE_GLOB_ALL, IGNORE_NEGATION, cleanup, makeRepo, makeGhStub,
  readFile, runScript,
} = require('./helpers');

describe('standards.sh: .workkit/ in .gitignore', () => {
  test('git honors the pattern: settings.json tracked, the rest ignored', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), '{ "version": 1 }\n');
    fs.writeFileSync(path.join(repo, W, 'capture.md'), '- a note\n');
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    expect(!ignored(`${W}/settings.json`), 'settings.json is committable').toBeTruthy();
    expect(ignored(`${W}/capture.md`), 'the local capture file stays untracked').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('second run neither duplicates the lines nor reports a change', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    runScript(repo, { pathPrefix: stub.binDir });
    const first = readFile(path.join(repo, '.gitignore'));
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const second = readFile(path.join(repo, '.gitignore'));
    expect(second, 'file untouched on re-run').toBe(first);
    expect((second.match(IGNORE_GLOB_ALL) || []).length, `exactly one ${W}/* line`).toBe(1);
    expect(stdout.includes('already ignored'), `reports the existing state, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('appending to a file with no trailing newline keeps the last line', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/');
    runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    expect(/^node_modules\/$/m.test(ignore), `existing entry intact, got: ${ignore}`).toBeTruthy();
    expect(IGNORE_GLOB.test(ignore), `${W}/* appended on its own line`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal is verified by outcome (git check-ignore), not by grepping for its
  // own block: both cases below can pass a string check while leaving
  // settings.json untrackable.
  test('a .gitignore with only .workkit/* gains the negation', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${W}/*\n`);
    const { output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    expect(IGNORE_NEGATION.test(ignore), `negation added, got: ${ignore}`).toBeTruthy();
    expect((ignore.match(IGNORE_GLOB_ALL) || []).length, `no duplicate ${W}/* line`).toBe(1);
    const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: repo }).status === 0;
    expect(!ignored(`${W}/settings.json`), 'the opt-in file is committable').toBeTruthy();
    expect(ignored(`${W}/capture.md`), 'session state still ignored').toBeTruthy();
    expect(!stdout.includes('already ignored'), `the broken state is not reported as correct, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('the DIRECTORY form .workkit/ is named as needing a human', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `${W}/\n`);
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    // Non-zero means "not fully standardized", which is what lets the hook retry
    // next session instead of caching a half-heal. The hook handles it and still
    // exits 0, so a session start is never wedged.
    expect(code, 'a heal needing a human reports itself as unfinished').toBe(1);
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', `${W}/settings.json`], { cwd: repo }).status === 0;
    expect(ignored, 'git cannot descend into an excluded directory, still ignored').toBeTruthy();
    expect(stdout.includes('STILL ignored'), `the run says so plainly, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes(`.gitignore:1:${W}/`), `and names the offending line, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes('not fully standardized'), `the run reports the repo as needing attention, got: ${stdout}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.sh: the .gitignore basics', () => {
  // The two entries every repo needs, read from the engine so the suite asks
  // for whatever the engine actually heals.
  const BASICS = /^GITIGNORE_BASICS="([^"]+)"/m
    .exec(fs.readFileSync(SCRIPT, 'utf8'))[1].split(' ');
  const countLine = (text, entry) =>
    (text.match(new RegExp(`^${entry.replace(/\./g, '\\.')}$`, 'gm')) || []).length;

  test('a repo with no .gitignore gets both entries', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      expect(countLine(ignore, entry), `${entry} written once, got: ${ignore}`).toBe(1);
    }
    expect(output.includes(`gitignore: added ${BASICS.join(' ')}`),
      `the run reports what it added, got: ${output}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a partial .gitignore gains only the missing entry', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    fs.writeFileSync(path.join(repo, '.gitignore'), `node_modules\n${BASICS[0]}\n`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    expect(countLine(ignore, BASICS[0]), `${BASICS[0]} not duplicated, got: ${ignore}`).toBe(1);
    expect(countLine(ignore, BASICS[1]), `${BASICS[1]} appended, got: ${ignore}`).toBe(1);
    expect(output.includes(`gitignore: added ${BASICS[1]}`),
      `only the missing one is reported, got: ${output}`).toBeTruthy();
    expect(!output.includes(`added ${BASICS[0]}`), 'the present one is not claimed').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('glob forms already covering them are left untouched, and a re-run changes nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const covered = `node_modules\n**/.DS_Store\n*.env\n`;
    fs.writeFileSync(path.join(repo, '.gitignore'), covered);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const ignore = readFile(path.join(repo, '.gitignore'));
    for (const entry of BASICS) {
      expect(countLine(ignore, entry), `${entry} not appended over a covering glob, got: ${ignore}`).toBe(0);
    }
    expect(output.includes(`${BASICS.join(' ')} already ignored`),
      `the run reports the existing state, got: ${output}`).toBeTruthy();
    const { output: second } = runScript(repo, { pathPrefix: stub.binDir });
    expect(readFile(path.join(repo, '.gitignore')), 'second run leaves the file alone').toBe(ignore);
    expect(second.includes('already ignored'), `and says so, got: ${second}`).toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});
