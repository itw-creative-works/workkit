//
// Tests for jobs/brief-payload.js, the payload the 9am job hands to Claude:
// the upstream news, its cursor, and the stats line the runner appends.
// The shared prologue (the two fixture worlds, the composer seam, the summaries fixtures, the news gate) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  SCRIPT, writeBriefMarks, INSTRUCTION, parseStatsMark, CC_CHANGELOG, mkTmp, cleanup, mkNewsWorld, newsTest,
} = require('./helpers');

const run = async () => {
  group('jobs/brief-payload: the upstream news');

  await test('the instruction tells the digest what a CC NEWS block is', () => {
    assert(/--- CC NEWS ---/.test(INSTRUCTION), 'the payload description names the block');
    assert(/^CC NEWS: only when a CC NEWS block is present/m.test(INSTRUCTION), 'and the response shape has its line');
  });


  await newsTest('a first run prints no block and hands the runner the latest version', () => {
    // The cursor is a line in the latest published brief (issue #86), so the
    // world here is an empty board and a scratch mark file, never the network.
    const world = mkNewsWorld();
    const first = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(first.status, 0, `exit 0, stderr: ${first.stderr}`);
    // Past the instruction, which names the block it is explaining.
    assert(!/--- CC NEWS ---/.test(first.stdout.slice(INSTRUCTION.length)), 'the first morning does not dump the history');
    assertEq(world.mark().split('\n')[0], '<!-- cc-news: 2.1.219 -->', 'the version line the published brief will carry');

    // The brief that publish would have made, now on the board, and a release
    // above it upstream.
    world.publish('2.1.219');
    fs.writeFileSync(world.ccFile, `# Changelog\n\n## 2.1.220\n\n- Added a \`DirectoryAdded\` hook\n- Bug fixes\n${CC_CHANGELOG}`);
    const second = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(second.status, 0, `exit 0, stderr: ${second.stderr}`);
    assert(/--- CC NEWS ---/.test(second.stdout.slice(INSTRUCTION.length)), 'the new release is flagged');
    assert(/\[hooks\]\n2\.1\.220: Added a `DirectoryAdded` hook/.test(second.stdout), 'with the entry under its topic');
    assert(/\[other\]\n2\.1\.220: Bug fixes/.test(second.stdout), 'and the housekeeping rides under other: the digest judges, not the job');
    assertEq(world.mark().split('\n')[0], '<!-- cc-news: 2.1.220 -->', 'and the cursor the next brief publishes has advanced');
    cleanup(world.home);
  });

  await newsTest('the mark file carries both lines: the cursor and the day’s stats', () => {
    // Issue #55: the runner appends this file verbatim under the digest, so
    // both lines the published brief is meant to carry leave together.
    const world = mkNewsWorld();
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const lines = world.mark().trim().split('\n');
    assertEq(lines.length, 2, `two lines, got: ${world.mark()}`);
    assert(/^<!-- cc-news: /.test(lines[0]), `the cursor leads: ${lines[0]}`);
    assert(/^<!-- workkit-stats: \{"v":1,"date":"\d{4}-\d{2}-\d{2}",/.test(lines[1]), `and the stats line follows: ${lines[1]}`);
    assert(parseStatsMark(lines[1]), 'in the shape the read-back parses');
    cleanup(world.home);
  });

  await newsTest('the stats line rides even when there was no news to carry', () => {
    // The two lines are independent: an upstream read that failed publishes no
    // cursor, and the day's numbers are not the news's to take with it.
    const world = mkNewsWorld();
    const env = { ...world.env, WORKKIT_CC_CHANGELOG: 'file:///nowhere/at/all.md' };
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    const lines = world.mark().trim().split('\n');
    assertEq(lines.length, 1, `one line, got: ${world.mark()}`);
    assert(/^<!-- workkit-stats: /.test(lines[0]), `and it is the day's numbers: ${lines[0]}`);
    cleanup(world.home);
  });

  await test('the stats line says what the payload said, not what the day happened to be', () => {
    // Composed directly, so the numbers are stated rather than swept: the line
    // is the payload's own counts, and its date is the payload's own stamp.
    const dir = mkTmp();
    const file = path.join(dir, 'mark');
    const before = process.env.WORKKIT_BRIEF_MARK_FILE;
    process.env.WORKKIT_BRIEF_MARK_FILE = file;
    writeBriefMarks(null, {
      ok: true,
      generatedAt: '2026-08-03T09:00:00.000Z',
      counts: { open: 4, waiting: 1, qa: 1, ready: 1, inFlight: 1, inbox: 1, backlog: 0 },
      closedDay: 2,
      repoCounts: [{ slug: 'owner/repo', open: 4, closedDay: 2 }],
    });
    if (before === undefined) delete process.env.WORKKIT_BRIEF_MARK_FILE;
    else process.env.WORKKIT_BRIEF_MARK_FILE = before;
    assertEq(
      fs.readFileSync(file, 'utf8'),
      '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":4,"waiting":1,"complete":0,"qa":1,"ready":1,"inFlight":1,"inbox":1,"backlog":0},"closedDay":2,"repos":{"owner/repo":{"open":4}}} -->\n',
      'the line, exactly as the runner will append it',
    );
    cleanup(dir);
  });

  await newsTest('nothing on this machine records the cursor', () => {
    const world = mkNewsWorld();
    spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assert(!fs.existsSync(path.join(world.home, '.workkit', '.cache.json')),
      'the disposable cache is not where the news cursor lives any more');
    cleanup(world.home);
  });

  await newsTest('with no mark file named, the script still prints its brief', () => {
    // The runner names the file; a human running `node jobs/brief-payload.js`
    // does not, and the payload is the whole point of the script.
    const world = mkNewsWorld();
    const env = { ...world.env };
    delete env.WORKKIT_BRIEF_MARK_FILE;
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 0, `exit 0, stderr: ${res.stderr}`);
    assert(res.stdout.startsWith(INSTRUCTION), 'the payload printed');
    cleanup(world.home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
