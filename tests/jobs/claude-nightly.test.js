//
// Tests for jobs/claude-nightly.sh — the summaries step the 9am job runs first,
// which writes the day up and PUBLISHES it as a Discussion on the home repo
// (issue #27).
//
// The runner is executed for real against shims: a `claude` that answers with a
// summary, and a `gh` that answers the three GraphQL calls the delivery makes
// with canned JSON. HOME and WORKFLOW_HOME are scratch directories, so the log
// it appends to and the settings file it reads are both inside the fixture —
// this suite never touches the real home, never reaches GitHub, never writes a
// summary to disk, and never puts a notification on screen.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, skipSuite } = require('../lib/harness');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-nightly.sh');

// The date the runner works in is the LOCAL one (`date '+%Y-%m-%d'`), which is not
// always today in UTC — a fixture stamped from toISOString would be a different
// day for half the world's clocks.
const today = () => new Date().toLocaleDateString('en-CA');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nightly-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A scratch home and a scratch ~/.workkit, plus the shims the delivery runs
 * against. `claude` answers with a summary (and records that it was called),
 * `gh` answers the GraphQL calls, and Notifly is a trap: this step notifies
 * nobody, so any call to it is a failure.
 *
 * `home` is the `"home"` key to write into the settings file; null writes the
 * file without one, and `settings: null` writes no file at all.
 * `logsDir: false` leaves ~/Library/Logs out — the bare home the job has to
 * make its own log directory in.
 * `categories` is what the repo's Discussions actually offer, which is how the
 * fallback is exercised; `ghFails` makes every API call refuse.
 * `quiet` is whether the day has a record at all: a world that is not quiet
 * carries one session transcript inside the window, which is what the payload
 * reads to decide there was a day to summarize.
 * `posted` is what the repo's Daily discussions already carry — the duplicate
 * guard's input.
 * `claudeStderr` is noise the send writes to its stderr, which must reach the
 * log and never the published body.
 */
const mkWorld = ({
  home = null, settings = {}, logsDir = true, categories = ['Daily', 'Weekly', 'Monthly'],
  ghFails = false, summary = '## Went well\nThe suite is green.\n', quiet = false,
  posted = [], claudeStderr = '',
} = {}) => {
  const root = mkTmp();
  const homeDir = path.join(root, 'home');
  // ~/.local/bin, and not just any directory: the runner exports a PATH of its
  // own that begins there and includes /opt/homebrew/bin, so a shim anywhere
  // else would lose to the real `gh` on this machine — and the suite would
  // reach GitHub.
  const bin = path.join(homeDir, '.local', 'bin');
  const workflowHome = path.join(root, 'workflow-home');
  fs.mkdirSync(bin, { recursive: true });
  // ~/Library/Logs is a directory every macOS home already has, so the ordinary
  // fixture carries it too.
  if (logsDir) fs.mkdirSync(path.join(homeDir, 'Library', 'Logs'), { recursive: true });

  if (settings !== null) {
    fs.mkdirSync(workflowHome, { recursive: true });
    fs.writeFileSync(
      path.join(workflowHome, 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: home || null, publish: false, url: null }, ...settings }, null, 2),
    );
  }

  // The day's record. Claude Code lays transcripts out one directory per
  // project with `.jsonl` files inside, and the payload only counts the ones
  // that moved inside the 24-hour window — a file written now is one.
  const projects = path.join(root, 'projects');
  if (!quiet) {
    fs.mkdirSync(path.join(projects, 'a-repo'), { recursive: true });
    fs.writeFileSync(path.join(projects, 'a-repo', 'session.jsonl'), '{"type":"user"}\n');
  }

  const claudeLog = path.join(root, 'claude-argv.log');
  const claudeCwdLog = path.join(root, 'claude-cwd.log');
  const ghLog = path.join(root, 'gh-argv.log');
  const notifLog = path.join(root, 'notifly-argv.log');
  const bodyLog = path.join(root, 'posted-body.md');
  const claude = path.join(bin, 'claude');
  const notifly = path.join(bin, 'notifly');
  fs.writeFileSync(claude, [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    `printf '%s\\n' "$PWD" >> "${claudeCwdLog}"`,
    ...(claudeStderr ? [`printf '%s' ${JSON.stringify(claudeStderr)} >&2`] : []),
    `printf '%s' ${JSON.stringify(summary)}`,
    'exit 0',
    '',
  ].join('\n'));
  fs.writeFileSync(notifly, ['#!/usr/bin/env bash', recordArgv(notifLog), 'exit 0', ''].join('\n'));
  fs.chmodSync(claude, 0o755);
  fs.chmodSync(notifly, 0o755);

  // The three shapes the delivery asks for, told apart by what the query text
  // names. Anything else answers empty, so an unexpected call is visible as a
  // failure rather than as a pass. The shim is ALWAYS written: the runner puts
  // /opt/homebrew/bin on its own PATH, so a world without one here would reach
  // the real gh and the real GitHub.
  {
    const nodes = categories.map((name, i) => `{ "id": "DIC_${i}", "name": "${name}" }`).join(',');
    // What the repo already carries, in the shape the API answers with — the
    // duplicate guard reads exactly this.
    const priorNodes = posted.map((title) => JSON.stringify({
      title, createdAt: `${today()}T09:00:00Z`, body: 'already published',
    })).join(',');
    fs.writeFileSync(path.join(bin, 'gh'), [
      '#!/usr/bin/env bash',
      recordArgv(ghLog),
      ...(ghFails ? ['exit 1'] : []),
      'all="$*"',
      'case "$all" in',
      '  *createDiscussion*)',
      // The body travels as `@file`, and the file goes away with the run, so
      // what was actually published is kept here for the assertions.
      `    for a in "$@"; do case "$a" in body=@*) cat "\${a#body=@}" >> ${JSON.stringify(bodyLog)} ;; esac; done`,
      `    printf '%s' '{"data":{"createDiscussion":{"discussion":{"url":"https://github.com/owner/private-home/discussions/7"}}}}' ;;`,
      '  *discussionCategories*)',
      `    printf '%s' '{"data":{"repository":{"id":"R_kdt","hasDiscussionsEnabled":true,"discussionCategories":{"nodes":[${nodes}]}}}}' ;;`,
      '  *"discussions(first"*)',
      `    printf '%s' '{"data":{"repository":{"discussions":{"nodes":[${priorNodes}]}}}}' ;;`,
      '  *) printf \'%s\' \'{}\' ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  }

  return {
    root,
    home: homeDir,
    workflowHome,
    calls: () => readArgv(claudeLog),
    cwds: () => (fs.existsSync(claudeCwdLog)
      ? fs.readFileSync(claudeCwdLog, 'utf8').split('\n').filter(Boolean)
      : []),
    ghCalls: () => readArgv(ghLog),
    postedBody: () => (fs.existsSync(bodyLog) ? fs.readFileSync(bodyLog, 'utf8') : ''),
    notifs: () => readArgv(notifLog),
    log: () => {
      const file = path.join(homeDir, 'Library', 'Logs', 'claude-nightly.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    settings: () => JSON.parse(fs.readFileSync(path.join(workflowHome, 'settings.json'), 'utf8')),
    cache: () => JSON.parse(fs.readFileSync(path.join(workflowHome, '.cache.json'), 'utf8')),
    env: {
      ...process.env,
      HOME: homeDir,
      NOTIFLY: notifly,
      // The system tools plus the shims, and NOTHING else: `gh` is present only
      // when this world put it there.
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:${path.dirname(process.execPath)}`,
      WORKFLOW_HOME: workflowHome,
      // The transcripts root the payload indexes and the send is granted — the
      // same root, which is the whole point of the grant.
      WORKKIT_CLAUDE_PROJECTS: projects,
    },
  };
};

const runJob = (world, args = []) => spawnSync('bash', [SCRIPT, ...args], {
  encoding: 'utf8',
  timeout: 60000,
  env: world.env,
});

// The notification would be fired detached, so its absence needs a moment of
// waiting to mean anything: an assertion made immediately would pass even on a
// job that did notify.
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const run = async () => {
  if (process.platform !== 'darwin') skipSuite('the runner is a macOS launchd job (~/Library paths)');

  group('jobs/claude-nightly: shape');

  await test('bash -n — no syntax errors', () => {
    const res = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' });
    assertEq(res.status, 0, `bash -n: ${res.stderr}`);
  });

  await test('the script is executable', () => {
    assert(fs.statSync(SCRIPT).mode & 0o111, 'the plist runs it through bash, but a human runs it directly');
  });

  group('jobs/claude-nightly: no home repo is a named skip');

  await test('no home repo configured — it skips and says so', async () => {
    const world = mkWorld();
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(/summaries: no home repo configured — skipped/.test(world.log()), `the log names the reason: ${world.log()}`);
    assertEq(world.calls().length, 0, `nothing was sent: ${fmtCalls(world.calls())}`);
    await settle();
    assertEq(world.notifs().length, 0, 'and nothing interrupted anyone');
    cleanup(world.root);
  });

  group('jobs/claude-nightly: the summary is published');

  await test('a home repo IS configured — the summary is written and posted', () => {
    const world = mkWorld({ home: 'owner/private-home' });
    const res = runJob(world);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const log = world.log();
    assert(/posted the daily summary/.test(log), `the log says it published: ${log}`);
    assert(/discussions\/7/.test(log), 'and names the discussion it created');
    assertEq(world.calls().length, 1, `Claude wrote it once: ${fmtCalls(world.calls())}`);
    const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
    assertEq(created.length, 1, `one createDiscussion mutation: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('the repo id and the category ids are cached in the machine\'s disposable file', () => {
    // Ids are GitHub's and rebuildable, so they live in `.cache.json` and never
    // in the hand-edited settings.json beside it (issue #80).
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world);
    assert(!('homeCache' in world.settings()), 'the hand-edited file carries no cache');
    const cache = world.cache().homeCache['owner/private-home'];
    assertEq(cache.repositoryId, 'R_kdt', 'the repo node id is cached');
    assertEq(cache.categories.Daily, 'DIC_0', 'and every category by name');

    // A second run reads the cache instead of asking again.
    const before = world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;
    runJob(world);
    const after = world.ghCalls().filter((c) => c.join(' ').includes('discussionCategories')).length;
    assertEq(after, before, `the cached ids are not re-fetched: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('a repo with no Daily category publishes in the default one, and says so', () => {
    // Categories cannot be created over the API — no such mutation exists — so
    // a fallback is the only honest behavior, and it is never silent.
    const world = mkWorld({ home: 'owner/private-home', categories: ['General'] });
    const res = runJob(world);
    assertEq(res.status, 0, 'exit 0');
    const log = world.log();
    assert(/posted the daily summary in General/.test(log), `it names the category it used: ${log}`);
    assert(/no API that creates one/.test(log), 'and why it was not the Daily one');
    cleanup(world.root);
  });

  await test('an API that refuses is logged, and the step still exits 0', () => {
    const world = mkWorld({ home: 'owner/private-home', ghFails: true });
    const res = runJob(world);
    assertEq(res.status, 0, 'a summary that cannot be posted never fails the morning');
    const log = world.log();
    assert(/skipped/.test(log), `the log says what happened: ${log}`);
    assert(/nothing was written to disk/.test(log), 'and that no file was left behind instead');
    assert(!/posted the daily summary/.test(log), 'and never claims to have published');
    cleanup(world.root);
  });

  await test('a Claude that answers with nothing posts nothing', () => {
    const world = mkWorld({ home: 'owner/private-home', summary: '' });
    const res = runJob(world);
    assertEq(res.status, 0, 'exit 0');
    assert(/was not written/.test(world.log()), `the log says the summary never existed: ${world.log()}`);
    const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
    assertEq(created.length, 0, `and an empty summary is never posted: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('no settings file at all reads as no home repo, not as a failure', () => {
    const world = mkWorld({ settings: null });
    const res = runJob(world);
    assertEq(res.status, 0, 'a machine that has never healed anything is not broken');
    assert(/no home repo configured/.test(world.log()), `the log says which reason: ${world.log()}`);
    cleanup(world.root);
  });

  await test('the log block is timestamped, and --now stamps it manual', () => {
    const world = mkWorld();
    runJob(world);
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ──/.test(world.log()), `one timestamped block: ${world.log()}`);
    cleanup(world.root);

    const manual = mkWorld();
    runJob(manual, ['--now']);
    assert(/── \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(manual\) ──/.test(manual.log()),
      `stamped manual: ${manual.log().slice(0, 120)}`);
    assertEq(manual.calls().length, 0, 'and the manual trigger sends nothing either');
    cleanup(manual.root);
  });

  group('jobs/claude-nightly: the send');

  await test('the send carries the read tools and the transcripts root it indexed', () => {
    // The reflection reads the transcripts itself. Without the grant it is
    // reasoning about an index of file names it cannot open.
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world);
    const argv = world.calls()[0];
    assert(argv, `the send happened: ${fmtCalls(world.calls())}`);
    const tools = argv.indexOf('--tools');
    assert(tools !== -1 && argv[tools + 1] === 'Read,Grep,Glob', `the three read tools: ${JSON.stringify(argv)}`);
    const dir = argv.indexOf('--add-dir');
    assertEq(argv[dir + 1], path.join(world.root, 'projects'),
      'and the SAME root the payload indexed — the grant and the index cannot disagree');
    cleanup(world.root);
  });

  await test('the send runs from an empty scratch directory, never from /', () => {
    // Under launchd the cwd is / and the job is its own TCC identity: a startup
    // scan from there trips the macOS privacy prompts.
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world);
    const cwd = world.cwds()[0];
    assert(cwd && cwd !== '/' && cwd !== world.home, `it worked from a scratch dir, got: ${cwd}`);
    assertEq(fs.existsSync(cwd), false, 'which went away with the run');
    cleanup(world.root);
  });

  await test('what the send wrote to stderr reaches the log, never the published body', () => {
    const world = mkWorld({ home: 'owner/private-home', claudeStderr: 'warning: a deprecated flag\n' });
    runJob(world);
    const body = world.postedBody();
    assert(/The suite is green/.test(body), `the summary is what was published: ${body}`);
    assert(!/deprecated flag/.test(body), `and the noise is not part of it: ${body}`);
    assert(/deprecated flag/.test(world.log()), `it is in the log instead: ${world.log()}`);
    cleanup(world.root);
  });

  group('jobs/claude-nightly: the guards');

  await test('a day already published is not published twice', () => {
    const world = mkWorld({ home: 'owner/private-home', posted: [`daily: ${today()}`] });
    const res = runJob(world);
    assertEq(res.status, 0, 'exit 0');
    assert(/already carries the daily summary/.test(world.log()), `it says so: ${world.log()}`);
    assertEq(world.calls().length, 0, 'nothing was composed');
    const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
    assertEq(created.length, 0, `and nothing was posted: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('--now posts anyway — a manual run is an explicit ask', () => {
    const world = mkWorld({ home: 'owner/private-home', posted: [`daily: ${today()}`] });
    runJob(world, ['--now']);
    assert(/posted the daily summary/.test(world.log()), `it published: ${world.log()}`);
    cleanup(world.root);
  });

  await test('a quiet day is logged and nothing is sent or posted', () => {
    // No transcripts and no commits in the window: a summary composed from that
    // would be invention, and publishing it would put invention in the archive
    // the rollups read.
    const world = mkWorld({ home: 'owner/private-home', quiet: true });
    const res = runJob(world);
    assertEq(res.status, 0, 'exit 0');
    assert(/a quiet day/.test(world.log()), `it names the reason: ${world.log()}`);
    assertEq(world.calls().length, 0, `nothing was sent: ${fmtCalls(world.calls())}`);
    const created = world.ghCalls().filter((c) => c.join(' ').includes('createDiscussion'));
    assertEq(created.length, 0, `and nothing was posted: ${fmtCalls(world.ghCalls())}`);
    cleanup(world.root);
  });

  await test('--now sends on a quiet day too', () => {
    const world = mkWorld({ home: 'owner/private-home', quiet: true });
    runJob(world, ['--now']);
    assertEq(world.calls().length, 1, `the manual trigger overrides: ${fmtCalls(world.calls())}`);
    assert(/posted the daily summary/.test(world.log()), `and it published: ${world.log()}`);
    cleanup(world.root);
  });

  group('jobs/claude-nightly: nothing is written');

  await test('the run writes no file anywhere but its own log', () => {
    const world = mkWorld({ home: 'owner/private-home' });
    runJob(world);
    // The whole fixture home, minus the one log the step is allowed to append.
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else found.push(full);
      }
    };
    walk(world.home);
    const log = path.join(world.home, 'Library', 'Logs', 'claude-nightly.log');
    // The shims the fixture itself put in ~/.local/bin are not the run's doing.
    const written = found.filter((f) => !f.startsWith(path.join(world.home, '.local', 'bin')));
    assertEq(written.join(','), log, `the log and nothing else, got: ${written.join(', ')}`);
    cleanup(world.root);
  });

  await test('the retired local summaries path is gone from the script', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8');
    // The machinery that used to write the summary into a folder, by name. The
    // send itself is back — it is the destination that changed, from a file to
    // a Discussion.
    for (const gone of ['WORKKIT_HQ', 'summaries/daily', 'DAILY_FILE']) {
      assert(!text.includes(gone), `${gone} is not in the script — generated records are never files`);
    }
  });

  await test('a home with no Library/Logs gets one — the log line still lands', () => {
    const world = mkWorld({ logsDir: false });
    const res = runJob(world);
    assertEq(res.status, 0, `the append cannot fail the step: ${res.stderr}`);
    assert(/no home repo configured/.test(world.log()), `the log says which reason: ${world.log()}`);
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
