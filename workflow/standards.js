#!/usr/bin/env node
/**
 * workflow/standards.js: bring a repo to the issue-workflow standard,
 * idempotently, started by node; a Node below the kit's floor gets one line and
 * stops. The steps live in standards/, each handed one run object; what each
 * does: workflow/README.md, the heal (`standards.js`), § Every heal runs and
 * § The hook layer self-check. Every mode: README § Participation: the tri-state.
 * Usage: node standards.js [--state|--announce|--enable|--decline|--engine-link|--command-link|--in-cache|--home|--git-hooks] [repo_dir]
 */

// The floor first, ahead of every other require, in syntax an older Node reads.
if (require.main === module) {
  const floor = require('./lib/floor');
  const below = floor.floorLine(process.version, floor.floorOf());
  if (below) {
    require('fs').writeSync(2, `${below}\n`);
    process.exit(1);
  }
}

const fs = require('fs');
const path = require('path');
const { userDir } = require('./user-dir');
const { repoRoot } = require('./lib/git');
const { cwdOf } = require('./lib/link');
const { nativePath, claudeHome, unreadPathStop, inPluginCache } = require('./lib/platform');
const { info, skip, warn } = require('./lib/voice');

// A step file is loaded only when the mode in hand calls it, as --state runs on
// every session start. A kit that is a workflow/ folder alone answers
// --engine-link, --in-cache, --git-hooks and a folder that is no repo;
// --command-link and each mode that reads the participation load hooks/mods/ beside it.

const MODES = new Set(['--state', '--announce', '--enable', '--decline', '--engine-link', '--command-link', '--in-cache', '--home', '--git-hooks']);

/** The kit root, physical: the folder above this workflow/. */
const kitDir = () => fs.realpathSync(path.join(__dirname, '..'));

/**
 * The run every step is handed. WORKFLOW_CLAUDE_HOME and WORKFLOW_HOOKS_DIR are
 * the tests' seams, so no test touches a real ~/.claude.
 * @returns {object}
 */
const newRun = () => {
  const kit = kitDir();
  return {
    root: null,
    rosterKey: null,
    kit,
    userDir: userDir(),
    claudeHome: claudeHome(),
    hooksDir: process.env.WORKFLOW_HOOKS_DIR || `${kit}/hooks`,
    state: null,
    needsAttention: false,
  };
};

/**
 * The full heal of an enabled repo, every step in its one order.
 * @param {object} run
 */
const heal = async (run) => {
  const { ensureEngineLink } = require('./standards/engine-link');
  const { registerInRoster, reportUserSettings, removeVersionStamp } = require('./standards/state');
  const { ensureWorkflowIgnored, ensureGitignoreBasics, ensureLocalFile } = require('./standards/gitignore');
  const { ensureGitHooks } = require('./standards/githooks');
  const { ensureIssueForms } = require('./standards/templates');
  const { ensureCiWorkflow } = require('./standards/checks');
  const { ensureChangelogSeparator, removeChangelogLinterCopies } = require('./standards/changelog');
  const {
    ensureBranchProtection, readPublicRepo, syncLabels, syncPublicLabels, sweepPublicMirror,
  } = require('./standards/labels');
  const { sweepStaleClaims, flipClaimedSpecced, checkIssueLabels } = require('./standards/claims');
  const { checkHookLayer } = require('./standards/hooks');
  const { checkTestRunner } = require('./standards/tests');
  const steps = [
    ensureEngineLink,
    registerInRoster,
    reportUserSettings,
    removeVersionStamp,
    ensureWorkflowIgnored,
    ensureGitignoreBasics,
    ensureGitHooks,
    (each) => ensureLocalFile(each, 'capture.md'),
    (each) => ensureLocalFile(each, 'session.md', 'agents/session.md'),
    ensureIssueForms,
    ensureCiWorkflow,
    ensureChangelogSeparator,
    removeChangelogLinterCopies,
    ensureBranchProtection,
    readPublicRepo,
    syncLabels,
    syncPublicLabels,
    sweepStaleClaims,
    flipClaimedSpecced,
    sweepPublicMirror,
    checkIssueLabels,
    checkHookLayer,
    checkTestRunner,
  ];
  for (const step of steps) await step(run);
};

/**
 * The one-repo modes after the participation answer: each returns its exit
 * code, or null when the heal goes on (`--enable` once the yes is written).
 * @param {string} mode
 * @param {object} run
 * @returns {Promise<number|null>}
 */
const answerMode = async (mode, run) => {
  const { root, state } = run;
  if (mode === 'state') {
    process.stdout.write(`${state}\n`);
    return 0;
  }
  if (mode === 'announce') {
    const { offerLine } = require('./standards/state');
    process.stdout.write(`${offerLine(run)}\n`);
    return 0;
  }
  // The tower clone's own heal, forms and labels only, run by the engine since
  // no session opens in the clone. It refuses every other directory.
  if (mode === 'home') {
    if (state !== 'home') {
      warn(`standards: ${root} is not the tower clone; --home heals the home repo and nothing else`);
      return 1;
    }
    const { ensureIssueForms } = require('./standards/templates');
    const { syncLabels } = require('./standards/labels');
    info(`standards: ${root} (the home clone)`);
    await ensureIssueForms(run);
    await syncLabels(run);
    return run.needsAttention ? 1 : 0;
  }
  if (mode === 'decline') {
    if (state === 'home') {
      warn(`standards: ${root} is the tower clone; engine territory, and it never participates (nothing recorded)`);
      return 1;
    }
    const { recordDecline } = require('./standards/state');
    return (await recordDecline(run)) ? 0 : 1;
  }
  if (mode === 'enable') {
    if (state === 'home') {
      warn(`standards: ${root} is the tower clone; engine territory, and it never participates`);
      return 1;
    }
    const { writeRepoOptin } = require('./standards/state');
    if (!writeRepoOptin(run)) return 1;
    run.state = 'enabled';
  }
  return null;
};

/**
 * Nothing is written into a repo that has not said yes. Only a deliberate no
 * is silent, so an unanticipated state speaks up rather than skipping a repo.
 * @param {object} run
 * @returns {boolean} whether the heal goes on
 */
const consented = (run) => {
  const { offerLine, REPO_SETTINGS } = require('./standards/state');
  const { root, state } = run;
  if (state === 'enabled') return true;
  if (state === 'home') skip(`standards: ${root} is the tower clone; engine territory, nothing to heal`);
  else if (state === 'undecided') info(offerLine(run));
  else if (state === 'unreadable') warn(`standards: ${REPO_SETTINGS} cannot be read as JSON (unreadable or not valid JSON); fix or remove it; healing nothing until then`);
  else if (state !== 'disabled' && state !== 'declined') warn(`standards: unrecognized participation state '${state}'; healing nothing; this is a bug worth reporting`);
  return false;
};

/**
 * The heal's modes, as node hands them over.
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
const main = async (argv) => {
  const mode = MODES.has(argv[0]) ? argv[0].slice(2) : 'heal';
  const args = mode === 'heal' ? argv : argv.slice(1);
  // Diagnostics go to stderr: stdout is the machine answer of --state,
  // --announce and --in-cache. The heal prints no title, so it sets its own
  // indent; --git-hooks prints in its caller's voice, as that caller set it.
  if (mode !== 'git-hooks') {
    process.env.WK_LOG_STDERR = '1';
    process.env.WK_LOG_INDENT = '  ';
  }
  if (mode === 'heal' && argv[0]?.startsWith('--')) {
    warn(`standards: unknown option ${argv[0]}`);
    return 1;
  }

  // The command's link needs no repo: the command's own step, never quiet, so
  // an explicit call makes a missing ~/.local/bin; HOME is the tests' seam.
  if (mode === 'command-link') {
    const { kitOf } = require('./workkit/kit');
    const { linkCommand } = require('./workkit/links');
    process.env.QUIET = '0';
    return linkCommand(kitOf());
  }

  // Whether this kit is the plugin cache's copy, for the session-start hook: no repo, no run.
  if (mode === 'in-cache') {
    process.stdout.write(`${inPluginCache(kitDir()) ? 'yes' : 'no'}\n`);
    return 0;
  }

  const run = newRun();
  // The engine's address needs no repo, so it answers before one is resolved.
  if (mode === 'engine-link') {
    const { ensureEngineLink } = require('./standards/engine-link');
    await ensureEngineLink(run);
    return 0;
  }

  const repoDir = args[0] || cwdOf(process.env);
  const root = repoRoot(repoDir);
  if (root === null) {
    if (mode === 'state') process.stdout.write('nogit\n');
    else skip(`standards: ${nativePath(repoDir)} is not a git repo; nothing to standardize`);
    return 0;
  }
  process.chdir(root);
  run.root = root;
  // The roster key, settled once from git's own answer: `cygpath` keeps the
  // letter case it is handed, so the cwd would mint a second key.
  run.rosterKey = nativePath(root);

  if (mode === 'git-hooks') {
    const { ensureGitHooks } = require('./standards/githooks');
    await ensureGitHooks(run);
    return run.needsAttention ? 1 : 0;
  }

  const { seedUserSettings, resolveState } = require('./standards/state');
  seedUserSettings(run);
  run.state = resolveState(run);
  const answered = await answerMode(mode, run);
  if (answered !== null) return answered;
  if (!consented(run)) return 0;

  info(`standards: ${root}`);
  await heal(run);
  if (run.needsAttention) {
    // The hook caches the day only on success, so an unfinished repo retries
    // next session; the hook keeps a non-zero exit from wedging it.
    warn(`standards: ${root} is not fully standardized; see the warning above`);
    return 1;
  }
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { process.exitCode = unreadPathStop(err); });
}

module.exports = { newRun };
