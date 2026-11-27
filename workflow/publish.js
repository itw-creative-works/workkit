#!/usr/bin/env node
/**
 * workflow/publish.js: build the tower project in the home clone and publish
 * it to gh-pages, started by publish.sh under a node at the kit's floor. Every
 * reason not to publish is a named skip with exit 0; the mechanism is
 * workflow/README.md § Publishing the dashboard.
 * Usage: node publish.js [--quiet]
 * Called by: `workkit publish`, `workkit update` (a human's run), and
 *            jobs/morning/site.js after the brief has been sent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastLines } = require('./lib/attach');
const { gitIn, commitIdentity } = require('./lib/git');
const { holdSignals, Interrupted } = require('./lib/interrupt');
const { isDir, isFile } = require('./lib/lock');
const { nativePath } = require('./lib/platform');
const { executable } = require('./lib/participation');
const { onPath } = require('./lib/run');
const { writeErr } = require('./lib/say');
const { settingsAt } = require('./lib/settings');
const { spin } = require('./lib/spin');
const { withScratch } = require('./lib/scratch');
const { readJsonText } = require('./lib/write');
const { today } = require('./lib/day');
const {
  ok, skip, info, warn, setQuiet,
} = require('./lib/voice');
const { userDir, towerDir } = require('./user-dir');
const {
  PAGES_BRANCH, settingsFile, slug, siteHost, homeBranch, homeState, homeReady,
} = require('./home/options');
const { catchUp, commitPush, heal } = require('./home/install');
const { manifestsOf, sync } = require('./home/seed');
const { chomp } = require('../hooks/mods/text.js');

const BUILD = path.join(__dirname, 'publish', 'build.js');

// How many of a failed step's last lines follow its warning.
const TAIL_LINES = 20;

/**
 * The run every step is handed; a step reads what the steps before it left.
 * @param {string[]} args
 * @returns {object}
 */
const newRun = (args) => {
  const home = towerDir();
  return {
    quiet: args[0] === '--quiet',
    home,
    target: path.join(home, 'targets', 'web'),
    settings: settingsFile(),
    publishSite: false,
    syncChanged: false,
    manifests: false,
    sourceRc: 0,
    worktree: null,
    branchExisted: false,
    hold: null,
  };
};

/**
 * git in <dir>, stdin and stdout the terminal's, stderr dropped unless asked.
 * @param {string} dir
 * @param {string[]} args
 * @param {{out?: string, err?: string}} [stdio] spawn's stdout and stderr
 * @returns {number|null} git's code
 */
const git = (dir, args, { out = 'inherit', err = 'ignore' } = {}) => gitIn(dir, args, { stdio: ['inherit', out, err] }).status;

/** git in <dir> with nothing shown, the shell's `>/dev/null 2>&1`. */
const gitHushed = (dir, args) => git(dir, args, { out: 'ignore' });

/**
 * A slow program, run under the run's signal hold, so an end signal reaches
 * it and stops the run, with spin's frames. Its shell wait sent the call's
 * stderr away (a log, a capture or nowhere), so spin prints no one line:
 * every wait of the publish is such a call.
 * @param {object} run
 * @param {string} message the wait's words
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} options spawn's
 * @returns {Promise<object>} spawnSync's shape of answer
 */
const waitFor = (run, message, cmd, args, options) => spin(message, () => run.hold.run(cmd, args, { windowsHide: true, ...options }), { line: false });

/**
 * git in <dir> under waitFor, stdin and stdout the terminal's unless asked,
 * stderr dropped.
 * @param {object} run
 * @param {string} message the wait's words
 * @param {string} dir
 * @param {string[]} args
 * @param {{out?: string}} [stdio] spawn's stdout
 * @returns {Promise<number|null>} git's code
 */
const gitWait = async (run, message, dir, args, { out = 'inherit' } = {}) => (await waitFor(run, message, 'git', ['-C', dir, ...args], { stdio: ['inherit', out, 'ignore'] })).status;

/**
 * A build.js verb run as its own program, its stdout and stderr into one log,
 * so its own lines land where npm's do. The log's last lines come back.
 * @param {object} run
 * @param {string} message the wait's words
 * @param {string[]} args build.js's arguments
 * @returns {Promise<{code: number, tail: Buffer}>}
 */
const logged = async (run, message, args) => {
  const answer = await withScratch(async (scratch) => {
    const log = path.join(scratch, 'log');
    const fd = fs.openSync(log, 'w');
    let res;
    try {
      res = await waitFor(run, message, process.execPath, [BUILD, ...args], { stdio: ['inherit', fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    return { code: res.status === 0 ? 0 : 1, tail: lastLines(fs.readFileSync(log), TAIL_LINES) };
  }, 'publish.');
  if (answer === null) throw new Error(`publish: no scratch folder could be made in ${os.tmpdir()}`);
  return answer;
};

/**
 * `present`, `absent` or `unreachable`: `--exit-code` answers 2 for no such
 * branch and 128 for no reply, and an unreachable remote must never read as
 * absent, or an offline run drops its ref and tears down a site it cannot see.
 * @param {object} run
 * @returns {Promise<'present'|'absent'|'unreachable'>}
 */
const pagesRemoteState = async (run) => {
  const code = await gitWait(run, `asking origin about ${PAGES_BRANCH}`, run.home, ['ls-remote', '--exit-code', '--heads', 'origin', PAGES_BRANCH], { out: 'ignore' });
  if (code === 0) return 'present';
  return code === 2 ? 'absent' : 'unreachable';
};

/**
 * Called only when the switch is off and the remote still carries the branch.
 * The branch goes first, since it is what Pages serves; the local copy goes
 * too, or the next orphan checkout refuses.
 * @param {object} run
 */
const siteTeardown = async (run) => {
  const repo = slug();
  const native = nativePath(run.home);
  if (await gitWait(run, `deleting ${PAGES_BRANCH} on origin`, run.home, ['push', '-q', 'origin', '--delete', PAGES_BRANCH]) !== 0) {
    warn(`publish: could not delete ${PAGES_BRANCH} on ${repo}; the site it serves is still up; \`git -C ${native} push origin --delete ${PAGES_BRANCH}\` reports why`);
    return;
  }
  ok(`publish: the site is taken down; ${repo}'s ${PAGES_BRANCH} branch is deleted`);
  gitHushed(run.home, ['branch', '-qD', PAGES_BRANCH]);

  if (!onPath('gh')) {
    skip(`publish: gh is not on this machine; Pages is still configured on ${repo} with nothing to serve; turn it off at https://github.com/${repo}/settings/pages`);
    return;
  }
  const res = await waitFor(run, `taking the Pages site on ${repo} down`, 'gh', ['api', '-X', 'DELETE', `repos/${repo}/pages`], { stdio: ['inherit', 'pipe', 'pipe'] });
  if (res.status === 0) {
    ok(`publish: Pages is disabled on ${repo}`);
  } else if (`${res.stdout ?? ''}${res.stderr ?? ''}`.includes('404')) {
    skip(`publish: Pages was not configured on ${repo}; there was nothing to disable`);
  } else {
    warn(`publish: could not disable Pages on ${repo}; the branch is gone, so it serves nothing, but the configuration is still there; turn it off at https://github.com/${repo}/settings/pages`);
  }
};

// ── The three things a publish needs ──────────────────────────────────────────

/**
 * An unparseable settings file is refused, never read as defaults (every
 * switch off, no CNAME), asked first, since the same file names the home
 * repo; then the switch is read, and the clone asked after.
 * @param {object} run
 * @returns {Promise<number|undefined>} the code to stop with, or nothing to go on
 */
const publishPreflight = async (run) => {
  // jq's read: a blank file holds no value and passes; only a failed read or parse refuses.
  if (isFile(run.settings) && readJsonText(run.settings) === undefined) {
    warn(`publish: ${nativePath(run.settings)} does not parse as JSON; the site options (\`site.publish\`, \`site.url\`) cannot be read, so nothing was published; fix the file and run it again`);
    return 0;
  }

  // Default off: only `true` publishes. Read here and acted on below the
  // roster, which is not part of the site.
  const value = settingsAt(null, run.settings).site?.publish;
  run.publishSite = value === true || value === 'true';

  if (await homeReady()) return undefined;
  const native = nativePath(run.home);
  const state = await homeState();
  if (state === 'unset') skip('publish: no home repo; `workkit setup` creates one, and the site publishes from it');
  else if (state === 'absent') skip(`publish: nothing is cloned at ${native} yet; \`workkit setup\` clones and seeds the tower project`);
  else if (state === 'other') warn(`publish: ${native} is not the home repo's clone; nothing is published out of somebody else's folder`);
  return 0;
};

// ── Catch up with the remote ──────────────────────────────────────────────────

/**
 * A pull that cannot finish (a divergence, offline, an auth refusal)
 * publishes nothing; `--autostash` keeps a hand-taken upstream edit from
 * reading as one.
 */
const publishCatchUp = async () => {
  if (await catchUp('publish')) return undefined;
  skip('publish: nothing was published and nothing was committed');
  return 0;
};

// ── The home repo's own heal ──────────────────────────────────────────────────

/** Above the site switch: the home repo is owed its labels and forms whether or not a site is published. */
const publishHomeHeal = async (run) => {
  await heal(run.quiet);
};

// ── The sync ──────────────────────────────────────────────────────────────────

/**
 * Above the source push, so the refreshed project rides the roster's commit.
 * A part-refreshed clone (3, a write failed mid-walk) stops, since half a
 * refresh is the broken site the mint's abort prevents; nothing to sync from
 * (1) and already current (2) leave the clone whole, so they go on.
 */
const publishSync = async (run) => {
  const { code, manifests } = await sync();
  run.syncChanged = code === 0;
  run.manifests = manifests;
  if (code !== 3) return undefined;
  warn(`publish: the tower project in ${nativePath(run.home)} is part-refreshed; nothing was committed, built or published; fix the write failure above and publish again`);
  return 1;
};

// ── The roster ────────────────────────────────────────────────────────────────

/**
 * Above the site switch and every build check, since the cloud brief reads it
 * too. A failed compose warns and leaves the exit code alone: a stale-but-good
 * roster is the designed outcome, unlike a failed source push.
 */
const publishRoster = (run) => {
  try {
    // Loaded here, so a kit whose tower reads are broken still publishes.
    const { writeSlugs } = require('./publish/site-repos');
    writeSlugs(path.join(run.home, 'data', 'repos.json'), { workflowHome: userDir() });
  } catch {
    warn('publish: the repo list could not be composed; the published dashboard and the cloud brief both read it, so both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep');
    return undefined;
  }
  info(`publish: the repo list is on ${slug()}'s default branch at data/repos.json`);
  return undefined;
};

// ── The source side ───────────────────────────────────────────────────────────

/**
 * A push that did not land is remembered in sourceRc rather than acted on, so
 * it never costs the site a publish it can still make; commitPush has already
 * said which half failed.
 */
const publishSourceSide = async (run) => {
  const subject = run.syncChanged ? 'chore(home): sync the tower project' : 'chore(home): refresh the repo list';
  const untracked = gitIn(run.home, ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout;
  const clean = git(run.home, ['diff', '--quiet']) === 0 && git(run.home, ['diff', '--cached', '--quiet']) === 0
    && chomp(untracked) === '';
  if (!clean && !(await commitPush(subject))) run.sourceRc = 1;
  return undefined;
};

// ── The switch ────────────────────────────────────────────────────────────────

/**
 * Off means there is no site: a branch still on the remote is taken down, and
 * an unreachable remote is never torn down on a guess.
 */
const publishSwitch = async (run) => {
  const native = nativePath(run.home);
  if (!run.publishSite) {
    skip(`publish: \`site.publish\` is off in ${nativePath(run.settings)}; nothing is built or pushed; set it to true to publish the site (what Pages serves is public, even from a private repo)`);
    const state = await pagesRemoteState(run);
    if (state === 'present') await siteTeardown(run);
    else if (state === 'unreachable') warn('publish: the home remote could not be reached, so whether it still serves a site is unknown; nothing was taken down; run it again when the network is back');
    return run.sourceRc;
  }
  if (!onPath('npm')) {
    skip('publish: npm is not on this machine; the dashboard cannot be built here');
    return run.sourceRc;
  }
  if (!executable(path.join(run.home, 'node_modules', '.bin', 'omega'))) {
    skip(`publish: there is no omega binary at ${native}/node_modules/.bin/omega, so nothing is built here; run \`(cd -P ${native} && npm install)\` and read its output`);
    return run.sourceRc;
  }
  return undefined;
};

// ── The clone's dependencies ──────────────────────────────────────────────────

/** Whether `file` is newer than `than`, or `than` is missing: the shell's `-nt`. */
const newer = (file, than) => {
  if (!isFile(than)) return true;
  return fs.statSync(file, { bigint: true }).mtimeNs > fs.statSync(than, { bigint: true }).mtimeNs;
};

/**
 * Runs when the sync wrote a manifest, or when a manifest is newer than npm's
 * own stamp (a run that ended before this step); a manifest the sync changed
 * carries the time it wrote it, so it is newer. A failed install aborts the build.
 */
const publishDependencies = async (run) => {
  const stamp = path.join(run.home, 'node_modules', '.package-lock.json');
  if (!run.manifests && !manifestsOf(run.home).some((manifest) => newer(manifest, stamp))) return undefined;
  const native = nativePath(run.home);
  info(`publish: installing the tower project's dependencies in ${native}`);
  const { code, tail } = await logged(run, "installing the tower project's dependencies", ['install', run.home]);
  if (code === 0) return undefined;
  warn(`publish: the tower project's dependencies could not be installed in ${native}; nothing was built or published, because a build over a half-installed tree is a broken site; \`npm install\` inside ${native} reports it in full, and the last lines follow`);
  writeErr(tail);
  return 1;
};

// ── The mint ──────────────────────────────────────────────────────────────────

/**
 * A mint that leaves no logo fails like any other. The failed-mint marker
 * under the gitignored `.omega` keeps a failure sticky past tomorrow's
 * "already current".
 */
const publishMint = async (run) => {
  const mark = path.join(run.home, '.omega', '.mint-failed');
  if (!run.syncChanged && isDir(path.join(run.home, '.omega', 'assets', 'logo')) && !isFile(mark)) return undefined;
  const native = nativePath(run.home);
  info(`publish: minting the brand assets in ${native}`);
  const { code, tail } = await logged(run, 'minting the brand assets', ['mint', run.home]);
  if (code === 0) {
    fs.rmSync(mark, { force: true });
    return undefined;
  }
  fs.mkdirSync(path.dirname(mark), { recursive: true });
  fs.writeFileSync(mark, '');
  warn(`publish: the brand assets could not be minted in ${native}; nothing was built or published, because the sidebar and the social tags reference the minted paths unconditionally and a stale site beats one with a broken logo; the failure is remembered and every publish aborts here until a mint succeeds; the last lines follow`);
  writeErr(tail);
  return 1;
};

// ── Build ─────────────────────────────────────────────────────────────────────

/**
 * A project site serves a path deep, so the build is told its prefix: `/`
 * when `site.url` is set, `/<name>/` otherwise. No GitHub call, so an offline
 * publish still builds the right URLs.
 */
const publishBuild = async (run) => {
  const prefix = siteHost() ? '/' : `/${slug().split('/').pop()}/`;
  info(`publish: building the dashboard from ${nativePath(run.target)}`);
  info(`publish: the site serves at ${prefix}; the build is told so`);
  const { code, tail } = await logged(run, 'building the dashboard', ['build', run.home, prefix]);
  if (code === 0) return undefined;
  warn('publish: the dashboard build failed; the last lines follow');
  writeErr(tail);
  return 1;
};

// ── The published branch ──────────────────────────────────────────────────────

/**
 * A worktree, so main's tree is never checked out over. The branch is created
 * here on the first publish; the repo, Pages and Discussions are setup's alone.
 * An orphan keeps main's history out of a generated branch; a stale local
 * branch would make the orphan checkout refuse, so it is dropped first.
 */
const publishBranch = async (run) => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'publish.'));
  fs.rmSync(worktree, { recursive: true, force: true });
  const state = await pagesRemoteState(run);
  if (state === 'unreachable') {
    warn(`publish: the home remote could not be reached to see whether it already carries ${PAGES_BRANCH}; nothing was published and no local branch was touched; run it again when the network is back`);
    return run.sourceRc;
  }
  run.branchExisted = state === 'present';
  run.worktree = worktree;
  const native = nativePath(run.home);

  if (run.branchExisted) {
    await gitWait(run, `fetching ${PAGES_BRANCH}`, run.home, ['fetch', '-q', 'origin', PAGES_BRANCH]);
    if (git(run.home, ['worktree', 'add', '-q', '-B', PAGES_BRANCH, worktree, `origin/${PAGES_BRANCH}`]) !== 0) {
      warn(`publish: could not check ${PAGES_BRANCH} out beside ${native}`);
      return 1;
    }
    return undefined;
  }
  git(run.home, ['branch', '-qD', PAGES_BRANCH]);
  if (git(run.home, ['worktree', 'add', '-q', '--detach', worktree]) !== 0) {
    warn(`publish: could not make a worktree beside ${native}`);
    return 1;
  }
  if (git(worktree, ['checkout', '-q', '--orphan', PAGES_BRANCH]) !== 0) {
    warn(`publish: could not start the ${PAGES_BRANCH} branch`);
    return 1;
  }
  gitHushed(worktree, ['rm', '-rq', '--cached', '.']);
  return undefined;
};

/**
 * The worktree goes, however the run ends, once its path exists, and git
 * forgets it: a registration left behind refuses every later checkout. Its
 * own three calls, not `worktreeRemove` of lib/tree-copy.js: that file loads
 * the hook layer, which a publish has no other use for.
 */
const cleanupWorktree = (run) => {
  if (!run.worktree) return;
  gitHushed(run.home, ['worktree', 'remove', '--force', run.worktree]);
  fs.rmSync(run.worktree, { recursive: true, force: true });
  gitHushed(run.home, ['worktree', 'prune']);
};

// ── The mirror ────────────────────────────────────────────────────────────────

/**
 * The branch mirrors the build exactly, so a retired page stops being served.
 * Engine additions are written after the mirror; `.git` is the worktree's
 * link. Pages runs Jekyll over a branch unless told not to, and a build with
 * `_`-prefixed asset folders loses them to it.
 */
const publishMirror = (run) => {
  for (const name of fs.readdirSync(run.worktree)) {
    try {
      if (name !== '.git') fs.rmSync(path.join(run.worktree, name), { recursive: true, force: true });
    } catch {
      // What cannot go is overwritten by the copy, or named by its failure.
    }
  }
  try {
    fs.cpSync(path.join(run.target, 'dist'), run.worktree, { recursive: true, verbatimSymlinks: true });
  } catch {
    warn(`publish: could not copy the build into the ${PAGES_BRANCH} worktree`);
    return 1;
  }
  fs.writeFileSync(path.join(run.worktree, '.nojekyll'), '');
  return undefined;
};

// ── The home pointer ──────────────────────────────────────────────────────────

/**
 * The one public artifact: the home repo and the branch its private roster is
 * on. The branch is carried because a reader assuming `main` 404s on a home
 * repo whose default is not.
 */
const publishHomePointer = (run) => {
  fs.mkdirSync(path.join(run.worktree, 'data'), { recursive: true });
  fs.writeFileSync(path.join(run.worktree, 'data', 'home.json'), `{"home":"${slug()}","branch":"${homeBranch()}"}\n`);
  info('publish: the home pointer is at data/home.json');
  return undefined;
};

// ── The custom URL ────────────────────────────────────────────────────────────

/**
 * `site.url` set becomes the CNAME; cleared, the CNAME goes and Pages falls
 * back to github.io. siteHost has already taken the scheme and slash off.
 */
const publishCustomUrl = (run) => {
  const host = siteHost();
  if (!host) return undefined;
  fs.writeFileSync(path.join(run.worktree, 'CNAME'), `${host}\n`);
  info(`publish: CNAME → ${host}`);
  return undefined;
};

// ── Push the branch ───────────────────────────────────────────────────────────

/**
 * Force with lease onto this one generated branch: a rewrite is what a
 * rebuild is, and the lease still refuses a push this machine has not seen.
 */
const publishPush = async (run) => {
  const native = nativePath(run.home);
  gitHushed(run.worktree, ['add', '-A']);
  if (git(run.worktree, ['diff', '--cached', '--quiet']) === 0) {
    skip('publish: the published site is already current');
    return undefined;
  }
  const committed = gitHushed(run.worktree, [...commitIdentity(), 'commit', '-q', '-m', `chore(site): publish ${today()}`]);
  if (committed !== 0) {
    warn(`publish: the ${PAGES_BRANCH} commit did not finish`);
    return 1;
  }
  const push = run.branchExisted
    ? ['push', '-q', '--force-with-lease', 'origin', PAGES_BRANCH]
    : ['push', '-q', '-u', 'origin', PAGES_BRANCH];
  if (await gitWait(run, `publishing ${PAGES_BRANCH}`, run.worktree, push) !== 0) {
    warn(run.branchExisted
      ? `publish: could not push ${PAGES_BRANCH}; someone else published since this run started; \`git -C ${native} fetch\` and run it again`
      : `publish: could not push ${PAGES_BRANCH} to origin; \`git -C ${native} push origin ${PAGES_BRANCH}\` reports why`);
    return 1;
  }
  ok(`publish: the dashboard is published from ${slug()} on ${PAGES_BRANCH}`);
  return undefined;
};

// ── The steps ─────────────────────────────────────────────────────────────────

// Every reason not to publish is a code a step hands back, so a step that
// hands back nothing went through.
const STEPS = [
  publishPreflight, publishCatchUp, publishHomeHeal, publishSync, publishRoster, publishSourceSide, publishSwitch,
  publishDependencies, publishMint, publishBuild, publishBranch, publishMirror, publishHomePointer, publishCustomUrl, publishPush,
];

/**
 * The publish, every step in its one order.
 * @param {string[]} args
 * @returns {Promise<number>} 0, or 1 for a failed source push, install, mint or build
 */
const main = async (args) => {
  const run = newRun(args);
  // The voice reads both at every line, home's steps included: no indent,
  // and quiet when asked, for this process alone.
  process.env.WK_LOG_INDENT = '';
  setQuiet(run.quiet);
  // An end signal stops the run: inside a wait it reaches the program and the
  // step stops there, else the run stops after the step in hand. The worktree
  // still goes, and then the signal ends the process.
  const hold = holdSignals();
  run.hold = hold;
  try {
    for (const step of STEPS) {
      const code = await step(run);
      if (code !== undefined) return code;
      if (await hold.interrupted()) return 1;
    }
    return run.sourceRc;
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
    return 1;
  } finally {
    cleanupWorktree(run);
    await hold.end();
  }
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered
  // for a pipe. A code the hold's end set for a signal (Windows) stays.
  main(process.argv.slice(2)).then((code) => { process.exitCode ??= code; });
}
