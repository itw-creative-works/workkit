//
// Tests for jobs/claude-daily.sh — the headless runner behind the 9am agent,
// the one cron: the summaries step and then the brief.
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-daily.sh');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', 'jobs', 'brief-payload.js'));

// A `gh` call that is the brief's business with the board — listing today's
// posts, resolving a category, creating the Discussion.
const BRIEF_GH = /discussions\(first|discussionCategories|createDiscussion/;

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-daily-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The date the runner titles its Discussion with is the LOCAL one (`date
// '+%Y-%m-%d'`), which is not always today in UTC.
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * A scratch home, a fake `claude` printing `response` and exiting `status`, and
 * a fake Notifly. Returns everything an assertion needs to read back.
 *
 * `logsDir: false` leaves ~/Library/Logs out — the bare home the job has to
 * make its own log directory in.
 * `home` is the home repo slug to name in the settings file; null is a machine
 * with nowhere to publish, and it gets the same recording `gh` shim so the skip
 * is something an assertion can see.
 * `badSettings` writes a settings file that does not parse — the shape the site
 * publish warns about rather than reading as a default.
 * `posted` is what that repo's discussions already carry, as `{ title, body }`
 * — the check-before-post guard's input, and the news cursor's.
 * `ghFails` makes every API call refuse.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0, logsDir = true,
  home: homeRepo = null, posted = [], ghFails = false, ccChangelog = null, badSettings = false,
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
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    log: () => {
      const file = path.join(home, 'Library', 'Logs', 'claude-daily.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    env: {
      ...process.env,
      HOME: home,
      NOTIFLY: notifly,
      PATH: `${bin}:${process.env.PATH}`,
      // The summaries step's one seam: where it looks for the home repo.
      WORKFLOW_HOME: workflowHome,
      WORKKIT_CC_CHANGELOG: ccSource,
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
  if (process.platform !== 'darwin') skipSuite('the runner is a macOS launchd job (Notifly, ~/Library paths)');

  group('jobs/claude-daily: shape');

  await test('bash -n — no syntax errors', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the plist runs it through bash, but a human runs it directly');
  });

  group('jobs/claude-daily: sending');

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

  await test('with no argument the payload is the brief, instruction first', () => {
    const world = mkWorld();
    const res = runJob(world);
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

  group('jobs/claude-daily: reporting');

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
    const res = runJob(world);
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

  group('jobs/claude-daily: the summaries step');

  await test('the summaries step runs FIRST, and with no home repo it only logs its skip', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);

    const calls = world.calls();
    assertEq(calls.length, 1, `one send — the step has nowhere to publish: ${fmtCalls(calls).slice(0, 160)}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'and it was the brief');
    assert(fs.existsSync(world.nightlyLog), 'the step ran — it kept its own log');
    assert(/summaries: no home repo configured — skipped/.test(fs.readFileSync(world.nightlyLog, 'utf8')),
      'and said why it had nothing to do');
    await settle();
    cleanup(world.root);
  });

  await test('a summaries failure still produces the brief', async () => {
    const world = mkWorld();
    // A directory where the step's log file belongs: its first append fails, and
    // the step exits non-zero — the shape of failure that costs the most to
    // swallow, since the morning would be lost to the night before.
    fs.mkdirSync(world.nightlyLog, { recursive: true });

    const res = runJob(world);
    assertEq(res.status, 0, 'the morning is not lost to the night before');
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still printed');
    const calls = world.calls();
    assertEq(calls.length, 1, `and the brief was sent: ${calls.length}`);
    assert(calls[0][1].startsWith(INSTRUCTION), 'the brief, not the flag');
    assert(/\[summaries exit \d+ — the brief continues\]/.test(world.log()), `the log names the failed step: ${world.log().slice(0, 300)}`);
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    cleanup(world.root);
  });

  await test('a message argument runs the brief’s runner alone, summaries and all skipped', () => {
    const world = mkWorld();
    const res = runJob(world, ['hello']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const calls = world.calls();
    assertEq(calls.length, 1, `one send: ${fmtCalls(calls).slice(0, 160)}`);
    assertEq(calls[0][1], 'hello', 'the generic headless runner is still generic');
    assert(!fs.existsSync(world.nightlyLog), 'and the summaries step never ran at all');
    cleanup(world.root);
  });

  group('jobs/claude-daily: the site publish');

  await test('the publish runs after the brief, quietly, and never before it', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    const sent = text.indexOf('RESPONSE="$(claude -p');
    const published = text.indexOf('workflow/publish.sh');
    assert(sent !== -1 && published > sent, 'the brief is sent before anything is built');
    assert(/publish\.sh" --quiet/.test(text), 'and the daily run asks for the quiet variant');
    assert(/publish exit %d — the brief was already sent/.test(text), 'a failure is logged, never fatal');
  });

  // The site publish's own block, told apart from the brief's Discussion, which
  // logs a line of its own about publishing right beside it. Every line
  // publish.sh prints is prefixed `publish: ` — including the warnings no
  // `--quiet` suppresses — and the brief's lines say `brief: … nothing
  // published`, so the colon is what tells the two apart.
  const SITE_BLOCK = /publish:/;

  await test('a machine with no home repo hears nothing about publishing', async () => {
    const world = mkWorld();
    const res = runJob(world);
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

  group('jobs/claude-daily: the brief is published');

  const CC_CHANGELOG = '# Changelog\n\n## 2.1.220\n\n- Added a `DirectoryAdded` hook\n';

  await test('the digest response is posted as a Discussion titled with the date', () => {
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const created = world.created();
    assertEq(created.length, 1, `one createDiscussion mutation: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    const argv = created[0].join(' ');
    assert(argv.includes(`title=brief: ${today()}`), `the title carries the date: ${argv}`);
    const body = world.postedBody();
    assert(/HEADLINE: one thing today\./.test(body), `the digest response is the body: ${body}`);
    assert(/IN FLIGHT: nothing\./.test(body), 'all of it, not just the headline');
    assert(!body.includes('You are producing the owner'), 'and never the payload it answered');
    assert(/posted brief: /.test(world.log()), `the log says it published: ${world.log()}`);
    assert(/discussions\/9/.test(world.log()), 'and names the discussion');
    cleanup(world.root);
  });

  await test('the body carries the upstream version it covered, one machine-readable line', () => {
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: CC_CHANGELOG });
    runJob(world);
    const body = world.postedBody();
    assert(/<!-- cc-news: 2\.1\.220 -->/.test(body), `the cursor the next morning reads: ${body}`);
    assert(body.indexOf('HEADLINE') < body.indexOf('<!-- cc-news'), 'after the digest, never in front of it');
    cleanup(world.root);
  });

  await test('a run whose news could not be read publishes no version line', () => {
    // Nothing on the board and nothing upstream: there has never been a version,
    // so the brief carries none rather than inventing one.
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world);
    assert(!/cc-news:/.test(world.postedBody()), `no line at all: ${world.postedBody()}`);
    cleanup(world.root);
  });

  await test('a failed upstream read carries the board\'s version forward', () => {
    const world = mkWorld({
      home: 'owner/private-home',
      posted: [{ title: 'brief: 2026-07-01', body: '<!-- cc-news: 2.1.219 -->' }],
    });
    runJob(world);
    assert(/<!-- cc-news: 2\.1\.219 -->/.test(world.postedBody()),
      `the cursor holds rather than rewinding: ${world.postedBody()}`);
    cleanup(world.root);
  });

  await test('today\'s brief already on the board is not posted twice', async () => {
    const world = mkWorld({ home: 'owner/private-home', posted: [{ title: `brief: ${today()}` }] });
    const res = runJob(world);
    assertEq(res.status, 0, 'exit 0');
    assertEq(world.created().length, 0, `nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    assert(/already carries brief: /.test(world.log()), `and the log says so: ${world.log()}`);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the local morning happened anyway');
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    cleanup(world.root);
  });

  await test('an API that refuses is logged, and the morning is untouched', async () => {
    const world = mkWorld({ home: 'owner/private-home', ghFails: true });
    const res = runJob(world);
    assertEq(res.status, 0, 'a brief that cannot be posted is still a brief');
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'it printed');
    await notifiedMatching(world, /^HEADLINE: one thing today\.$/);
    assert(/nothing posted/.test(world.log()), `the log says what happened: ${world.log()}`);
    assert(!/posted brief: /.test(world.log()), 'and never claims to have published');
    cleanup(world.root);
  });

  await test('no home repo is a named skip, and no discussion call is made', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/brief: no home repo configured — nothing published/.test(world.log()),
      `the log names the reason: ${world.log()}`);
    assertEq(world.briefGhCalls().length, 0,
      `the recorder on PATH stayed silent: ${fmtCalls(world.ghCalls()).slice(0, 400)}`);
    await settle();
    cleanup(world.root);
  });

  await test('a failed send publishes nothing — an error is not a digest', () => {
    const world = mkWorld({ home: 'owner/private-home', response: 'budget exceeded', status: 3 });
    const res = runJob(world);
    assertEq(res.status, 3, 'the exit status carries through');
    assertEq(world.created().length, 0, 'and no Discussion carries the failure');
    cleanup(world.root);
  });

  await test('a message argument publishes no brief', () => {
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world, ['hello']);
    assertEq(world.created().length, 0, 'the generic headless runner stays generic');
    cleanup(world.root);
  });

  await test('the run leaves no cursor file behind on this machine', () => {
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: CC_CHANGELOG });
    runJob(world);
    assert(!fs.existsSync(path.join(world.workflowHome, '.cache.json'))
      || !('ccNews' in JSON.parse(fs.readFileSync(path.join(world.workflowHome, '.cache.json'), 'utf8'))),
    'the cursor is the Discussion — nothing writes ccNews any more');
    cleanup(world.root);
  });

  group('jobs/claude-daily: the manual trigger');

  await test('--now sends the same brief, not the flag as a message', () => {
    const world = mkWorld();
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const message = world.calls()[0][1];
    assert(message.startsWith(INSTRUCTION), 'the flag reaches the compose step — same payload as 9am');
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

  await test('--now publishes nothing — a rehearsal must not claim the day', () => {
    // A manual run at noon that posted `brief: <today>` would make the nine
    // o'clock brief find its own post already there and skip, and would advance
    // the cursor on news the scheduled run has yet to report.
    const world = mkWorld({ home: 'owner/private-home', ccChangelog: '# Changelog\n\n## 2.1.220\n\n- Added a hook\n' });
    const res = runJob(world, ['--now']);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.includes('HEADLINE: one thing today.'), 'the brief still ran end to end');
    assertEq(world.created().length, 0, `and nothing was posted: ${fmtCalls(world.ghCalls()).slice(0, 300)}`);
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
