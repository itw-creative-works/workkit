// Tests for jobs/morning.sh as this machine runs it: the site publish, after
// the brief.
// The shared prologue (world factory, job runner, notification waits) is ./helpers.js.

const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipUnlessDarwin, SCRIPT, cleanup, mkWorld, runJob, settle } = require('./helpers');

const cases = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the site publish');

  await test('the publish runs after the brief, quietly, and never before it', async () => {
    // The order is proved by the log rather than by the file: a rehearsal that
    // warns from the publish writes both blocks, and the brief's is the earlier.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const logText = world.log();
    assert(logText.includes('HEADLINE: one thing today.'), `the brief reached the log: ${logText}`);
    assert(logText.indexOf('publish:') > logText.indexOf('HEADLINE: one thing today.'),
      `and nothing is built before the brief has gone: ${logText}`);

    const text = fs.readFileSync(SCRIPT, 'utf8');
    assert(/publish\.sh" --quiet/.test(text), 'the daily run asks for the quiet variant');
    assert(/publish exit %d; the brief was already sent/.test(text), 'and a failure is logged, never fatal');
    await settle(world);
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
    await settle(world);
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
    const logText = world.log();
    assert(SITE_BLOCK.test(logText), `the warning reached the log: ${logText}`);
    assert(/does not parse as JSON/.test(logText), `and says what is wrong: ${logText}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
