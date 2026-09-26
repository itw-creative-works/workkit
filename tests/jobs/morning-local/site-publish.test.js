//
// Tests for jobs/morning.sh as this machine runs it: the site publish, after
// the brief.
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipUnlessDarwin, STEPS, cleanup, mkWorld, runJob, settle } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the site publish');

  await test('the publish runs after the brief, quietly, and never before it', async () => {
    // The order is proved by the log rather than by the file: a rehearsal that
    // warns from the publish writes both blocks, and the brief's is the earlier.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const log = world.log();
    assert(log.includes('HEADLINE: one thing today.'), `the brief reached the log: ${log}`);
    assert(log.indexOf('publish:') > log.indexOf('HEADLINE: one thing today.'),
      `and nothing is built before the brief has gone: ${log}`);

    const text = fs.readFileSync(path.join(STEPS, 'publish.sh'), 'utf8');
    assert(/publish\.sh" --quiet/.test(text), 'the daily run asks for the quiet variant');
    assert(/publish exit %d; the brief was already sent/.test(text), 'and a failure is logged, never fatal');
    await settle();
    cleanup(world.root);
  });

  // The site publish's own block, told apart from the brief's lines, which say
  // `brief: …` right beside it. Every line publish.sh prints is prefixed
  // `publish: `, including the warnings no `--quiet` suppresses.
  const SITE_BLOCK = /publish:/;

  await test('a machine with no home repo hears nothing about publishing', async () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(!SITE_BLOCK.test(world.log()), `the log stays about the morning, got: ${world.log()}`);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'and the brief is untouched');
    await settle();
    cleanup(world.root);
  });

  await test('a message argument publishes no site', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    assert(!SITE_BLOCK.test(world.log()), 'the generic headless runner stays generic');
    cleanup(world.root);
  });

  await test('a publish that warns is heard: the block is not scoped to its failures', () => {
    // A settings file that does not parse is publish.sh's loudest guarded skip:
    // it warns and exits 0, so an assertion looking only for a non-zero exit or
    // a branch name would call the morning quiet.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world);
    assertEq(res.status, 0, `the morning is untouched: ${res.stderr}`);
    const log = world.log();
    assert(SITE_BLOCK.test(log), `the warning reached the log: ${log}`);
    assert(/does not parse as JSON/.test(log), `and says what is wrong: ${log}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
