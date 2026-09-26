//
// Tests for the gh stub itself: argument boundaries survive recording.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, systemPathWith } = require('../../lib/platform');
const { eqArgv, fmtCalls } = require('../../lib/argv-log');
const { cleanup, makeGhStub, ghCalls } = require('./helpers');

const run = async () => {
  group('gh stub: argument boundaries survive recording');

  // The label assertions above are only as strong as the recording underneath
  // them. These two cases prove the recording tells a quoted expansion from an
  // unquoted one: the exact regression a `"$*"` log could not see.
  const callStub = (stub, snippet) => {
    spawnSync(BASH, [...NO_RC, '-c', snippet], {
      env: { ...process.env, PATH: systemPathWith(stub.binDir) },
      encoding: 'utf8',
    });
    return ghCalls(stub);
  };

  await test('a quoted phrase arrives as one argument', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'd="two words"; gh label create x --description "$d"');
    assertEq(calls.length, 1, 'one recorded call');
    assert(
      eqArgv(calls[0], ['label', 'create', 'x', '--description', 'two words']),
      `phrase kept whole, got: ${fmtCalls(calls)}`,
    );
    cleanup(stub.dir);
  });

  await test('the same phrase unquoted arrives split, and is not mistaken for the quoted call', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'd="two words"; gh label create x --description $d');
    assert(
      !eqArgv(calls[0], ['label', 'create', 'x', '--description', 'two words']),
      `word splitting is visible, got: ${fmtCalls(calls)}`,
    );
    assertEq(calls[0].length, 6, `six arguments, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('an empty argument is recorded, not swallowed', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'gh label create "" --color ""');
    assert(
      eqArgv(calls[0], ['label', 'create', '', '--color', '']),
      `empty strings survive, got: ${fmtCalls(calls)}`,
    );
    cleanup(stub.dir);
  });

  await test('a call with no arguments at all is one empty record', () => {
    const stub = makeGhStub();
    const calls = callStub(stub, 'gh');
    assertEq(calls.length, 1, `one call recorded, got: ${fmtCalls(calls)}`);
    assertEq(calls[0].length, 0, `no arguments, got: ${fmtCalls(calls)}`);
    cleanup(stub.dir);
  });

  await test('concurrent calls do not fuse into one record', () => {
    // Each record is a single append, so 50 stubs racing each other still read
    // back as 50 intact calls. Splitting the write in two produced fused records
    // here every run (issue #19).
    const stub = makeGhStub();
    const n = 50;
    const calls = callStub(stub, `for i in $(seq 1 ${n}); do gh label create "name$i" --description "a phrase here $i" & done; wait`);
    assertEq(calls.length, n, `every call recorded, got ${calls.length}`);
    const malformed = calls.filter((c) => c.length !== 5);
    assertEq(malformed.length, 0, `every record holds exactly its own 5 arguments, got: ${fmtCalls(malformed)}`);
    // And the pairs are still each other's, not one call's flag with another's value.
    const mismatched = calls.filter((c) => c[4] !== `a phrase here ${c[2].replace('name', '')}`);
    assertEq(mismatched.length, 0, `each description stayed with its own label, got: ${fmtCalls(mismatched)}`);
    cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
