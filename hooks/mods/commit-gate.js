/**
 * hooks/mods/commit-gate.js: safety:commit-gate. Every real `git commit`
 * passes seven checks, in this order: 1 new source files carry tests, 2 code
 * carries a fresh review marker, 3 added CHANGELOG entries match the format,
 * 4 a `Fixes #N` commit stages its entry, 6 every closed issue carries a
 * `Proof:` comment, 7 every named open issue is at status:complete, 5 code
 * carries the record a green root `npm test` wrote. A commit the gate cannot
 * place is denied; a stand-down is said, all of them in one notice
 * (docs/hooks.md § safety:commit-gate).
 */

import { isChangelog, linterPath } from './changelog-guard.js';
import { findGitCommit } from './command.js';
import { closedIssues, closesAny, commitFlags, isDocPath, isManifest, namedIssues } from './commit-gate/checks.js';
import { HealHeld, healArms } from './commit-gate/heal.js';
import { issueView } from './gh.js';
import { userDirOf } from './log.js';
import { markerPath, reviewMarkerPath, suiteMarkerPath, windowsKit } from './markers.js';
import { viewHasProof, viewStage } from './proof.js';
import { parseJson } from './settings.js';
import { LONG_RUN_MS, hasTestScript, suiteProved, treeHash } from './suite.js';
import { isCodePath, isTestPath } from './test-reminder.js';

/** What every one of the gate's denies opens with. */
export const BLOCK_PREFIX = 'commit-gate: BLOCKED this commit: ';

const TEXT = {
  wrapped: "the commit is wrapped in an interpreter string (sh -c / eval); run a plain 'git commit ...' directly so the gate can read its flags and message.",
  cd: "the command changes directory before committing; run a plain 'git commit' with the session already in the repo so the gate can see its staging.",
  stage: "the command stages and commits in one call, so the gate cannot see what the commit will carry; stage first (its own command), then run a plain 'git commit'.",
  noRepo: "the session's directory is not inside a git repository, so the gate cannot see what this commit would carry. cd into the repo's root as its own command first, then run a plain 'git commit' there.",
  nothing: 'commit-gate: nothing staged and no -a/pathspec: the gate has nothing to judge, so no check ran (suite included).',
  noReview: 'the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit.',
  stale: "the review marker predates the last commit. This commit's code has not been reviewed. Run the workkit:review skill again, then commit.",
  fixes: 'the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit.',
  proved: 'commit-gate: suite proved: a green root `npm test` recorded this tree.',
  noCode: 'commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only).',
  pathspec: 'a pathspec commit carries a tree the gate cannot compare with the record: stage the files and commit from the index.',
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
const noGreenText = (log) => `the commit carries code and no green run proves this tree. Run \`npm test\` at the repo root (once per tree; the shell records a green run and writes its output to ${log}), then commit.`;

// A folder's real path joined to the name as written (wk_physical_path); null when it cannot be resolved.
async function physical(real, path) {
  const spelled = path.replace(/\\/g, '/');
  const cut = spelled.lastIndexOf('/');
  const dir = await real(cut === -1 ? '.' : spelled.slice(0, cut) || '/');
  return dir ? `${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${spelled.slice(cut + 1)}` : null;
}

// The tree the commit carries: the real index's `git write-tree` at the root
// (wk_suite_index_tree's one command), or under -a/--all the index plus every
// tracked change.
async function commitTree(facts, root, all) {
  if (all) return facts.indexTreeId();
  const r = await facts.run(['git', 'write-tree'], { cwd: root });
  return r.exitCode === 0 ? r.stdout.trim() || null : null;
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
  return ignored.exitCode === 0 ? `${root}/.workkit/suite.log` : markerPath('claude-suite.log', root, facts.tmpdir);
}

// The git list a read answers, one path per line; a failed read lists nothing.
async function gitList(run, root, argv) {
  const r = await run(['git', '-c', 'core.quotePath=false', ...argv], { cwd: root });
  return r.exitCode === 0 ? lines(r.stdout) : [];
}

// Check 1: a commit adding code files touches some test file.
async function newFilesCheck(facts, root, all) {
  const added = (await gitList(facts.run, root, ['diff', '--cached', '--name-only', '--diff-filter=A'])).filter(isCodePath);
  if (added.length === 0) return null;
  const present = await gitList(facts.run, root, ['diff', '--cached', '--name-only', '--diff-filter=d']);
  if (all) present.push(...(await gitList(facts.run, root, ['diff', '--name-only', '--diff-filter=d'])));
  return present.some(isTestPath) ? null : deny(newFilesText(added.join(' ')));
}

// Check 2: the review marker is newer than the last commit.
async function reviewCheck(facts) {
  const marker = await facts.reviewMarker;
  if (!marker) return deny(TEXT.noReview);
  return Math.floor((marker.mtimeMs ?? 0) / 1000) < ((await facts.headTime) ?? 0) ? deny(TEXT.stale) : null;
}

// Check 3: each CHANGELOG the commit carries lints clean; a pathspec commit lints the root one.
async function lintCheck(facts, root, files, flags, hasChangelog) {
  const paths = flags.pathspec && hasChangelog ? ['CHANGELOG.md'] : files.filter(isChangelog);
  for (const path of paths) {
    const answer = await facts.lint(`${root}/${path}`);
    if (!answer) return null;
    if (answer.exitCode !== 0) return deny(lintText(answer.stderr));
  }
  return null;
}

// Checks 6 and 7: one read per named issue answers the proof and the stage.
async function issueChecks(facts, command, notices) {
  const closes = new Set(closedIssues(command));
  const unpassed = [];
  let unproved = '';
  for (const n of namedIssues(command)) {
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

// Check 5: the record a green root run wrote holds the tree the commit carries.
async function suiteCheck(facts, root, all, notices) {
  const record = await facts.suiteRecord;
  if (suiteProved(record, await commitTree(facts, root, all))) {
    notices.push(TEXT.proved);
    return null;
  }
  if (suiteProved(record, await facts.treeId)) return deny(TEXT.disk);
  if (await unwired(facts)) return deny(TEXT.unwired);
  return deny(noGreenText(await suiteLogOf(facts, root)));
}

// The seven checks over a commit placed in an origin repo, its files known.
async function judge(facts, root, flags, files, notices) {
  const heal = healArms(facts, root, flags.all);
  try {
    let hasCode = flags.pathspec;
    for (const path of files) {
      if (isDocPath(path) || (isManifest(path) && (await heal.versionBumpOnly(path)))) continue;
      hasCode = true;
      break;
    }
    const bookkeeping = !flags.pathspec && files.length > 0 && (await heal.isBookkeeping(files));
    const tests = hasTestScript(parseJson(await facts.read(`${root}/package.json`)));
    const hasChangelog = (await facts.read(`${root}/CHANGELOG.md`)) !== null;
    const verdict = (!bookkeeping && !flags.pathspec && tests ? await newFilesCheck(facts, root, flags.all) : null)
      ?? (hasCode && !bookkeeping ? await reviewCheck(facts) : null)
      ?? (await lintCheck(facts, root, files, flags, hasChangelog))
      ?? (!flags.pathspec && hasChangelog && closesAny(facts.command) && !files.some(isChangelog) ? deny(TEXT.fixes) : null)
      ?? (hasChangelog ? await issueChecks(facts, facts.command, notices) : null);
    if (verdict) return verdict;
    if (hasCode && tests) return flags.pathspec ? deny(TEXT.pathspec) : await suiteCheck(facts, root, flags.all, notices);
    if (tests) notices.push(TEXT.noCode);
    return null;
  } catch (error) {
    if (error instanceof HealHeld) return deny(error.message);
    throw error;
  }
}

/**
 * commit-gate's verdict on a Bash command: the first check it fails as a
 * deny, else its stand-downs as one notice, else null.
 * Every fact may be a value or a promise of one, so a gatherer can leave the
 * costly ones (the tree id, the records, npm) unread until a check needs them.
 * @param {object} facts `{ command, cwd, root, originless, staged, changed,
 *   headTime, reviewMarker, suiteRecord, treeId, indexTreeId, isWindows,
 *   scriptShell, scriptShellExe, kitRoot, real, show, run, read, issueView,
 *   lint, jobRewrite, hashOf, tmpdir }`, each named in docs/hooks.md § safety:commit-gate
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function commitGateVerdict(facts) {
  const { command, cwd } = facts;
  if (!command) return null;
  const found = findGitCommit(command);
  if (found.wrapped) return deny(TEXT.wrapped);
  if (!found.clause) return null;
  if (found.sawCd) return deny(TEXT.cd);
  if (found.sawStage && !(await facts.originless)) return deny(TEXT.stage);
  const flags = commitFlags(found.clause);
  if (flags.deny) return deny(flags.deny);
  if (!cwd) return null;
  const root = await facts.root;
  if (!root) return deny(TEXT.noRepo);
  if (await facts.originless) return null;
  const files = [...(await facts.staged), ...(flags.all ? await facts.changed : [])].filter(Boolean);
  const notices = [];
  if (files.length === 0 && !flags.pathspec) {
    return hasTestScript(parseJson(await facts.read(`${root}/package.json`))) ? { context: TEXT.nothing } : null;
  }
  const verdict = await judge(facts, root, flags, files, notices);
  if (verdict) return verdict;
  return notices.length > 0 ? { context: notices.join('\n') } : null;
}

// The value `fn` resolves to, asked once and only when read.
const once = (fn) => {
  let value;
  return () => (value ??= fn());
};

// The rewrite entry over a checks.yml text: the text in a scratch file the entry reads, removed after.
async function rewriteOf(g, at, kit, text, template) {
  const made = await g.run(['mktemp', '-d'], { timeoutMs: LONG_RUN_MS });
  if (made.exitCode !== 0) return made;
  let dir = made.stdout.trim();
  if (windowsKit(kit)) dir = (await g.run(['cygpath', '-m', dir])).stdout.trim() || dir;
  try {
    await g.write(`${dir}/checks-head`, text);
    return await at(['bash', `${kit}/workflow/changelog/changelog-job.sh`, 'rewrite', `${dir}/checks-head`, ...(template ? [template] : [])], { timeoutMs: LONG_RUN_MS });
  } finally {
    await g.run(['rm', '-rf', dir]);
  }
}

/**
 * The guard's run over the Bash facts: a real commit's facts, each read only
 * when a check asks. `treeId` is the working tree's id (`tree-hash.sh
 * <root>`), `indexTreeId()` the tree a -a/--all commit carries (`tree-hash.sh
 * <root> -u`); `originless` the chain's memoized origin test;
 * `scriptShell` npm's raw value; `scriptShellExe` the Windows wrapper
 * (`<user dir>/script-shell.exe`, wk_script_shell_exe's path); `lint(path)` the linter's run over the index unless the commit
 * carries -a/--all or a pathspec, null with no node or linter; `jobRewrite(a,
 * b)` the rewrite entry over the text `a`; `hashOf(path, text)` the blob id
 * (docs/hooks.md § safety:commit-gate).
 * @param {object} g the chain's facts (guards.js)
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function commitGateGuard(g) {
  const found = findGitCommit(g.command);
  if (!found.clause && !found.wrapped) return null;
  const kit = g.pluginRoot;
  const { TMPDIR } = g.env;
  const flags = found.clause ? commitFlags(found.clause) : {};
  const top = once(() => (g.cwd ? g.top(g.cwd) : null));
  const at = async (argv, init = {}) => g.run(argv, { cwd: await top(), ...init });
  const text = async (argv, init) => {
    const r = await at(argv, init);
    return r.exitCode === 0 ? r.stdout : null;
  };
  const treeId = once(async () => treeHash(g.run, kit, await top()));
  const linter = linterPath(g.env, kit);
  const list = (argv) => once(async () => lines(await text(['git', '-c', 'core.quotePath=false', ...argv])));
  const staged = list(['diff', '--cached', '--name-only']);
  const changed = list(['diff', '--name-only']);
  const headTime = once(async () => Number((await text(['git', 'log', '-1', '--format=%ct']))?.trim()) || null);
  const reviewMarker = once(async () => g.stat(await reviewMarkerPath(await top(), TMPDIR)));
  const suiteRecord = once(async () => g.read(await suiteMarkerPath(await top(), TMPDIR)));
  const scriptShell = once(async () => {
    const npm = await g.run(['npm', 'config', 'get', 'script-shell'], { cwd: g.cwd });
    return npm.isStarted === false || npm.exitCode !== 0 ? null : npm.stdout;
  });
  return commitGateVerdict({
    command: g.command,
    cwd: g.cwd,
    get root() { return top(); },
    get originless() { return g.originless(); },
    get staged() { return staged(); },
    get changed() { return changed(); },
    get headTime() { return headTime(); },
    get reviewMarker() { return reviewMarker(); },
    get suiteRecord() { return suiteRecord(); },
    get treeId() { return treeId(); },
    indexTreeId: once(async () => treeHash(g.run, kit, await top(), '-u')),
    get scriptShell() { return scriptShell(); },
    isWindows: windowsKit(kit),
    kitRoot: kit,
    scriptShellExe: `${userDirOf(g.env)}/script-shell.exe`,
    real: g.real,
    tmpdir: TMPDIR,
    show: (rev, path) => text(['git', 'show', `${rev}:${path}`], { timeoutMs: LONG_RUN_MS }),
    run: g.run,
    read: g.read,
    issueView: (n) => issueView(at, n, 'state,labels,comments,url'),
    lint: async (path) => {
      if (!(await g.stat(linter))) return null;
      const r = await at(['node', linter, path, '--added-only', ...(flags.all || flags.pathspec ? [] : ['--staged'])]);
      return r.isStarted === false ? null : r;
    },
    jobRewrite: (a, b) => rewriteOf(g, at, kit, a, b),
    hashOf: async (path, body) => (await text(['git', 'hash-object', `--path=${path}`, '--stdin'], { stdin: body, timeoutMs: LONG_RUN_MS }))?.trim() || null,
  });
}
