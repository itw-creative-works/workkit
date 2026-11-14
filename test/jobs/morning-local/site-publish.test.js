// Tests for jobs/morning.sh as this machine runs it: the site publish, after
// the brief.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const { describe, test, expect } = require('../../lib/harness');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, settle } = require('./helpers');

describe('jobs/morning (local): the site publish', { skip: skipUnlessDarwin() }, () => {
  test('the publish runs after the brief, quietly, and never before it', async () => {
    // The order is proved by the log rather than by the file: a rehearsal that
    // warns from the publish writes both blocks, and the brief's is the earlier.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world, ['--now']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    const logText = world.log();
    expect(logText.includes('HEADLINE: one thing today.'), `the brief reached the log: ${logText}`).toBeTruthy();
    expect(logText.indexOf('publish:') > logText.indexOf('HEADLINE: one thing today.'),
      `and nothing is built before the brief has gone: ${logText}`).toBeTruthy();

    const text = fs.readFileSync(SCRIPT, 'utf8');
    expect(/publish\.sh" --quiet/.test(text), 'the daily run asks for the quiet variant').toBeTruthy();
    expect(/publish exit %d; the brief was already sent/.test(text), 'and a failure is logged, never fatal').toBeTruthy();
    await settle(world);
    cleanup(world.root);
  });

  // The site publish's own block, told apart from the brief's lines, which say
  // `brief: …` right beside it. Every line publish.sh prints is prefixed
  // `publish: `, including the warnings no `--quiet` suppresses.
  const SITE_BLOCK = /publish:/;

  test('a machine with no home repo hears nothing about publishing', async () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(!SITE_BLOCK.test(world.log()), `the log stays about the morning, got: ${world.log()}`).toBeTruthy();
    expect(res.stdout.includes('HEADLINE: one thing today.'), 'and the brief is untouched').toBeTruthy();
    await settle(world);
    cleanup(world.root);
  });

  test('a message argument publishes no site', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    expect(!SITE_BLOCK.test(world.log()), 'the generic headless runner stays generic').toBeTruthy();
    cleanup(world.root);
  });

  test('a publish that warns is heard: the block is not scoped to its failures', () => {
    // A settings file that does not parse is publish.sh's loudest guarded skip:
    // it warns and exits 0, so an assertion looking only for a non-zero exit or
    // a branch name would call the morning quiet.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world);
    expect(res.status, `the morning is untouched: ${res.stderr}`).toBe(0);
    const logText = world.log();
    expect(SITE_BLOCK.test(logText), `the warning reached the log: ${logText}`).toBeTruthy();
    expect(/does not parse as JSON/.test(logText), `and says what is wrong: ${logText}`).toBeTruthy();
    cleanup(world.root);
  });
});
