//
// Tests for jobs/morning.sh as THIS MACHINE runs it — the 9am launchd job: the
// summaries step, the dispatch that hands the brief to the cloud, and the site
// publish. The same script on a runner is morning-cloud.test.js; the two suites
// are the two environments, not two scripts.
//
// The runner is executed for real, with a fake `claude` on PATH recording the
// argument vector it was given and a fake Notifly recording the notification.
// HOME is a scratch directory, so the log it appends to and the empty cwd it
// runs from are both inside the fixture: this suite never writes to the real
// home and never puts a notification on screen. The summaries step it calls gets
// the same treatment — a scratch WORKFLOW_HOME with no home repo named in it, so
// it has nowhere to publish, sends nothing, and the assertions below see only
// the brief (the step's own suite covers the publishing).
//
// EVERY world carries a recording `gh` shim, and it lives in ~/.local/bin rather
// than beside the others: the runner exports a PATH of its own beginning there
// and including /opt/homebrew/bin, so a shim anywhere else would lose to the
// real `gh` and this suite would reach GitHub. A world with nowhere to publish
// gets one too — a skip is proved by a recorder that stayed silent, never by the
// tool being absent, which no assertion could tell from a skip that never ran.
//
// GITHUB_ACTIONS is stripped from every world: a suite run inside Actions would
// otherwise take the cloud branch of the very script it is testing here.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'morning.sh');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', 'jobs', 'brief-payload.js'));

// A `gh` call that is the brief's business with the board — listing today's
// posts, resolving a category, creating the Discussion.
const BRIEF_GH = /discussions\(first|discussionCategories|createDiscussion/;

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'morning-local-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The date a Discussion would be titled with is the LOCAL one (`date
// '+%Y-%m-%d'`), which is not always today in UTC.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A scratch home, a fake `claude` printing `response` and exiting `status`, and
 * a fake Notifly. Returns everything an assertion needs to read back.
 *
 * `logsDir: false` leaves ~/Library/Logs out — the bare home the job has to
 * make its own log directory in.
 * `transcripts: false` leaves ~/.claude/projects out — the machine whose day the
 * summaries step cannot read, and that gate's red side.
 * `home` is the home repo slug to name in the settings file; null is a machine
 * with nowhere to publish, and it gets the same recording `gh` shim so the skip
 * is something an assertion can see.
 * `badSettings` writes a settings file that does not parse — the shape the site
 * publish warns about rather than reading as a default.
 * `posted` is what that repo's discussions already carry, as `{ title, body }`.
 * `ghFails` makes every API call refuse.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 * `dispatch` is whether `gh workflow run` lands — false by default, which is the
 * machine that cannot reach the cloud, and since issue #107 that is a briefless
 * morning rather than a local brief.
 * `secrets` is the names `gh secret list` reports — both by default, the repo
 * whose runner can actually compose the brief and sweep the board.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0, logsDir = true,
  home: homeRepo = null, posted = [], ghFails = false, ccChangelog = null, badSettings = false,
  dispatch = false, secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN'],
  secretsUnlistable = false,
  transcripts = true,
} = {}) => {
  const root = mkTmp();
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(workflowHome, { recursive: true });
  fs.writeFileSync(
    path.join(workflowHome, 'settings.json'),
    badSettings
      ? '{ "version": 1, "site": { "repo": '
      : JSON.stringify({ version: 1, site: { repo: homeRepo, publish: false, url: null } }, null, 2),
  );
  // ~/Library/Logs is a directory every macOS home already has; the fixture home
  // is bare, so it is created here rather than by the job.
  if (logsDir) fs.mkdirSync(path.join(home, 'Library', 'Logs'), { recursive: true });
  // The session transcripts the summaries step is gated on. Empty is enough —
  // the step's own guards call that a quiet day.
  if (transcripts) fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });

  const claudeLog = path.join(root, 'claude-argv.log');
  const notifLog = path.join(root, 'notifly-argv.log');
  const claude = path.join(bin, 'claude');
  const notifly = path.join(bin, 'notifly');

  fs.writeFileSync(claude, [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    // %b, not %s: the escapes JSON.stringify wrote have to become real newlines,
    // or the whole response is one line and "first line" proves nothing.
    `printf '%b' ${JSON.stringify(response)}`,
    `exit ${status}`,
    '',
  ].join('\n'));
  fs.writeFileSync(notifly, ['#!/usr/bin/env bash', recordArgv(notifLog), 'exit 0', ''].join('\n'));
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(notifly, 0o755);

  // The `gh` the publish speaks to, and the one the news cursor reads back
  // through. EVERY world gets it, including the ones with nowhere to publish:
  // a recorder that logged nothing is what proves a skip, and it also keeps the
  // real `gh` off the path of a suite that must never reach GitHub.
  const ghLog = path.join(root, 'gh-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  const localBin = path.join(home, '.local', 'bin');
  fs.mkdirSync(localBin, { recursive: true });
  const nodes = posted.map(({ title, body = '' }) => JSON.stringify({
    title, createdAt: `${today()}T09:00:00Z`, body,
  })).join(',');
  fs.writeFileSync(path.join(localBin, 'gh'), [
    '#!/usr/bin/env bash',
    recordArgv(ghLog),
    ...(ghFails ? ['exit 1'] : []),
    'all="$*"',
    'case "$all" in',
    // The cloud trigger. A refusal is the morning that gets no brief at all.
    `  "workflow run"*) exit ${dispatch ? 0 : 1} ;;`,
    // The secrets the runner needs, checked before the day is handed to it. Both
    // are required, so each world names exactly the ones it carries.
    `  "secret list"*) ${secretsUnlistable ? 'exit 1' : `printf '%s\\n'${secrets.map((n) => ` "${n}\tUpdated 2026-07-01"`).join('')}`} ;;`,
    '  *createDiscussion*)',
    // The body travels as `@file` and the file goes away with the run, so
    // what was published is kept here for the assertions.
    `    for a in "$@"; do case "$a" in body=@*) cat "\${a#body=@}" >> ${JSON.stringify(bodyLog)} ;; esac; done`,
    `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/private-home/discussions/9"}}}}' ;;`,
    '  *discussionCategories*)',
    `    printf '%s' '{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":true,"discussionCategories":{"nodes":[{"id":"DIC_0","name":"General"}]}}}}' ;;`,
    '  *"discussions(first"*)',
    `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[${nodes}]}}}}' ;;`,
    '  *) printf \'%s\' \'{}\' ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(localBin, 'gh'), 0o755);

  // The upstream CHANGELOG the news read is pointed at. `/dev/null` is the
  // module's silent-skip path — an empty body, no version, no line.
  let ccSource = 'file:///dev/null';
  if (ccChangelog) {
    const file = path.join(root, 'cc-changelog.md');
    fs.writeFileSync(file, ccChangelog);
    ccSource = `file://${file}`;
  }

  const env = {
    ...process.env,
    HOME: home,
    NOTIFLY: notifly,
    PATH: `${bin}:${process.env.PATH}`,
    // The summaries step's one seam: where it looks for the home repo.
    WORKFLOW_HOME: workflowHome,
    WORKKIT_CC_CHANGELOG: ccSource,
  };
  // This suite IS the machine's environment, and the script asks Actions' own
  // variable which one it woke up in.
  delete env.GITHUB_ACTIONS;

  return {
    root,
    home,
    workflowHome,
    notifly,
    nightlyLog: path.join(home, 'Library', 'Logs', 'claude-nightly.log'),
    calls: () => readArgv(claudeLog),
    notifs: () => readArgv(notifLog),
    ghCalls: () => readArgv(ghLog),
    // What the publish doctrine actually claims about a machine with nowhere to
    // publish: no discussion is listed, resolved or created. A version probe or
    // an auth check is not a brief reaching GitHub.
    briefGhCalls: () => readArgv(ghLog).filter((c) => BRIEF_GH.test(c.join(' '))),
    created: () => readArgv(ghLog).filter((c) => c.join(' ').includes('createDiscussion')),
    dispatched: () => readArgv(ghLog).filter((c) => c[0] === 'workflow' && c[1] === 'run'),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    log: () => {
      const file = path.join(home, 'Library', 'Logs', 'claude-daily.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    env,
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

// The first notification whose message matches — the summaries step fires its
// own, so "the brief's notification" is the one that says so, not the first one
// recorded.
const notifiedMatching = async (world, pattern, ms = 5000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const hit = world.notifs().find((c) => pattern.test(c[c.indexOf('--message') + 1] || ''));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no notification matching ${pattern} was fired within the wait`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('the machine leg is a macOS launchd job (Notifly, ~/Library paths)');

  group('jobs/morning (local): shape');

  await test('bash -n — no syntax errors', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the plist runs it through bash, but a human runs it directly');
  });

  group('jobs/morning (local): sending');

  await test('an argument overrides the payload and reaches claude verbatim', () => {
    const world = mkWorld();
    const res = runJob(world, ['just', 'this message']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `claude ran once: ${fmtCalls(calls)}`);
    assertEq(calls[0][0], '-p', 'headless');
    assertEq(calls[0][1], 'just this message', 'the arguments are the whole message');
    cleanup(world.root);
  });

  await test('the rehearsal payload is the brief, instruction first', () => {
    // `--now`, because the scheduled morning composes nothing here any more
    // (issue #107) — the rehearsal is what still exercises the local compose.
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
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
    assertEq(after('--tools'), '', 'no tools — it reads a payload and writes prose');
    assertEq(after('--max-budget-usd'), '0.25', 'and a hard budget');
    cleanup(world.root);
  });

  group('jobs/morning (local): reporting');

  await test('the response is printed, logged, and its first line notified', async () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the response goes to stdout');

    const log = world.log();
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ──/.test(log), 'one timestamped block');
    assert(log.includes('> hello'), 'the message is logged, truncated to its first 200 characters');
    assert(log.includes('IN FLIGHT: nothing.'), 'and the whole response');

    const notif = await notified(world);
    const after = (flag) => notif[notif.indexOf(flag) + 1];
    assertEq(after('--title'), 'Claude Daily', 'titled');
    assertEq(after('--message'), 'HEADLINE: one thing today.', 'the headline IS the notification');
    cleanup(world.root);
  });

  await test('a home with no Library/Logs gets one — the exchange is still logged', () => {
    const world = mkWorld({ logsDir: false });
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `the append cannot fail the job: ${res.stderr}`);
    assert(world.log().includes('HEADLINE: one thing today.'), `the log was created and written: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a failed send exits with its status and says so on screen', async () => {
    const world = mkWorld({ response: 'budget exceeded', status: 3 });
    const res = runJob(world, ['hello']);
    assertEq(res.status, 3, 'the exit status carries through');
    assert(world.log().includes('[exit 3]'), 'the log names the failure');
    const notif = await notified(world);
    const message = notif[notif.indexOf('--message') + 1];
    assert(/exit 3/.test(message), `the notification does too: ${message}`);
    cleanup(world.root);
  });

  await test('a payload-builder crash still logs and notifies', async () => {
    const world = mkWorld();
    // Shadow node itself: the guard has to hold even when the builder cannot
    // run at all, not just when it returns ok:false.
    const fakeNode = path.join(world.root, 'bin', 'node');
    fs.writeFileSync(fakeNode, '#!/usr/bin/env bash\necho "boom: cannot find module" >&2\nexit 7\n');
    fs.chmodSync(fakeNode, 0o755);
    const res = runJob(world, ['--now']);
    assertEq(res.status, 7, 'the builder status carries through');
    assertEq(world.calls().length, 0, 'claude never ran — there was nothing to send');
    const log = world.log();
    assert(log.includes('[brief-payload exit 7]'), 'the log names the failed stage');
    assert(log.includes('boom: cannot find module'), 'and carries the stderr');
    await notifiedMatching(world, /brief-payload exit 7/);
    cleanup(world.root);
  });

  await test('the job runs from an empty scratch cwd, not from /', () => {
    const world = mkWorld();
    runJob(world, ['hello']);
    const scratch = path.join(world.home, 'Library', 'Caches', 'claude-daily');
    assert(fs.existsSync(scratch), 'the empty cwd exists — launchd starts the job at / and TCC notices');
    assertEq(fs.readdirSync(scratch).length, 0, 'and stays empty, so there is nothing to scan');
    cleanup(world.root);
  });

  group('jobs/morning (local): the summaries step');

  await test('the summaries step runs, and with no home repo it only logs its skip', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    assertEq(world.calls().length, 0, `nothing was sent from this machine: ${fmtCalls(world.calls()).slice(0, 160)}`);
    assert(fs.existsSync(world.nightlyLog), 'the step ran — it kept its own log');
    assert(/summaries: no home repo configured — skipped/.test(fs.readFileSync(world.nightlyLog, 'utf8')),
      'and said why it had nothing to do');
    await settle();
    cleanup(world.root);
  });

  await test('a machine with no session transcripts names the skip and never starts the step', async () => {
    // The capability gate from its red side (issue #107): the summaries read
    // this machine's transcripts, and a machine without them has no day to write
    // up. The named skip is what tells that apart from a step that failed.
    const world = mkWorld({ transcripts: false });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/summaries: this machine has no session transcripts to read — skipped/.test(world.log()),
      `the log names the gate: ${world.log()}`);
    assert(!fs.existsSync(world.nightlyLog), 'and the step was never started');
    await settle();
    cleanup(world.root);
  });

  await test('a summaries failure never stops the morning', async () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    // A directory where the step's log file belongs: its first append fails, and
    // the step exits non-zero — the shape of failure that costs the most to
    // swallow, since the morning would be lost to the night before.
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world);
    assertEq(res.status, 0, 'the morning is not lost to the night before');
    assert(/\[summaries exit \d+ — the brief continues\]/.test(world.log()),
      `the log names the failed step: ${world.log().slice(0, 300)}`);
    assertEq(world.dispatched().length, 1, 'and the day was still handed over');
    await settle();
    cleanup(world.root);
  });

  await test('a summaries failure still produces the rehearsal brief', async () => {
    const world = mkWorld();
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, 'the morning is not lost to the night before');
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still printed');
    const calls = world.calls();
    assertEq(calls.length, 1, `and the brief was sent: ${calls.length}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'the brief, not the flag');
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    cleanup(world.root);
  });

  await test('a message argument runs the send alone, summaries and all skipped', () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `one send: ${fmtCalls(calls).slice(0, 160)}`);
    assertEq(calls[0][1], 'hello', 'the generic headless runner is still generic');
    assert(!fs.existsSync(world.nightlyLog), 'and the summaries step never ran at all');
    cleanup(world.root);
  });

  group('jobs/morning (local): the site publish');

  await test('the publish runs after the brief, quietly, and never before it', async () => {
    // The order is proved by the log rather than by the file: a rehearsal that
    // warns from the publish writes both blocks, and the brief's is the earlier.
    const world = mkWorld({ badSettings: true });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const log = world.log();
    assert(log.includes('HEADLINE: one thing today.'), `the brief reached the log: ${log}`);
    assert(log.indexOf('publish:') > log.indexOf('HEADLINE: one thing today.'),
      `and nothing is built before the brief has gone: ${log}`);

    const text = fs.readFileSync(SCRIPT, 'utf8');
    assert(/publish\.sh" --quiet/.test(text), 'the daily run asks for the quiet variant');
    assert(/publish exit %d — the brief was already sent/.test(text), 'and a failure is logged, never fatal');
    await settle();
    cleanup(world.root);
  });

  // The site publish's own block, told apart from the brief's lines, which say
  // `brief: …` right beside it. Every line publish.sh prints is prefixed
  // `publish: ` — including the warnings no `--quiet` suppresses.
  const SITE_BLOCK = /publish:/;

  await test('a machine with no home repo hears nothing about publishing', async () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
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

  await test('a publish that warns is heard — the block is not scoped to its failures', () => {
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

  group('jobs/morning (local): the brief is the cloud’s');

  // Since issue #107 the scheduled brief on this machine is the dispatch and
  // nothing else. Everything below is about the day going over — or not going
  // over, which is a briefless morning and never a local compose.

  await test('a dispatch that lands hands the day to the cloud and composes nothing here', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    const sent = world.dispatched();
    assertEq(sent.length, 1, `one workflow run: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assertEq(sent[0][2], 'brief.yml', 'and it names the brief workflow');
    assertEq(sent[0][3], '--repo', 'on a repo');
    // The HOME repo (issue #91), which is where setup seeded the workflow and
    // wrote the secrets — never this checkout's own, which is distributed.
    assertEq(sent[0][4], 'owner/private-home', 'the home repo this machine is configured for');

    assertEq(world.calls().length, 0, `claude never ran here: ${fmtCalls(world.calls()).slice(0, 200)}`);
    assertEq(world.created().length, 0, 'and nothing was published from this machine');
    assert(/dispatched brief\.yml on /.test(world.log()), `the log records the dispatch: ${world.log()}`);
    assert(res.stdout.includes('dispatched brief.yml on'), 'and says so on screen');
    cleanup(world.root);
  });

  await test('the summaries step still runs before the dispatch', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    assert(fs.existsSync(world.nightlyLog), 'yesterday is written up whether or not the day goes over');
    cleanup(world.root);
  });

  await test('the site publish still runs after a dispatch — the site is this machine\'s', () => {
    const world = mkWorld({ badSettings: true, dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/does not parse as JSON/.test(world.log()), `the publish leg ran: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a dispatch that does not land is a logged, briefless morning', async () => {
    // Issue #107: the local compose is GONE, not no-opped. The brief needs the
    // sweep token and the roster, which live on the home repo, so a morning the
    // day cannot be handed over is a morning with no brief — and the log is the
    // only place that says why.
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 1, 'the trigger was tried');
    assertEq(world.calls().length, 0, `and nothing was composed here: ${fmtCalls(world.calls()).slice(0, 200)}`);
    assertEq(world.created().length, 0, 'nothing was published from this machine');
    assert(/no brief this morning/.test(world.log()), `the log says the morning is briefless: ${world.log()}`);
    assert(/did not land/.test(world.log()), `and names the reason: ${world.log()}`);
    assert(/no brief this morning/.test(res.stderr), `it reaches the plist log too: ${res.stderr}`);
    await settle();
    assertEq(world.notifs().length, 0, 'and nothing was announced — there is no digest to announce');
    cleanup(world.root);
  });

  await test('no secrets at all and an unlistable repo are told apart', async () => {
    // Both are briefless mornings, but the line's whole job is the honest why:
    // a successful listing that names nothing means setup never wired the
    // secrets; a listing that FAILED means this token cannot read the repo.
    const bare = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: [] });
    let res = runJob(bare);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(bare.dispatched().length, 0, 'nothing was triggered');
    assert(/carries no secrets/.test(bare.log()), `an empty listing blames the missing secrets: ${bare.log()}`);
    assert(!/could not be listed/.test(bare.log()), 'and never the listing');
    await settle();
    cleanup(bare.root);

    const unlistable = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: [], secretsUnlistable: true });
    res = runJob(unlistable);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/could not be listed/.test(unlistable.log()), `a failed listing says so: ${unlistable.log()}`);
    await settle();
    cleanup(unlistable.root);
  });

  await test('a repo without the OAuth secret is never handed the day', async () => {
    // `gh workflow run` succeeds the moment the file is on the default branch,
    // secrets or not — and a runner without the token composes nothing. Naming
    // the missing secret is the whole value of the check.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: ['WORKKIT_GITHUB_TOKEN'] });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    assert(/CLAUDE_CODE_OAUTH_TOKEN/.test(world.log()), `the log names the secret: ${world.log()}`);
    await settle();
    cleanup(world.root);
  });

  await test('a repo without the board token is never handed the day either', async () => {
    // The OAuth token alone buys a runner that composes — over an empty board.
    // `WORKKIT_GITHUB_TOKEN` is the credential every issue read uses, so a
    // morning without it is a digest about nothing. Both names, or nothing goes.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true, secrets: ['CLAUDE_CODE_OAUTH_TOKEN'] });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    assert(/WORKKIT_GITHUB_TOKEN/.test(world.log()), `the log names the secret: ${world.log()}`);
    await settle();
    cleanup(world.root);
  });

  await test('both secret names present is what lets the day go to the cloud', () => {
    // The positive half of the pair: the default world carries both, and it is
    // the only shape that dispatches.
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    assertEq(world.dispatched().length, 1, 'the day was handed over');
    assertEq(world.calls().length, 0, 'and nothing was composed here');
    cleanup(world.root);
  });

  await test('a machine with no home repo never dispatches, and says so', async () => {
    // Issue #91: the workflow and its secrets live on the home repo, so a
    // machine that has none has nowhere to hand the day to.
    const world = mkWorld({ home: null, dispatch: true });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'nothing was triggered');
    assert(!/dispatched/.test(world.log()), `and nothing was claimed: ${world.log()}`);
    assert(/no home repo is configured/.test(world.log()), `the log names the reason: ${world.log()}`);
    assertEq(world.calls().length, 0, 'nothing was composed here');
    await settle();
    cleanup(world.root);
  });

  await test('the secrets are checked on the repo the dispatch names', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world);
    const checks = world.ghCalls().filter((c) => c[0] === 'secret' && c[1] === 'list');
    assertEq(checks.length, 1, `one listing, on the scheduled morning only: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assertEq(checks[0][2], '--repo', 'scoped to a repo');
    assertEq(checks[0][3], world.dispatched()[0][4], 'the same slug the dispatch went to');
    cleanup(world.root);
  });

  await test('--now never dispatches — a rehearsal must not hand the day to a runner', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assertEq(world.dispatched().length, 0, 'the cloud was never asked');
    assertEq(world.calls().length, 1, 'the rehearsal ran here');
    assertEq(world.created().length, 0, 'and published nothing, as it always did');
    cleanup(world.root);
  });

  await test('a message argument never dispatches — the generic runner stays generic', () => {
    const world = mkWorld({ home: 'owner/private-home', dispatch: true });
    runJob(world, ['hello']);
    assertEq(world.dispatched().length, 0, 'no workflow was triggered');
    assertEq(world.calls()[0][1], 'hello', 'the message went straight to claude');
    cleanup(world.root);
  });

  await test('nothing this machine sends is ever posted as a Discussion', async () => {
    // The publishing half of issue #107: the digest is published by whoever
    // composed it, and this machine composes no scheduled brief. A rehearsal and
    // a message run reach the board for nothing at all.
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a hook\n' });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still ran end to end');
    assertEq(world.created().length, 0, `and nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 300)}`);
    assertEq(world.postedBody(), '', 'no body reached the board');
    await settle();
    cleanup(world.root);
  });

  await test('the run leaves no cursor file behind on this machine', () => {
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a hook\n' });
    runJob(world, ['--now']);
    assert(!fs.existsSync(path.join(world.workflowHome, '.cache.json'))
      || !('ccNews' in JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.cache.json'), 'utf8'))),
    'the cursor is the Discussion — nothing writes ccNews any more');
    cleanup(world.root);
  });

  group('jobs/morning (local): the manual trigger');

  await test('--now sends the same brief, not the flag as a message', () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const message = world.calls()[0][1];
    assert(message.startsWith(INSTRUCTION), 'the flag reaches the compose step — the payload the cloud sends');
    assert(!message.includes('--now'), 'and is never mistaken for the message');
    cleanup(world.root);
  });

  await test('--now marks its log block manual, in the same log file', () => {
    const world = mkWorld();
    runJob(world, ['--now']);
    const log = world.log();
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ──/.test(log), `stamped manual, got: ${log.slice(0, 120)}`);
    cleanup(world.root);
  });

  await test('a scheduled run is not marked manual', () => {
    const world = mkWorld();
    runJob(world);
    assert(!/\(manual\)/.test(world.log()), 'the 9am block reads as it always did');
    cleanup(world.root);
  });

  await test('npm run brief is the trigger, and it points at this script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const script = pkg.scripts.brief;
    assert(typeof script === 'string' && script.includes('--now'), `the brief script runs the manual flag, got: ${script}`);
    const target = script.match(/(jobs\/[\w-]+\.sh)/);
    assert(target, `it names a jobs script, got: ${script}`);
    assert(fs.existsSync(path.join(__dirname, '..', '..', target[1])), `${target[1]} resolves from the repo root`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
