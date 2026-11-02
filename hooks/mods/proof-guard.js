/**
 * hooks/mods/proof-guard.js: safety:proof-guard, the mechanical half of the
 * spec's proof rule (docs/project-state.md § The proof). Blocks the flip to
 * status:complete and `gh issue close <N>` while the issue carries no `Proof:`
 * line (the never-built closes pass), and the flip to status:qa while a
 * touched test file has no green npm test recorded on the tree, in the roster
 * folder of the repo the flip names. The gh shim's gate runs it; a failed
 * read fails open, out loud (workflow/identity/gate.js, docs/hooks.md
 * § safety:proof-guard).
 */

import { denyAfter, ghSkipped, issueView } from './gh.js';
import { userDirOf } from './log.js';
import { pkgMarkerPath, suiteMarkerPath } from './markers.js';
import { ghRepoIsHere, repoSlug, rosterOf, rosterPath } from './optin.js';
import { viewHasProof } from './proof.js';
import { parseJson, rootSettings } from './settings.js';
import { LONG_RUN_MS, factOf, hasTestScript, pkgProved, suiteProved, testPackageDir, treeHash } from './suite.js';
import { isTestName, isTestPath } from './test-reminder.js';

const SHAPE = 'The key proof.rootOnly in the settings is not an array of folder strings, so no package was taken as proved by the root run alone.';
const WORKING_READS = [['diff', 'HEAD', '--name-only', '--no-renames', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']];
// With no commit yet the staged list stands in for the diff against HEAD.
const UNBORN_READS = [['ls-files', '-z'], WORKING_READS[1]];
const BASELESS = ' Commits since the default branch were not read: origin names no default branch and this branch has no upstream, or HEAD shares no merge base with it.';

const skipped = ghSkipped('proof-guard', 'proof gate');
const unproved = (n, what) => `proof-guard: BLOCKED this command. Issue #${n} carries no comment whose line starts with "Proof:", so it cannot ${what} (docs/project-state.md, "The proof": the proof is a hard gate).\nThe proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf.`;
const label = (pkg) => (pkg === '.' ? 'the repo root' : pkg);
const unreadDiff = (root, read) => `proof-guard: BLOCKED this flip to status:qa: the working diff of ${root} could not be read (${read}), so the touched test files are unknown. Fix git, then flip again.`;
// Only a tree-hash: line naming node gets the fix; a workspaces: line prints as it is.
const wholeTree = (note) => note.split('\n')
  .map((line) => (line.startsWith('tree-hash:') && /\bnode\b/.test(line) ? `${line}; put the node it names on the gate's PATH, or set WORKKIT_NODE.` : line))
  .join('\n');

// The folders proof.rootOnly declares, a trailing / dropped; null when the
// value is not an array of strings (undefined declares nothing).
function rootOnlyOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null;
  return value.map((v) => v.replace(/\/+$/, ''));
}

// The record check at the flip to status:qa, in the repo whose root is
// `root`: it runs no test and reads two records. Answers a deny or a notice.
async function checkQa(root, facts) {
  let notes = '';
  const tests = [];
  const helpers = [];
  const touched = await factOf(facts.touched, root);
  if (touched === null) return { deny: unreadDiff(root, await factOf(facts.unread, root)) };
  for (const path of touched ?? []) {
    if (!isTestPath(path)) continue;
    if (isTestName(path)) tests.push(path);
    else helpers.push(path);
  }
  if (helpers.length > 0) notes = ` Touched under a test folder but not a test file, so not required: ${helpers.join(' ')}.`;
  if (await factOf(facts.baseless, root)) notes += BASELESS;
  if (tests.length === 0) return { context: `proof-guard: no touched test files in the working diff, so the qa flip needs no test record.${notes}` };
  const tree = await factOf(facts.treeId, root);
  if (!tree) {
    return { deny: `proof-guard: BLOCKED this flip to status:qa: the working tree of ${root} could not be hashed, so the park's test record cannot be read. Fix what stops git hashing the tree (git add -A into a throwaway index, then git write-tree), then flip again.` };
  }
  if (suiteProved(await factOf(facts.suiteRecord, root), tree)) {
    return { context: `proof-guard: the whole root suite is green on this tree, which covers the ${tests.length} touched test file(s).${notes}` };
  }
  const pkgs = new Map();
  const unprovable = [];
  for (const path of tests) {
    const pkg = await facts.packages(path, root);
    if (pkg === null) {
      unprovable.push(path);
      continue;
    }
    if (!pkgs.has(pkg)) pkgs.set(pkg, []);
    pkgs.get(pkg).push(pkg === '.' ? path : path.slice(pkg.length + 1));
  }
  if (unprovable.length > 0) notes = ` Cannot be proved by npm test, since the repo root has no test script, so not required: ${unprovable.join(' ')}.${notes}`;
  const rootOnly = rootOnlyOf(await factOf(facts.rootOnly, root));
  if (rootOnly === null) notes += ` ${SHAPE}`;
  const record = await factOf(facts.packageRecord, root);
  let rooted = '';
  const proved = [];
  const missing = [];
  const keyed = [];
  let missingCount = 0;
  for (const [pkg, files] of pkgs) {
    if (rootOnly?.includes(pkg)) {
      rooted += ` proved by the root run alone (settings proof.rootOnly): ${pkg}.`;
      continue;
    }
    // A package's line is keyed to its own id: the tree less the members it cannot see.
    const { id: own, note } = pkg === '.' ? { id: tree, note: null } : await factOf(facts.pkgTree, root, pkg);
    if (!own) {
      return { deny: `proof-guard: BLOCKED this flip to status:qa: the tree of ${label(pkg)} in ${root} could not be hashed, so its test record cannot be read. Fix what stops git hashing the tree (git add -A into a throwaway index, then git write-tree), then flip again.` };
    }
    if (pkgProved(record, own, pkg)) proved.push(`${label(pkg)} (${files.length} file(s))`);
    else {
      missing.push(`${label(pkg)}: ${files.join(' ')}`);
      missingCount += files.length;
      if (note) keyed.push(wholeTree(note));
    }
  }
  if (missing.length > 0) {
    const head = `proof-guard: BLOCKED this flip to status:qa: the ${missingCount} touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again.`;
    return { deny: [[head, ...keyed].join(' '), ...missing, ...(rootOnly === null ? [SHAPE] : [])].join('\n') };
  }
  if (rooted) notes = ` The root npm test before the commit is the proof of the package(s) the settings declare:${rooted}${notes}`;
  if (proved.length === 0 && !rooted) return { context: `proof-guard: no touched test file can be proved by npm test here, so the qa flip needs no test record.${notes}` };
  if (proved.length === 0) return { context: `proof-guard: no touched test file needs a package record on this tree.${notes}` };
  return { context: `proof-guard: every touched test file has a green npm test recorded on this tree: ${proved.join(', ')}.${notes}` };
}

// The proof check of one repo's steps: a close, or a flip adding
// status:complete, whose issue carries no Proof: line answers its deny text;
// an issue gh could not read adds a notice to `notes`.
async function proofSteps(steps, repo, facts, notes) {
  for (const { sub, number: n, add } of steps) {
    if (sub !== 'close' && !(sub === 'edit' && add.includes('status:complete'))) continue;
    const view = await facts.issueView(n, repo);
    const proved = view === null ? null : viewHasProof(view);
    if (proved === true) continue;
    if (proved === null) notes.push(skipped(n, 'gh could not answer'));
    else return unproved(n, sub === 'close' ? 'be closed' : 'move to status:complete');
  }
  return null;
}

// The qa check for flips to status:qa on `repo`: the session's repo ('' or
// the cwd's origin) is checked at facts.root, another in its roster folder.
async function qaOn(repo, cwd, facts) {
  if (!repo || ghRepoIsHere(repo, String((await facts.slugOf(cwd)) ?? ''))) {
    return facts.root
      ? checkQa(facts.root, facts)
      : { context: `proof-guard: ${cwd} is inside no git repository, so the park's test-record check did not run at the qa flip.` };
  }
  const folder = await rosterPath(repo.toLowerCase(), facts.roster, facts.slugOf);
  const root = folder ? await facts.toplevel(folder) : null;
  if (!folder) return { context: `proof-guard: ${repo.toLowerCase()} is not opted in on this machine's workkit roster (absent or declined), so the park's test-record check did not run.` };
  if (!root) return { context: `proof-guard: ${folder} is inside no git repository, so the park's test-record check did not run at the qa flip.` };
  return checkQa(root, facts);
}

/**
 * proof-guard's verdict on one gh call's steps: a block (the failed-read
 * lines before it), one notice, or null. A close the gate ignores is never
 * handed in; lazy facts are async functions of the repo root (factOf).
 * @param {{steps: Array<{sub: string, number: string, add: string[], remove: string[]}>, cwd: string, repo: string, facts: object}} call
 *   the repo is '' for the cwd's; the facts: `root` (cwd's repo root or null); `issueView(n, repo)`
 *   async gh's `--json comments` view or null; `touched` (lazy) the working paths, null when unread; `packages(path,
 *   root)` async the owning package, `.` the root, null with no root test script; `suiteRecord`,
 *   `packageRecord`, `treeId` (lazy) text or null; `pkgTree(root, pkg)` async a package's own `{ id, note }` (treeHash); `roster` the parsed .repos.json; `rootOnly`
 *   (lazy) proof.rootOnly from the merged settings, undefined none; `slugOf`, `toplevel` async; `baseless`;
 *   `unread` (lazy) the working-diff read that failed when `touched` is null
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function proofVerdict({ steps, cwd, repo, facts }) {
  const notes = [];
  const deny = denyAfter(notes);
  const unprovedText = await proofSteps(steps, repo, facts, notes);
  if (unprovedText) return deny(unprovedText);
  if (steps.some(({ sub, add }) => sub === 'edit' && add.includes('status:qa'))) {
    const qa = await qaOn(repo, cwd, facts);
    if (qa.deny) return deny(qa.deny);
    if (qa.context) notes.push(qa.context);
  }
  return notes.length > 0 ? { context: notes.join('\n') } : null;
}

// proof.rootOnly as the merged settings hold it, undefined for the default null.
function rootOnlyDeclared(settings) {
  return settings.proof.rootOnly ?? undefined;
}

// The working paths under the root that still exist, as the qa check reads
// them: the working diff, then the commits since the merge base with
// origin's default branch, else with the upstream; and whether a base was found.
// A failed working-diff read answers null paths and the read that failed.
// Its first two reads change together with hook_working_paths in hooks/lib/tree.sh.
async function touchedOf(root, { run, read }) {
  const git = (...args) => run(['git', ...args], { cwd: root, timeoutMs: LONG_RUN_MS });
  const out = (r) => (r.exitCode === 0 ? r.stdout.trim() : '');
  const ref = out(await git('symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'))
    || out(await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'));
  const base = ref ? out(await git('merge-base', ref, 'HEAD')) : '';
  const lists = [];
  const born = (await git('rev-parse', '--verify', '-q', 'HEAD')).exitCode === 0;
  for (const args of born ? WORKING_READS : UNBORN_READS) {
    const r = await git(...args);
    if (r.isStarted === false) return { paths: null, base, unread: `git ${args.join(' ')} did not start` };
    if (r.exitCode !== 0) return { paths: null, base, unread: `git ${args.join(' ')} exited ${r.exitCode}` };
    lists.push((r.stdout ?? '').split('\0'));
  }
  if (base) lists.push(((await git('-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=d', base, 'HEAD')).stdout ?? '').split('\n'));
  const paths = [];
  for (const path of [...new Set(lists.flat())].filter(Boolean).sort()) {
    // Only a test path is ever read, so only it pays for the deletion check.
    if (!isTestPath(path) || (await read(`${root}/${path}`)) !== null) paths.push(path);
  }
  return { paths, base };
}

/**
 * proofVerdict's facts over the call's: the root and the roster read now, the
 * qa check's reads only when a qa flip asks for them, each once per root.
 * @param {object} facts the call's facts (guards.js bashFacts)
 * @returns {Promise<object>}
 */
export async function proofFacts(facts) {
  const { run, read, env } = facts;
  const touched = new Map();
  const touchedAt = (root) => {
    if (!touched.has(root)) touched.set(root, touchedOf(root, facts));
    return touched.get(root);
  };
  const tested = (root) => async (dir) => hasTestScript(parseJson(await read(`${root}/${dir}/package.json`)));
  return {
    root: await facts.top(facts.cwd),
    roster: await rosterOf(env, read),
    slugOf: (dir) => repoSlug(dir, run),
    toplevel: facts.top,
    issueView: (n, repo) => issueView(run, n, 'comments', { repo, cwd: facts.cwd, timeoutMs: LONG_RUN_MS }),
    touched: async (root) => (await touchedAt(root)).paths,
    unread: async (root) => (await touchedAt(root)).unread,
    baseless: async (root) => !(await touchedAt(root)).base,
    packages: async (path, root) => {
      const pkg = await testPackageDir(path, tested(root));
      if (pkg) return pkg;
      return hasTestScript(parseJson(await read(`${root}/package.json`))) ? '.' : null;
    },
    treeId: async (root) => (await treeHash(run, facts.pluginRoot, root, env)).id,
    pkgTree: (root, pkg) => treeHash(run, facts.pluginRoot, root, env, pkg),
    suiteRecord: async (root) => read(await suiteMarkerPath(root, userDirOf(env))),
    packageRecord: async (root) => read(await pkgMarkerPath(root, userDirOf(env))),
    rootOnly: async (root) => rootOnlyDeclared(await rootSettings(root, env, facts)),
  };
}
