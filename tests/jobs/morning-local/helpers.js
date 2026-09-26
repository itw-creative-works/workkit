//
// The shared prologue of the jobs/morning.sh local suites, the `*.test.js`
// files beside this one, which test the script as THIS MACHINE runs it, the
// 9am launchd job, one step each. The same script on a runner is
// the ../morning-cloud/ folder; the two are the two environments, not two
// scripts. A plain module, never a suite: the runner only loads files ending
// in `.test.js`.
//
// The runner is executed for real, with a fake `claude` on PATH recording the
// argument vector it was given and a fake Notifly recording the notification.
// HOME is a scratch directory, so the log it appends to and the empty cwd it
// runs from are both inside the fixture: this suite never writes to the real
// home and never puts a notification on screen. The summaries step it calls gets
// the same treatment: a scratch WORKFLOW_HOME with no home repo named in it, so
// it has nowhere to publish, sends nothing, and the assertions below see only
// the brief (the step's own suite covers the publishing).
//
// EVERY world carries a recording `gh` shim, and it lives in ~/.local/bin rather
// than beside the others: the runner exports a PATH of its own beginning there
// and including /opt/homebrew/bin, so a shim anywhere else would lose to the
// real `gh` and this suite would reach GitHub. A world with nowhere to publish
// gets one too: a skip is proved by a recorder that stayed silent, never by the
// tool being absent, which no assertion could tell from a skip that never ran.
//
// GITHUB_ACTIONS is stripped from every world: a suite run inside Actions would
// otherwise take the cloud branch of the very script it is testing here.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const { skipSuite } = require('../../lib/harness');
const { recordArgv, readArgv } = require('../../lib/argv-log');
const { BASH, NO_RC, shellPath, homeEnv, stubTool, pathWith } = require('../../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'jobs', 'morning.sh');
// The steps it sources, one file each: where a step's own text is read.
const STEPS = path.join(path.dirname(SCRIPT), 'morning');
const { INSTRUCTION } = require(path.join(__dirname, '..', '..', '..', 'jobs', 'brief-payload.js'));
// The title every published brief carries, from the module that owns the
// literal, so this fixture and the step under test read one prefix.
const { BRIEF_TITLE_PREFIX } = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'history.js'));

// A `gh` call that is the brief's business with the board: listing today's
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
 * `logsDir: false` leaves ~/Library/Logs out: the bare home the job has to
 * make its own log directory in.
 * `transcripts: false` leaves ~/.claude/projects out: the machine whose day the
 * summaries step cannot read, and that gate's red side.
 * `home` is the home repo slug to name in the settings file; null is a machine
 * with nowhere to publish, and it gets the same recording `gh` shim so the skip
 * is something an assertion can see.
 * `badSettings` writes a settings file that does not parse: the shape the site
 * publish warns about rather than reading as a default.
 * `posted` is what that repo's discussions already carry, as `{ title, body }`.
 * `ghFails` makes every API call refuse.
 * `ccChangelog` is the upstream CHANGELOG the news read is pointed at.
 * `dispatch` is whether `gh workflow run` lands: false by default, which is the
 * machine that cannot reach the cloud, and since issue #107 that is a briefless
 * morning rather than a local brief.
 * `secrets` is the names `gh secret list` reports: both by default, the repo
 * whose runner can actually compose the brief and sweep the board.
 * `homeClone` gives the world a home clone at `<WORKFLOW_HOME>/tower`: the
 * folder the reconcile step writes the cloud brief's runner into (issue #143).
 * Its remote is a local bare repo (WORKKIT_HOME_REMOTE, the engine's own seam),
 * so every clone, commit and push here runs offline and the real
 * `~/.workkit/tower` is never touched.
 */
const mkWorld = ({
  response = 'HEADLINE: one thing today.\nIN FLIGHT: nothing.\n', status = 0, logsDir = true,
  home: homeRepo = null, posted = [], ghFails = false, ccChangelog = null, badSettings = false,
  dispatch = false, secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'WORKKIT_GITHUB_TOKEN'],
  secretsUnlistable = false,
  transcripts = true, homeClone = false,
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
  // The home clone the reconcile step refreshes (issue #143), and the tiny
  // stand-in for `tower/app` the site publish syncs into it: the real project
  // would only make this fixture slower, and neither step is the other's test.
  const tower = path.join(workflowHome, 'tower');
  let homeRemote = null;
  if (homeClone) {
    homeRemote = path.join(root, 'remote.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', homeRemote], { encoding: 'utf8' });
    spawnSync('git', ['clone', '-q', homeRemote, tower], { encoding: 'utf8' });
    fs.mkdirSync(path.join(root, 'tower-app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tower-app', 'package.json'), '{\n  "name": "tower-fixture"\n}\n');
  }

  // ~/Library/Logs is a directory every macOS home already has; the fixture home
  // is bare, so it is created here rather than by the job.
  if (logsDir) fs.mkdirSync(path.join(home, 'Library', 'Logs'), { recursive: true });
  // The session transcripts the summaries step is gated on. Empty is enough:
  // the step's own guards call that a quiet day.
  if (transcripts) fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });

  const claudeLog = path.join(root, 'claude-argv.log');
  const notifLog = path.join(root, 'notifly-argv.log');
  const claude = stubTool(bin, 'claude', [
    '#!/usr/bin/env bash',
    recordArgv(claudeLog),
    // %b, not %s: the escapes JSON.stringify wrote have to become real newlines,
    // or the whole response is one line and "first line" proves nothing.
    `printf '%b' ${JSON.stringify(response)}`,
    `exit ${status}`,
  ]);
  const notifly = stubTool(bin, 'notifly', ['#!/usr/bin/env bash', recordArgv(notifLog), 'exit 0']);

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
  stubTool(localBin, 'gh', [
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
  ]);

  // The upstream CHANGELOG the news read is pointed at. `/dev/null` is the
  // module's silent-skip path: an empty body, no version, no line.
  let ccSource = 'file:///dev/null';
  if (ccChangelog) {
    const file = path.join(root, 'cc-changelog.md');
    fs.writeFileSync(file, ccChangelog);
    ccSource = pathToFileURL(file).href;
  }

  const env = homeEnv(home, {
    ...process.env,
    NOTIFLY: notifly,
    PATH: pathWith(bin),
    // The summaries step's one seam: where it looks for the home repo.
    WORKFLOW_HOME: workflowHome,
    WORKKIT_CC_CHANGELOG: ccSource,
    ...(homeClone ? {
      WORKKIT_HOME_REMOTE: homeRemote,
      WORKKIT_TOWER_APP: path.join(root, 'tower-app'),
    } : {}),
  });
  // This suite IS the machine's environment, and the script asks Actions' own
  // variable which one it woke up in.
  delete env.GITHUB_ACTIONS;

  return {
    root,
    home,
    workflowHome,
    tower,
    homeRemote,
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
    // The stale-brief marker (issue #173), read back the way the session hook
    // reads it: null when the step wrote none.
    markerFile: path.join(workflowHome, 'brief-status.json'),
    marker: () => {
      const file = path.join(workflowHome, 'brief-status.json');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    },
    log: () => {
      const file = path.join(home, 'Library', 'Logs', 'claude-daily.log');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    },
    env,
  };
};

const runJob = (world, args = []) => spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args], {
  encoding: 'utf8',
  timeout: 60000,
  env: world.env,
});

// The seeded copy as a checkout that has moved on leaves it: committed and
// pushed, the way the last `workkit setup` left it, and a version behind.
const STALE_RUNNER = '# last month’s runner\n';
const plantStaleRunner = (world) => {
  const file = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, STALE_RUNNER);
  const git = (...args) => spawnSync('git', ['-C', world.tower, ...args], { encoding: 'utf8' });
  git('add', '-A');
  git('-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore(home): seed the cloud brief runner');
  git('push', '-q', '-u', 'origin', 'main');
  return file;
};

// A commit made on the home remote by SOMEBODY ELSE - the other machine's
// publish, or an edit taken on GitHub. It is what leaves this clone behind, and
// a clone that has not caught up cannot push anything it seeds (issue #200).
const pushFromElsewhere = (world, file, content) => {
  const other = path.join(world.root, 'other-clone');
  spawnSync('git', ['clone', '-q', world.homeRemote, other], { encoding: 'utf8' });
  fs.writeFileSync(path.join(other, file), content);
  const git = (...args) => spawnSync('git', ['-C', other, ...args], { encoding: 'utf8' });
  git('add', '-A');
  git('-c', 'user.name=other', '-c', 'user.email=other@localhost', 'commit', '-q', '-m', `chore: ${file}`);
  git('push', '-q', 'origin', 'main');
};

const subjects = (dir) => spawnSync('git', ['-C', dir, 'log', '--pretty=%s'], { encoding: 'utf8' })
  .stdout.split('\n').filter(Boolean);

const REFRESH = 'chore(home): refresh the cloud brief runner';

// The notification is fired detached on purpose: Notifly does not return until
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

// The first notification whose message matches: the summaries step fires its
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

// Every suite asks this first: the machine leg is a macOS job.
const skipUnlessDarwin = () => {
  if (process.platform !== 'darwin') skipSuite('the machine leg is a macOS launchd job (Notifly, ~/Library paths)');
};

module.exports = {
  SCRIPT, STEPS, INSTRUCTION, BRIEF_TITLE_PREFIX, cleanup, mkWorld, runJob, STALE_RUNNER, plantStaleRunner,
  pushFromElsewhere, subjects, REFRESH, notified, notifiedMatching, settle, skipUnlessDarwin,
};
