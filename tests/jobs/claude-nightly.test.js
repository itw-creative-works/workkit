//
// Tests for jobs/claude-nightly.sh — the summaries step the 9am job runs first,
// tested here on its own (claude-daily's suite covers the wiring).
//
// The runner is executed for real, with a fake `claude` on PATH recording the
// argument vector it was given and a fake Notifly recording the notification.
// HOME is a scratch directory and WORKKIT_HQ a scratch tree, so the log it
// appends to, the empty cwd it runs from, and the summaries it writes are all
// inside the fixture: this suite never writes to the real home, never writes to
// the real HQ, and never puts a notification on screen.
//
// WORKKIT_NIGHTLY_DATE is the clock: a Sunday and a first-of-the-month are
// fixture values here, not a wait.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-nightly.sh');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', 'jobs', 'nightly-payload.js'));

const SUMMARY = '## Went well\nThe suite went green.\n\n## Went poorly\nNothing.\n\n## Improvements\n- File the thing.\n\n## Facts learned\nBSD date takes -v.\n';
// A Sunday, and a first-of-the-month that is NOT a Sunday — so the two rollups
// can be asserted one at a time.
const SUNDAY = '2026-07-26';
const FIRST = '2026-08-01';
const WEEKDAY = '2026-07-23';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nightly-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home, a scratch HQ, a fake `claude` printing `response` and exiting
 * `status`, a fake Notifly, and a projects tree holding one fresh transcript —
 * which is what makes the day non-quiet.
 */
const mkWorld = ({ response = SUMMARY, status = 0, date = WEEKDAY, transcripts = true } = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const hq = path.join(root, 'hq');
  const projects = path.join(root, 'projects');
  fs.mkdirSync(bin, { recursive: true });
  // ~/Library/Logs is a directory every macOS home already has; the fixture home
  // is bare, so it is created here rather than by the job.
  fs.mkdirSync(path.join(home, 'Library', 'Logs'), { recursive: true });
  fs.mkdirSync(projects, { recursive: true });
  if (transcripts) {
    fs.mkdirSync(path.join(projects, 'a-repo'), { recursive: true });
    fs.writeFileSync(path.join(projects, 'a-repo', 'session.jsonl'), '{"type":"user"}\n');
  }

  const claudeLog = path.join(root, 'claude-argv.log');
  const notifLog = path.join(root, 'notifly-argv.log');
  const claude = path.join(bin, 'claude');
  const notifly = path.join(bin, 'notifly');

  fs.writeFileSync(claude, [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    // %b, not %s: the escapes JSON.stringify wrote have to become real newlines,
    // or the whole document is one line and "the four sections" proves nothing.
    `printf '%b' ${JSON.stringify(response)}`,
    `exit ${status}`,
    '',
  ].join('\n'));
  fs.writeFileSync(notifly, ['#!/usr/bin/env bash', recordArgv(notifLog), 'exit 0', ''].join('\n'));
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(notifly, 0o755);

  return {
    root,
    home,
    hq,
    projects,
    daily: (day) => path.join(hq, 'summaries', 'daily', `${day}.md`),
    weekly: (week) => path.join(hq, 'summaries', 'weekly', `${week}.md`),
    monthly: (month) => path.join(hq, 'summaries', 'monthly', `${month}.md`),
    seed: (file, text) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    },
    calls: () => readArgv(claudeLog),
    notifs: () => readArgv(notifLog),
    log: () => {
      const file = path.join(home, 'Library', 'Logs', 'claude-nightly.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    env: {
      ...process.env,
      HOME: home,
      NOTIFLY: notifly,
      PATH: `${bin}:${process.env.PATH}`,
      WORKKIT_HQ: hq,
      WORKKIT_CLAUDE_PROJECTS: projects,
      WORKKIT_NIGHTLY_DATE: date,
    },
  };
};

const runJob = (world, args = []) => spawnSync('bash', [SCRIPT, ...args], {
  encoding: 'utf8',
  timeout: 60000,
  env: world.env,
});

// The notification is fired detached on purpose — Notifly does not return until
// it is dismissed, and the job must never wait on a human. So the job exits
// BEFORE the recorder has written, and an assertion on it has to wait a moment.
const notified = async (world, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const calls = world.notifs();
    if (calls.length > 0) return calls[0];
    if (Date.now() > deadline) throw new Error('no notification was fired within the wait');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('the runner is a macOS launchd job (Notifly, BSD date, ~/Library paths)');

  group('jobs/claude-nightly: shape');

  await test('bash -n — no syntax errors', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the plist runs it through bash, but a human runs it directly');
  });

  group('jobs/claude-nightly: sending');

  await test('the payload is the day, instruction first', () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `claude ran once: ${fmtCalls(calls)}`);
    assertEq(calls[0][0], '-p', 'headless');
    assert(calls[0][1].startsWith(INSTRUCTION), 'the payload is jobs/nightly-payload.js output');
    cleanup(world.root);
  });

  await test('the rails are on the send, and they include the reading tools', () => {
    const world = mkWorld();
    runJob(world);
    const argv = world.calls()[0];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assertEq(after('--model'), 'opus', 'the reflection is the one job worth the good model');
    assert(argv.includes('--safe-mode'), 'safe mode');
    assert(argv.includes('--no-session-persistence'), 'nothing persisted');
    assertEq(after('--tools'), 'Read,Grep,Glob', 'it reads transcripts — and can do nothing else');
    assertEq(after('--add-dir'), world.projects, 'the granted root is the one the payload indexed, env seam and all');
    assertEq(after('--max-budget-usd'), '1.00', 'and a hard budget');
    cleanup(world.root);
  });

  group('jobs/claude-nightly: the summary');

  await test('the response is written to the dated file in HQ', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const file = world.daily(WEEKDAY);
    assert(fs.existsSync(file), `the summary is filed at summaries/daily/${WEEKDAY}.md`);
    const text = fs.readFileSync(file, 'utf8');
    assert(text.startsWith('## Went well'), 'the document is the model output, not a wrapper around it');
    for (const section of ['## Went poorly', '## Improvements', '## Facts learned']) {
      assert(text.includes(section), `${section} survived the write`);
    }
    await settle();
    cleanup(world.root);
  });

  await test('a night that already has a summary sends nothing', () => {
    const world = mkWorld();
    world.seed(world.daily(WEEKDAY), '# already written\n');
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.calls().length, 0, 'claude never ran — the rerun costs nothing');
    assertEq(fs.readFileSync(world.daily(WEEKDAY), 'utf8'), '# already written\n', 'and the document someone may have read is untouched');
    assert(/already has a summary/.test(world.log()), `the log says why: ${world.log()}`);
    cleanup(world.root);
  });

  await test('--now replaces today’s summary and marks its log block manual', async () => {
    const world = mkWorld();
    world.seed(world.daily(WEEKDAY), '# an earlier draft\n');
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.calls().length, 1, 'a manual rerun is how a draft gets redone');
    assert(fs.readFileSync(world.daily(WEEKDAY), 'utf8').startsWith('## Went well'), 'the draft is replaced');
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ──/.test(world.log()), `stamped manual: ${world.log().slice(0, 120)}`);
    await settle();
    cleanup(world.root);
  });

  await test('--now is never mistaken for a message', () => {
    const world = mkWorld();
    const message = runJob(world, ['--now']) && world.calls()[0][1];
    assert(!message.includes('--now'), 'the flag reaches the script, not the model');
    cleanup(world.root);
  });

  group('jobs/claude-nightly: a quiet day');

  await test('no sessions and no commits writes nothing and sends nothing', async () => {
    const world = mkWorld({ transcripts: false });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.calls().length, 0, 'nothing was sent — a summary of an empty record would be invention');
    assert(!fs.existsSync(world.daily(WEEKDAY)), 'and nothing was filed');
    assert(/quiet day/.test(world.log()), `the log names it: ${world.log()}`);
    await settle();
    assertEq(world.notifs().length, 0, 'a quiet night interrupts no one');
    cleanup(world.root);
  });

  group('jobs/claude-nightly: reporting');

  await test('the exchange is logged and the summary’s first prose line notified', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assert(res.stdout.includes('## Went well'), 'the document goes to stdout too');

    const log = world.log();
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ──/.test(log), 'one timestamped block');
    assert(log.includes('> You are writing'), 'the payload is logged, truncated to its first 200 characters');
    assert(log.includes('## Facts learned'), 'and the whole response');

    const notif = await notified(world);
    const after = (flag) => notif[notif.indexOf(flag) + 1];
    assertEq(after('--title'), 'Claude Nightly', 'titled');
    assertEq(after('--message'), 'The suite went green.', 'the headings are skipped — the first line that says something is the notification');
    cleanup(world.root);
  });

  await test('a failed send exits with its status, files nothing, and says so on screen', async () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assert(!fs.existsSync(world.daily(WEEKDAY)), 'a failure is not a summary');
    assert(world.log().includes('[exit 3]'), 'the log names the failure');
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    assert(/exit 3/.test(message), `the notification does too: ${message}`);
    cleanup(world.root);
  });

  await test('a headings-only document notifies the date it filed, never an empty message', async () => {
    const world = mkWorld({ response: '## Went well\n\n## Went poorly\n\n## Improvements\n\n## Facts learned\n' });
    runJob(world);
    const notif = await notified(world);
    assertEq(notif[notif.indexOf('--message') + 1], `summary filed for ${WEEKDAY}`, 'a blank notification reads as a job that failed');
    cleanup(world.root);
  });

  await test('a summary that cannot be written is reported, not swallowed', async () => {
    const world = mkWorld();
    // A file where the summaries directory belongs — mkdir -p cannot pass it.
    fs.mkdirSync(world.hq, { recursive: true });
    fs.writeFileSync(path.join(world.hq, 'summaries'), 'in the way\n');
    const res = runJob(world);
    assert(res.status !== 0, `the run fails: ${res.status}`);
    assertEq(world.calls().length, 1, 'the send was already paid for');
    const log = world.log();
    assert(/\[write failed: /.test(log), `the log names the stage: ${log}`);
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    assert(/could not be written/.test(message), `and the notification says so: ${message}`);
    cleanup(world.root);
  });

  await test('a payload-builder crash still logs and notifies', async () => {
    const world = mkWorld();
    // Shadow node itself: the guard has to hold even when the builder cannot run
    // at all, not just when it composes a quiet day.
    const fakeNode = path.join(world.root, 'bin', 'node');
    fs.writeFileSync(fakeNode, '#!/usr/bin/env bash\necho "boom: cannot find module" >&2\nexit 7\n');
    fs.chmodSync(fakeNode, 0o755);
    const res = runJob(world);
    assertEq(res.status, 7, 'the builder status carries through');
    assertEq(world.calls().length, 0, 'claude never ran — there was nothing to send');
    const log = world.log();
    assert(log.includes('[nightly-payload exit 7]'), 'the log names the failed stage');
    assert(log.includes('boom: cannot find module'), 'and carries the stderr');
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    assert(/nightly-payload exit 7/.test(message), `the notification says the night failed: ${message}`);
    cleanup(world.root);
  });

  await test('the job runs from an empty scratch cwd, not from /', async () => {
    const world = mkWorld();
    runJob(world);
    const scratch = path.join(world.home, 'Library', 'Caches', 'claude-nightly');
    assert(fs.existsSync(scratch), 'the empty cwd exists — launchd starts the job at / and TCC notices');
    assertEq(fs.readdirSync(scratch).length, 0, 'and stays empty, so there is nothing to scan');
    await settle();
    cleanup(world.root);
  });

  group('jobs/claude-nightly: the rollups');

  await test('a Sunday rolls the week up from the dailies, in a second send', async () => {
    const world = mkWorld({ date: SUNDAY });
    world.seed(world.daily('2026-07-22'), '## Went well\nWednesday shipped.\n');
    world.seed(world.daily('2026-07-24'), '## Went well\nFriday shipped.\n');
    // Outside the seven days the rollup reads.
    world.seed(world.daily('2026-07-10'), '## Went well\nLast fortnight.\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 2, `the daily send, then the rollup: ${calls.length}`);

    const argv = calls[1];
    const after = (flag) => argv[argv.indexOf(flag) + 1];
    assertEq(after('--tools'), '', 'the rollup reads nothing — its inputs ride inline');
    assertEq(after('--model'), 'opus', 'same model');
    const payload = argv[1];
    assert(/weekly ROLLUP for 2026-W30/.test(payload), `it is asked for the ISO week: ${payload.slice(0, 80)}`);
    assert(payload.includes('Wednesday shipped.'), 'the days of the week ride inline, verbatim');
    assert(payload.includes('Friday shipped.'), 'all of them');
    assert(payload.includes('The suite went green.'), 'including the one this run just wrote');
    assert(!payload.includes('Last fortnight.'), 'and nothing older than seven days');

    const weekly = world.weekly('2026-W30');
    assert(fs.existsSync(weekly), 'the rollup is filed under summaries/weekly/');
    assert(fs.readFileSync(weekly, 'utf8').startsWith('## Went well'), 'as the model wrote it');
    await settle();
    cleanup(world.root);
  });

  await test('a weekday rolls nothing up', async () => {
    const world = mkWorld();
    runJob(world);
    assertEq(world.calls().length, 1, 'one send, and no rollup');
    assert(!fs.existsSync(path.join(world.hq, 'summaries', 'weekly')), 'nothing is written under weekly/');
    await settle();
    cleanup(world.root);
  });

  await test('the first of the month rolls the month up from its weeklies', async () => {
    const world = mkWorld({ date: FIRST });
    world.seed(world.weekly('2026-W28'), '## Trends\nThe second week of July.\n');
    world.seed(world.weekly('2026-W31'), '## Trends\nThe last week of July.\n');
    // A week that belongs to neither the previous month nor this one.
    world.seed(world.weekly('2026-W20'), '## Trends\nMay.\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 2, `the daily send, then the monthly: ${calls.length}`);

    const payload = calls[1][1];
    assert(/monthly ROLLUP for 2026-07/.test(payload), `it is asked for the month that just ended: ${payload.slice(0, 80)}`);
    assert(payload.includes('The second week of July.'), 'the weeks July touched ride inline');
    assert(payload.includes('The last week of July.'), 'both of them');
    assert(!payload.includes('May.'), 'and no week from outside the month');

    const monthly = world.monthly('2026-07');
    assert(fs.existsSync(monthly), 'the rollup is filed under summaries/monthly/');
    await settle();
    cleanup(world.root);
  });

  await test('a quiet Sunday still closes the week', async () => {
    // A week closes on its Sunday or not at all — the next Sunday is a different
    // ISO week, so skipping the rollup loses this one permanently.
    const world = mkWorld({ date: SUNDAY, transcripts: false });
    world.seed(world.daily('2026-07-22'), '## Went well\nWednesday shipped.\n');
    world.seed(world.daily('2026-07-24'), '## Went well\nFriday shipped.\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/quiet day/.test(world.log()), 'the day itself was quiet');
    const calls = world.calls();
    assertEq(calls.length, 1, `only the rollup was sent: ${fmtCalls(calls).slice(0, 120)}`);
    assert(/weekly ROLLUP for 2026-W30/.test(calls[0][1]), 'and it is the weekly');
    assert(calls[0][1].includes('Wednesday shipped.'), 'over the days that did happen');
    assert(fs.existsSync(world.weekly('2026-W30')), 'the week is filed');
    await settle();
    cleanup(world.root);
  });

  await test('a Sunday already written up still closes the week', async () => {
    const world = mkWorld({ date: SUNDAY });
    world.seed(world.daily(SUNDAY), '## Went well\nSunday, already written.\n');
    world.seed(world.daily('2026-07-24'), '## Went well\nFriday shipped.\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/already has a summary/.test(world.log()), 'the daily half was skipped');
    const calls = world.calls();
    assertEq(calls.length, 1, `and only the rollup was sent: ${calls.length}`);
    assert(calls[0][1].includes('Sunday, already written.'), 'the existing document is one of its inputs');
    assert(fs.existsSync(world.weekly('2026-W30')), 'the week is filed');
    await settle();
    cleanup(world.root);
  });

  await test('a quiet first of the month still closes the month', async () => {
    const world = mkWorld({ date: FIRST, transcripts: false });
    world.seed(world.weekly('2026-W28'), '## Trends\nThe second week of July.\n');

    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `only the monthly was sent: ${calls.length}`);
    assert(/monthly ROLLUP for 2026-07/.test(calls[0][1]), 'and it is the monthly');
    assert(fs.existsSync(world.monthly('2026-07')), 'the month is filed');
    await settle();
    cleanup(world.root);
  });

  await test('a rollup with nothing to roll up is skipped, not an error', async () => {
    const world = mkWorld({ date: FIRST });
    const res = runJob(world);
    assertEq(res.status, 0, 'a month with no weeklies is not a failure');
    assertEq(world.calls().length, 1, 'and nothing is sent for it');
    assert(/monthly rollup for 2026-07 skipped/.test(world.log()), `the log says so: ${world.log()}`);
    assert(!fs.existsSync(world.monthly('2026-07')), 'nothing is filed');
    await settle();
    cleanup(world.root);
  });

  group('jobs/claude-nightly: the manual trigger');

  await test('npm run nightly is the trigger, and it points at this script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const script = pkg.scripts.nightly;
    assert(typeof script === 'string' && script.includes('--now'), `the nightly script runs the manual flag, got: ${script}`);
    const target = script.match(/(jobs\/[\w-]+\.sh)/);
    assert(target, `it names a jobs script, got: ${script}`);
    assert(fs.existsSync(path.join(__dirname, '..', '..', target[1])), `${target[1]} resolves from the repo root`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
