// Tests for hooks/safety/proof-guard's record at the flip to status:qa: the
// touched test files run once per tree, so a later flip on the same tree hash
// passes on the record, and any change to the tree runs them again.
// The shared prologue (the hook runner, the gh stub, the fixtures) is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const {
  cleanup, makeGhStub, ghCalls, dropPathWithoutGh, runHookIn, WORLD,
  QA, GREEN, RED, EXPORTS, namesUnproved, COMMIT, git, write, runs, mkQaRepo, notice,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

const HIT = 'proof-guard: the touched test files already ran green on this tree at an earlier qa flip, so they did not run again.';
const GREEN_RUN = 'ran 1 touched test file(s) green';

// The records under a case's own TMPDIR, so none is another case's or this machine's.
const records = (tmp) => {
  const dir = path.join(tmp, 'claude-qa-marker');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

// A fixture repo that ignores runs.log, since every run appends to it and the
// tree hash counts untracked files; one scratch TMPDIR and one gh stub per case.
const recordCase = (name, body) => test(name, () => {
  const dir = mkQaRepo();
  const tmp = mkTmp('proof-guard-tmp-');
  const stub = makeGhStub(WORLD);
  const runHook = runHookIn(tmp);
  try {
    write(dir, '.gitignore', 'runs.log\n');
    git(dir, 'add .gitignore');
    git(dir, `${COMMIT} -m ignore`);
    body({ dir, tmp, flip: () => runHook(QA, stub, dir) });
    assertEq(ghCalls(stub).length, 0, `a qa flip reads no issue, got: ${fmtCalls(ghCalls(stub))}`);
  } finally {
    cleanup(dir);
    cleanup(tmp);
    cleanup(stub.dir);
  }
});

// A first flip over a touched green test file, which runs it and passes.
const greenFlip = (dir, flip) => {
  write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
  const out = flip();
  assertEq(out.code, 0, `a green run passes, got: ${out.stderr}`);
  assert(notice(out).includes(GREEN_RUN), `the first flip runs the file, got: ${out.stdout}`);
  assertEq(runs(dir), 1, 'the first flip ran the file once');
};

const run = async () => {
  group('proof-guard: the touched test files run once per tree');

  await recordCase('two flips on one unchanged tree: the second runs nothing and says so', ({ dir, tmp, flip }) => {
    greenFlip(dir, flip);
    assertEq(records(tmp).length, 1, `a green run records the tree, got: ${records(tmp)}`);
    const out = flip();
    assertEq(out.code, 0, `the second flip passes, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes(HIT), `the record-hit notice, got: ${msg}`);
    assert(!msg.includes(GREEN_RUN), `never claims a run, got: ${msg}`);
    assertEq(runs(dir), 1, 'the second flip ran nothing');
  });

  await recordCase('a tracked edit between two flips: the second runs the files again', ({ dir, flip }) => {
    greenFlip(dir, flip);
    write(dir, 'package.json', `${JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { test: 'node --test' } })}\n`);
    const out = flip();
    assertEq(out.code, 0, `green again, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes(GREEN_RUN) && !msg.includes(HIT), `a new tree runs again, got: ${msg}`);
    assertEq(runs(dir), 2, 'the edit made the second flip run the file');
  });

  await recordCase('a new untracked file between two flips: the second runs the files again', ({ dir, flip }) => {
    greenFlip(dir, flip);
    write(dir, 'notes.txt', 'new\n');
    const out = flip();
    assertEq(out.code, 0, `green again, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes(GREEN_RUN) && !msg.includes(HIT), `a new tree runs again, got: ${msg}`);
    assertEq(runs(dir), 2, 'the untracked file made the second flip run the file');
  });

  await recordCase('a red touched test file: blocked, nothing recorded, the same tree runs and blocks again', ({ dir, tmp, flip }) => {
    write(dir, 'tests/a.test.js', RED);
    for (const nth of [1, 2]) {
      const out = flip();
      assertEq(out.code, 2, `flip ${nth} is blocked, got: ${out.stderr}`);
      assert(out.stderr.includes('tests/a.test.js'), `flip ${nth} names the file, got: ${out.stderr}`);
      assertEq(runs(dir), nth, `flip ${nth} ran the file`);
    }
    assertEq(records(tmp).length, 0, `a blocked flip records nothing, got: ${records(tmp)}`);
  });

  await recordCase("no runnable touched test file: nothing recorded, today's notice", ({ dir, tmp, flip }) => {
    write(dir, 'lib/x.js', 'module.exports = 1;\n');
    const first = notice(flip());
    assert(first.includes('nothing ran') && !first.includes(HIT), `today's notice, got: ${first}`);
    assertEq(records(tmp).length, 0, `nothing ran, so nothing is recorded, got: ${records(tmp)}`);
    assertEq(notice(flip()), first, 'the same tree flipped again hears the same notice');
    assertEq(runs(dir), 0, 'no test ran');
  });

  await recordCase('an edit undone byte for byte: the next flip passes on the record', ({ dir, flip }) => {
    greenFlip(dir, flip);
    const pkg = path.join(dir, 'package.json');
    const before = fs.readFileSync(pkg);
    fs.writeFileSync(pkg, `${before}\n`);
    fs.writeFileSync(pkg, before);
    const out = flip();
    assertEq(out.code, 0, `the record passes the flip, got: ${out.stderr}`);
    assert(notice(out).includes(HIT), `the hash is the content, not its history, got: ${out.stdout}`);
    assertEq(runs(dir), 1, 'the undone edit ran nothing');
  });

  await recordCase('a green run that left an untracked file: nothing recorded, the notice says the tree changed', ({ dir, tmp, flip }) => {
    const LEAVES = `${GREEN}require('fs').writeFileSync(require('path').join(__dirname, '..', 'left.txt'), 'x\\n');\n`;
    write(dir, 'tests/a.test.js', LEAVES);
    const out = flip();
    assertEq(out.code, 0, `the run is green, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes(GREEN_RUN) && msg.includes('tree changed'), `says the tree changed, got: ${msg}`);
    assertEq(records(tmp).length, 0, `a changed tree records nothing, got: ${records(tmp)}`);
    fs.rmSync(path.join(dir, 'left.txt'));
    const again = notice(flip());
    assert(!again.includes(HIT), `no record to hit, got: ${again}`);
    assertEq(runs(dir), 2, 'the tree as it stood before the first run runs the files again');
  });

  await recordCase('a green run with an unproved module beside a proved file: recorded, the next flip hits', ({ dir, tmp, flip }) => {
    write(dir, 'tests/d.test.js', EXPORTS);
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    const first = flip();
    assertEq(first.code, 0, `a green run passes, got: ${first.stderr}`);
    const msg = notice(first);
    assert(msg.includes(GREEN_RUN), `the proved file alone is counted, got: ${msg}`);
    assert(namesUnproved(msg, 'tests/d.test.js'), `the module is named as not proved, got: ${msg}`);
    assertEq(runs(dir), 2, 'the first flip ran both files');
    assertEq(records(tmp).length, 1, `the green run records the tree, got: ${records(tmp)}`);
    const out = flip();
    assertEq(out.code, 0, `the record passes the flip, got: ${out.stderr}`);
    assert(notice(out).startsWith(HIT), `the notice leads with the hit, got: ${out.stdout}`);
    assertEq(runs(dir), 2, 'the hit ran nothing');
  });

  await recordCase('a run where no file proved anything: nothing recorded, the next flip runs it again', ({ dir, tmp, flip }) => {
    write(dir, 'tests/d.test.js', EXPORTS);
    const first = flip();
    assertEq(first.code, 0, `an unproved run passes, got: ${first.stderr}`);
    const msg = notice(first);
    assert(msg.includes('ran 0 touched test file(s) green'), `nothing counted green, got: ${msg}`);
    assert(namesUnproved(msg, 'tests/d.test.js'), `the module is named as not proved, got: ${msg}`);
    assert(msg.includes('no record was written'), `says the run was not recorded, got: ${msg}`);
    assertEq(records(tmp).length, 0, `nothing proved, so nothing is recorded, got: ${records(tmp)}`);
    const again = notice(flip());
    assert(!again.startsWith(HIT) && namesUnproved(again, 'tests/d.test.js'), `the next flip runs and names it again, got: ${again}`);
    assertEq(runs(dir), 2, 'the module ran on both flips');
  });

  // A file where the record's folder belongs breaks the record write alone:
  // the hook's other scratch files sit beside it in TMPDIR, untouched.
  await recordCase('a record that cannot be written: the green flip passes and says so', ({ dir, tmp, flip }) => {
    fs.writeFileSync(path.join(tmp, 'claude-qa-marker'), 'not a folder\n');
    write(dir, 'tests/a.test.js', `${GREEN}// touched\n`);
    const out = flip();
    assertEq(out.code, 0, `an unwritten record never blocks, got: ${out.stderr}`);
    const msg = notice(out);
    assert(msg.includes(GREEN_RUN) && msg.includes('could not be written'), `says the record was not written, got: ${msg}`);
    assertEq(runs(dir), 1, 'the file ran once');
  });
};

module.exports = async () => {
  await run();
  dropPathWithoutGh();
  return summary();
};

if (require.main === module) selfRun(module.exports);
