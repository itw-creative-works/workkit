/**
 * hooks/mods/commit-gate.js: safety:commit-gate. A commit passes eight
 * checks, split as git splits its hooks: pre-commit's 1 new source files carry
 * tests, 2 code carries a fresh review marker, 3 added CHANGELOG entries match
 * the format, 5 code carries the record a green root `npm test` wrote; then
 * commit-msg's 8 each closing trailer names one issue, 4 a `Fixes #N` commit
 * stages its entry, 6 every closed issue carries a `Proof:` comment, 7 every
 * named open issue is at status:complete. Stand-downs are said, all of them in
 * one notice (docs/hooks.md § safety:commit-gate).
 */

import { isChangelog, linterPath } from './changelog-guard.js';
import { closedIssues, closesAny, isDocPath, isManifest, namedIssues, sharedTrailers } from './commit-gate/checks.js';
import { budgetLine } from './commit-gate/budget.js';
import { HealHeld, exitOf, healArms, held, started } from './commit-gate/heal.js';
import { issueView } from './gh.js';
import { userDirOf } from './log.js';
import { markerPath, reviewMarkerPath, suiteMarkerPath, windowsKit } from './markers.js';
import { viewHasProof, viewStage } from './proof.js';
import { loadSettings, parseJson } from './settings.js';
import { LONG_RUN_MS, hasTestScript, suiteProved, suiteRecordMs, treeHash } from './suite.js';
import { isCodePath, isTestPath } from './test-reminder.js';

/** What every one of the gate's denies opens with. */
export const BLOCK_PREFIX = 'commit-gate: BLOCKED this commit: ';

const TEXT = {
  nothing: 'commit-gate: nothing staged: pre-commit has nothing to judge, so its checks did not run (suite included); commit-msg still judges the message.',
  noReview: 'the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit.',
  stale: "the review marker predates the last commit. This commit's code has not been reviewed. Run the workkit:review skill again, then commit.",
  fixes: 'the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit.',
  proved: 'commit-gate: suite proved: a green root `npm test` recorded this tree.',
  noCode: 'commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only).',
  firstCommit: 'commit-gate: first commit of this repo, no HEAD to judge against; the gate stands down',
  disk: 'the green run proved the tree on disk, and this commit carries a different one (an untracked file or an unstaged edit the commit leaves out): stage everything that ran (`git add -A`), or run `workkit prove` to prove the staged tree alone (the suite runs on a copy of the index, and the folder stays as it is), then commit.',
  unwired: "the commit carries code and no green run proves this tree, and npm's script-shell does not point at the kit's wrapper, so a root `npm test` writes no record. Run `workkit setup` once, then `npm test` at the repo root, then commit.",
};

const deny = (reason) => ({ deny: `${BLOCK_PREFIX}${reason}` });
const lines = (text) => String(text ?? '').split('\n').filter(Boolean);

const newFilesText = (list) => `the commit adds new source files (${list}) but touches no test file. The test obligation scales with the change (AGENTS.md §6): write/extend tests for the new files, stage them, then commit.`;
// Changes together with wk_changelog_lint's message in workflow/lib/changelog.sh.
const lintText = (stderr) => `the CHANGELOG entry does not match the format (see docs/project-state.md). ${String(stderr ?? '').replace(/\n+$/, '')}`;
const unpassedText = (list) => `the message names issues the owner has not passed: ${list}. The owner's pass moves an issue to status:complete before a commit names it (docs/project-state.md, "The park"): leave the work uncommitted until then, or drop the reference.`;
const unprovedText = (list) => `the message closes${list}, and no comment there opens with a \`Proof:\` line. A proof is a hard gate (docs/project-state.md, "The proof"): the agent that built the item comments the Proof: line first, one entry per layer with the command or the reason it was skipped, and only then does the trailer close the issue.`;
const sharedText = (trailers) => {
  const open = trailers.flatMap(({ issues }) => issues.slice(1).map((n) => `#${n}`)).join(' ');
  const form = trailers.flatMap(({ keyword, issues }) => issues.map((n) => `  ${keyword} #${n}`)).join('\n');
  return `a closing line names more than one issue, and GitHub closes only the first (the release tools read it the same way), so this commit would leave ${open} open. Give each issue its own line, then commit:\n${form}`;
};
const noGreenText = (log) => `the commit carries code and no green run proves this tree. Run \`npm test\` at the repo root (once per tree; the shell records a green run and writes its output to ${log}), then commit.`;

// A folder's real path joined to the name as written (wk_physical_path); null when it cannot be resolved.
async function physical(real, path) {
  const spelled = path.replace(/\\/g, '/');
  const cut = spelled.lastIndexOf('/');
  const dir = await real(cut === -1 ? '.' : spelled.slice(0, cut) || '/');
  return dir ? `${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${spelled.slice(cut + 1)}` : null;
}

// npm's script-shell is not the kit's wrapper beside this module (on Windows
// the built script-shell.exe in the machine folder, which must exist),
// compared by physical path, so a root `npm test` writes no record; no answer
// from npm is no (HEAD's script_shell_unwired).
async function unwired(facts) {
  const shell = await facts.scriptShell;
  if (typeof shell !== 'string') return false;
  const value = shell.replace(/\r/g, '').replace(/\n+$/, '');
  if (['', 'null', 'undefined'].includes(value)) return true;
  let want;
  if (facts.isWindows) {
    want = (await facts.real(facts.scriptShellExe)) ? await physical(facts.real, facts.scriptShellExe) : null;
  } else {
    want = await physical(facts.real, `${facts.kitRoot}/workflow/script-shell.sh`);
  }
  const have = want && (await physical(facts.real, value));
  return !want || !have || have !== want;
}

// Where a root run logs: .workkit/suite.log where git ignores it, else its marker path.
async function suiteLogOf(facts, root) {
  const ignored = await facts.run(['git', 'check-ignore', '-q', '.workkit/suite.log'], { cwd: root });
  return ignored.exitCode === 0 ? `${root}/.workkit/suite.log` : markerPath('claude-suite.log', root, facts.home);
}

// The git list a read answers, one path per line; a failed read is the hold
// `check` names, never an empty list.
async function gitList(run, root, check, argv) {
  const full = ['git', '-c', 'core.quotePath=false', ...argv];
  const r = await run(full, { cwd: root });
  if (!started(r) || r.exitCode !== 0) throw held(check, full.join(' '), exitOf(r), r.stderr);
  return lines(r.stdout);
}

// Check 1: a commit adding code files touches some test file.
async function newFilesCheck(facts, root) {
  const added = (await gitList(facts.run, root, 'new files', ['diff', '--cached', '--name-only', '--diff-filter=A'])).filter(isCodePath);
  if (added.length === 0) return null;
  const present = await gitList(facts.run, root, 'new files', ['diff', '--cached', '--name-only', '--diff-filter=d']);
  return present.some(isTestPath) ? null : deny(newFilesText(added.join(' ')));
}

// Check 2: the review marker is newer than the last commit.
async function reviewCheck(facts) {
  const marker = await facts.reviewMarker;
  if (!marker) return deny(TEXT.noReview);
  return Math.floor((marker.mtimeMs ?? 0) / 1000) < ((await facts.headTime) ?? 0) ? deny(TEXT.stale) : null;
}

// Check 3: each CHANGELOG the commit carries lints clean; a linter that did
// not start stands the check down out loud.
async function lintCheck(facts, root, files, notices) {
  for (const path of files.filter(isChangelog)) {
    const answer = await facts.lint(`${root}/${path}`);
    if (!answer) return null;
    if ('skipped' in answer) {
      notices.push(`commit-gate: check 3 stood down: the CHANGELOG linter did not start (${answer.skipped})`);
      return null;
    }
    if (answer.exitCode !== 0) return deny(lintText(answer.stderr));
  }
  return null;
}

// Checks 6 and 7: one read per named issue answers the proof and the stage.
async function issueChecks(facts, message, notices) {
  const closes = new Set(closedIssues(message));
  const unpassed = [];
  let unproved = '';
  for (const n of namedIssues(message)) {
    const view = await facts.issueView(n);
    const stage = view === null ? null : viewStage(view);
    if (stage === null) {
      notices.push(`commit-gate: could not read issue #${n} (gh could not answer), so its stage and proof checks did not run.`);
      continue;
    }
    if (stage === 'pull') continue;
    if (stage === 'none') unpassed.push(`#${n} has no status label`);
    else if (stage !== 'closed' && stage !== 'status:complete') unpassed.push(`#${n} is at ${stage}`);
    if (!closes.has(n)) continue;
    const proof = viewHasProof(view);
    if (proof === false) unproved += ` #${n}`;
    if (proof === null) notices.push(`commit-gate: could not read issue #${n}'s comments, so the proof check did not run.`);
  }
  if (unpassed.length > 0) return deny(unpassedText(unpassed.join(', ')));
  return unproved ? deny(unprovedText(unproved)) : null;
}

// Check 5: the record a green root run wrote holds the tree the commit carries;
// a recorded run past tests.budget says so beside the proved line, never a block.
async function suiteCheck(facts, root, notices) {
  const record = await facts.suiteRecord;
  if (suiteProved(record, await facts.treeId)) {
    notices.push(TEXT.proved);
    const ms = suiteRecordMs(record);
    if (ms !== null) {
      const settings = await loadSettings(facts.read, { kit: facts.kitRoot, root, user: facts.userSettings });
      const over = budgetLine(ms, settings.tests?.budget);
      if (over) notices.push(over);
    }
    return null;
  }
  if (suiteProved(record, await facts.diskTreeId)) return deny(TEXT.disk);
  if (await unwired(facts)) return deny(TEXT.unwired);
  return deny(noGreenText(await suiteLogOf(facts, root)));
}

// Check 8: no closing trailer names a second issue on its line.
function sharedCheck(message) {
  const trailers = sharedTrailers(message);
  return trailers.length > 0 ? deny(sharedText(trailers)) : null;
}

// pre-commit's checks, 1, 2, 3 and 5, over the commit's files.
async function preChecks(facts, root, files, notices) {
  const heal = healArms(facts, root);
  let hasCode = false;
  for (const path of files) {
    if (isDocPath(path) || (isManifest(path) && (await heal.versionBumpOnly(path)))) continue;
    hasCode = true;
    break;
  }
  const bookkeeping = files.length > 0 && (await heal.isBookkeeping(files));
  const tests = hasTestScript(parseJson(await facts.read(`${root}/package.json`)));
  const verdict = (!bookkeeping && tests ? await newFilesCheck(facts, root) : null)
    ?? (hasCode && !bookkeeping ? await reviewCheck(facts) : null)
    ?? (await lintCheck(facts, root, files, notices));
  if (verdict) return verdict;
  if (hasCode && tests) return suiteCheck(facts, root, notices);
  if (tests) notices.push(TEXT.noCode);
  return null;
}

// commit-msg's checks, 8, 4, 6 and 7, over the message; 6 and 7 only where a
// CHANGELOG.md marks the repo as in the pipeline. Check 4 alone reads the
// files, and an amend staging nothing new hands it none, which passes.
async function messageChecks(facts, root, files, notices, message) {
  const hasChangelog = (await facts.read(`${root}/CHANGELOG.md`)) !== null;
  return sharedCheck(message)
    ?? (hasChangelog && closesAny(message) && files.length > 0 && !files.some(isChangelog) ? deny(TEXT.fixes) : null)
    ?? (hasChangelog ? await issueChecks(facts, message, notices) : null);
}

const CHECKS = { pre: preChecks, msg: messageChecks };

// The commit's files, its stand-downs (no origin, the first commit, and for
// pre-commit alone nothing staged), then the part's checks; a held read (a heal
// arm's tool, HEAD's time) is the deny it names. Only pre-commit says a
// stand-down: commit-msg follows it and keeps quiet.
async function judgeCommit(facts, part, message = '') {
  if (await facts.originless) return null;
  const root = await facts.root;
  const says = part === 'pre';
  try {
    const files = (await facts.staged).filter(Boolean);
    if (files.length === 0 && says) {
      return hasTestScript(parseJson(await facts.read(`${root}/package.json`))) ? { context: TEXT.nothing } : null;
    }
    if ((await facts.headTime) === null) return says ? { context: TEXT.firstCommit } : null;
    const notices = [];
    const verdict = await CHECKS[part](facts, root, files, notices, message);
    if (verdict) return verdict;
    return notices.length > 0 ? { context: notices.join('\n') } : null;
  } catch (error) {
    if (error instanceof HealHeld) return deny(error.message);
    throw error;
  }
}

/**
 * pre-commit's verdict: checks 1, 2, 3 and 5 over the commit git is about to
 * make, the first it fails as a deny, else its stand-downs as one notice,
 * else null. Every fact may be a value or a promise of one, so a gatherer can
 * leave the costly ones (the tree ids, the records, npm) unread until a check
 * needs them.
 * @param {object} facts `{ root, originless, staged, headTime, reviewMarker,
 *   suiteRecord, treeId, diskTreeId, isWindows, scriptShell, scriptShellExe,
 *   userSettings, kitRoot, real, show, run, read, lint, jobRewrite, hashOf,
 *   home }`, each named in docs/hooks.md § safety:commit-gate
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export function preCommitVerdict(facts) {
  return judgeCommit(facts, 'pre');
}

/**
 * commit-msg's verdict: checks 8, 4, 6 and 7 over the commit's `message`,
 * the first it fails as a deny, else its notices, else null; silent where
 * pre-commit stood down on no origin or the first commit, and run on an
 * amend that stages nothing new.
 * @param {object} facts preCommitVerdict's facts plus `message`, the text git
 *   commits, and `issueView(n)`
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export function commitMsgVerdict(facts) {
  return judgeCommit(facts, 'msg', facts.message);
}

// The value `fn` resolves to, asked once and only when read.
const once = (fn) => {
  let value;
  return () => (value ??= fn());
};

// The facts the verdicts read, off the repo at `root`, each read only when a
// check asks.
function gatherFacts(g, root) {
  const kit = g.pluginRoot;
  const home = userDirOf(g.env);
  const at = async (argv, init = {}) => g.run(argv, { cwd: root, ...init });
  const text = async (argv, init) => {
    const r = await at(argv, init);
    return r.exitCode === 0 ? r.stdout : null;
  };
  const linter = linterPath(g.env, kit);
  // A path list the checks need, read once.
  const list = (check, argv) => once(() => gitList(at, root, check, argv));
  const staged = list('staged files', ['diff', '--cached', '--name-only']);
  // HEAD's time: null before the first commit, and a hold when git cannot
  // read the HEAD it has (never the first-commit stand-down).
  const headTime = once(async () => {
    const r = await at(['git', 'log', '-1', '--format=%ct']);
    if (started(r) && r.exitCode === 0) return Number(r.stdout.trim()) || null;
    const head = await at(['git', 'rev-parse', '--verify', '--quiet', 'HEAD']);
    if (started(head) && head.exitCode === 1) return null;
    throw held('HEAD time', 'git log -1 --format=%ct', exitOf(r), r.stderr);
  });
  // The commit's tree: the index's, less `.workkit/` (wk_suite_index_tree, through tree-hash.sh -i).
  const treeId = once(async () => (await treeHash(g.run, kit, root, g.env, '-i')).id);
  const diskTreeId = once(async () => (await treeHash(g.run, kit, root, g.env)).id);
  const reviewMarker = once(async () => g.stat(await reviewMarkerPath(root, home)));
  const suiteRecord = once(async () => g.read(await suiteMarkerPath(root, home)));
  const scriptShell = once(async () => {
    const npm = await g.run(['npm', 'config', 'get', 'script-shell'], { cwd: g.cwd });
    return !started(npm) || npm.exitCode !== 0 ? null : npm.stdout;
  });
  return {
    root,
    get originless() { return g.originless(); },
    get staged() { return staged(); },
    get headTime() { return headTime(); },
    get reviewMarker() { return reviewMarker(); },
    get suiteRecord() { return suiteRecord(); },
    get treeId() { return treeId(); },
    get diskTreeId() { return diskTreeId(); },
    get scriptShell() { return scriptShell(); },
    isWindows: windowsKit(kit),
    kitRoot: kit,
    scriptShellExe: `${home}/script-shell.exe`,
    userSettings: `${home}/settings.json`,
    real: g.real,
    home,
    show: (rev, path) => text(['git', 'show', `${rev}:${path}`], { timeoutMs: LONG_RUN_MS }),
    run: g.run,
    read: g.read,
    issueView: (n) => issueView(at, n, 'state,labels,comments,url'),
    lint: async (path) => {
      if (!(await g.stat(linter))) return null;
      const r = await at(['node', linter, path, '--added-only', '--staged']);
      return started(r) ? r : { skipped: r.stderr.trim() };
    },
    // checks.yml as the heal writes it, read at the root, whose default branch it names.
    jobRewrite: () => at(['bash', `${kit}/workflow/changelog/changelog-job.sh`, 'rewrite'], { timeoutMs: LONG_RUN_MS }),
    hashOf: async (path, body) => (await text(['git', 'hash-object', `--path=${path}`, '--stdin'], { stdin: body, timeoutMs: LONG_RUN_MS }))?.trim() || null,
  };
}

/**
 * The verdicts' facts for the commit git is making in `root`, read from the
 * hook's own environment, so `git` answers from the commit's index
 * (`GIT_INDEX_FILE`) under -a and a pathspec alike (docs/hooks.md
 * § safety:commit-gate). The git hooks' judge reads them.
 * @param {object} g the chain's facts over the real machine (facts.js bashFacts)
 * @param {string} root the repo root
 * @param {string} [message] the commit's message, for commitMsgVerdict
 * @returns {object}
 */
export function commitFacts(g, root, message = '') {
  const facts = gatherFacts(g, root);
  facts.message = message;
  return facts;
}
