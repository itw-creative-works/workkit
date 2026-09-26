//
// Tests for jobs/morning.sh as this machine runs it: the cloud brief marker
// (issue #173), and the manual trigger.
// The shared prologue (the world factory, the job runner, the notification waits) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipUnlessDarwin, STEPS, INSTRUCTION, BRIEF_TITLE_PREFIX, cleanup, mkWorld, runJob } = require('./helpers');

const run = async () => {
  skipUnlessDarwin();

  group('jobs/morning (local): the cloud brief marker');

  // Issue #173: the brief is composed and published in the cloud, and a runner
  // whose token expired fails quietly: ten mornings went by with nothing
  // posted and no chat session knew. So the morning records what is actually on
  // the board, and the session hook reads that ONE file. This is the writer.

  await test('the newest brief on the board is recorded, summaries ignored', () => {
    const world = mkWorld({
      home: 'owner/private-home',
      dispatch: true,
      // Newest first, the order the query asks for, and the newest post of all
      // is a summary, which is what the title filter is for.
      posted: [
        { title: 'daily: 2026-08-18' },
        { title: `${BRIEF_TITLE_PREFIX}2026-08-17` },
        { title: `${BRIEF_TITLE_PREFIX}2026-08-16` },
      ],
    });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);

    const marker = JSON.parse(world.marker());
    assertEq(marker.version, 1, 'the marker carries its version');
    assertEq(marker.lastBrief, '2026-08-17', 'the newest brief-titled post, not the newest post');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(marker.checkedAt),
      `and when it was checked: ${marker.checkedAt}`);
    assert(/marker: /.test(world.log()), `the log says what was recorded: ${world.log()}`);
    // The file it was written as first is BESIDE it, so what lands is a rename
    // - and the rename takes the name with it, leaving the directory the
    // machine's settings live in with one file in it.
    assert(!fs.existsSync(`${world.markerFile}.tmp`), 'and nothing is left beside it');
    cleanup(world.root);
  });

  await test('a read that fails leaves the marker exactly as it was', () => {
    // Never write a lie: an offline machine, a token that refuses, a `gh` that
    // is not there: none of them are evidence about the board, so the marker a
    // real read left behind stands.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, ghFails: true });
    const was = JSON.stringify({ version: 1, lastBrief: '2026-08-01', checkedAt: '2026-08-01T09:00:00Z' });
    fs.writeFileSync(world.markerFile, was);

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.marker(), was, 'the marker is untouched');
    assert(/marker: .*could not be read/.test(world.log()), `and the skip is named: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a board carrying no brief at all writes nothing', () => {
    const world = mkWorld({
      home: 'owner/private-home', dispatch: true, posted: [{ title: 'daily: 2026-08-18' }],
    });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.marker(), null, 'a board with no brief on it is not a date');
    cleanup(world.root);
  });

  await test('a machine with no home repo records nothing, and says why', () => {
    const world = mkWorld({ home: null });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assertEq(world.marker(), null, 'there is no board to read');
    assert(/marker: no home repo/.test(world.log()), `the log names the skip: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a message argument records nothing: the generic runner stays generic', () => {
    const world = mkWorld({
      home: 'owner/private-home', posted: [{ title: `${BRIEF_TITLE_PREFIX}2026-08-17` }],
    });
    runJob(world, ['hello']);
    assertEq(world.marker(), null, 'a prompt is not a morning');
    assert(!/marker:/.test(world.log()), `and the step never ran: ${world.log()}`);
    cleanup(world.root);
  });

  await test('the board read is bounded, like every other read on the daily path', () => {
    // A captive portal answers the handshake and never the request; an
    // unbounded read here would hold the morning open for as long as it liked.
    const text = fs.readFileSync(path.join(STEPS, 'marker.sh'), 'utf8');
    assert(/WORKKIT_GH_TIMEOUT/.test(text), 'the same bound the engine reads under, and the same knob');
  });

  await test('the marker is written beside itself, so what lands on it is a rename', () => {
    // The hook may read the marker at any moment and half of one must never be
    // among the things it can find. A move ACROSS filesystems is a copy and an
    // unlink rather than a rename, and a copy is exactly that half - so the
    // temp is written in the marker's own directory, never in the scratch.
    const text = fs.readFileSync(path.join(STEPS, 'marker.sh'), 'utf8');
    assert(/>"\$marker\.tmp"/.test(text), 'the whole file is written beside the marker');
    assert(/mv "\$marker\.tmp" "\$marker"/.test(text), 'and moved onto it from there');
    assert(!/SCRATCH_DIR\/brief-status\.json/.test(text), 'nothing writes the marker into the scratch any more');
  });

  group('jobs/morning (local): the manual trigger');

  await test('--now sends the same brief, not the flag as a message', () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const message = world.calls()[0][1];
    assert(message.startsWith(INSTRUCTION), 'the flag reaches the compose step: the payload the cloud sends');
    assert(!message.includes('--now'), 'and is never mistaken for the message');
    cleanup(world.root);
  });

  await test('--now marks its log block manual, in the same log file', () => {
    const world = mkWorld();
    runJob(world, ['--now']);
    const log = world.log();
    assert(/--- \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ---/.test(log), `stamped manual, got: ${log.slice(0, 120)}`);
    cleanup(world.root);
  });

  await test('a scheduled run is not marked manual', () => {
    const world = mkWorld();
    runJob(world);
    assert(!/\(manual\)/.test(world.log()), 'the 9am block reads as it always did');
    cleanup(world.root);
  });

  await test('npm run brief is the trigger, and it points at this script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
    const script = pkg.scripts.brief;
    assert(typeof script === 'string' && script.includes('--now'), `the brief script runs the manual flag, got: ${script}`);
    const target = script.match(/(jobs\/[\w-]+\.sh)/);
    assert(target, `it names a jobs script, got: ${script}`);
    assert(fs.existsSync(path.join(__dirname, '..', '..', '..', target[1])), `${target[1]} resolves from the repo root`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
