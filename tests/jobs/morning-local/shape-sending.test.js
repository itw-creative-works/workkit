//
// Tests for jobs/morning.sh as this machine runs it: the shape of the script,
// and what a send carries.
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { fmtCalls } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { skipUnlessDarwin, SCRIPT, INSTRUCTION, cleanup, mkWorld, runJob } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): shape');

  await test('bash -n: no syntax errors', () => {
    const res = spawnSync(BASH, [...NO_RC, '-n', shellPath(SCRIPT)], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the plist runs it through bash, but a human runs it directly');
  });

  group('jobs/morning (local): sending');

  await test('an argument overrides the payload and reaches claude verbatim', () => {
    const world = mkWorld();
    const res = runJob(world, ['just', 'this message']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `claude ran once: ${fmtCalls(calls)}`);
    assertEq(calls[0][0], '-p', 'headless');
    assertEq(calls[0][1], 'just this message', 'the arguments are the whole message');
    cleanup(world.root);
  });

  await test('the rehearsal payload is the brief, instruction first', () => {
    // `--now`, because the scheduled morning composes nothing here any more
    // (issue #107): the rehearsal is what still exercises the local compose.
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const message = world.calls()[0][1];
    assert(message.startsWith(INSTRUCTION), 'the default payload is jobs/brief-payload.js output');
    cleanup(world.root);
  });

  await test('the budget rails are on every send', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    const argv = world.calls()[0];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assertEq(after('--model'), 'haiku', 'the cheapest model');
    assertEq(after('--effort'), 'low', 'at the lowest effort');
    assert(argv.includes('--safe-mode'), 'safe mode');
    assert(argv.includes('--no-session-persistence'), 'nothing persisted');
    assertEq(after('--tools'), '', 'no tools: it reads a payload and writes prose');
    assertEq(after('--max-budget-usd'), '0.25', 'and a hard budget');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
