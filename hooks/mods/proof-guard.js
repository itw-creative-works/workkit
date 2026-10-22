/**
 * hooks/mods/proof-guard.js: safety:proof-guard, the mechanical half of the
 * spec's proof rule (docs/project-state.md § The proof). Blocks the flip to
 * status:complete and `gh issue close <N>` while the issue carries no `Proof:`
 * line (the never-built closes pass), and the flip to status:qa while a
 * touched test file has no green npm test recorded on the tree, in the roster
 * folder of the repo the flip names. A gated command behind a cd, or naming a
 * repo it cannot read, bounces; a failed read fails open, out loud
 * (docs/hooks.md § safety:proof-guard).
 */

import { repoSlug } from './command.js';
import { issueView } from './gh.js';
import {
  denyAfter, ghBlocksCd, ghClauseSub, ghFlagValues, ghIssueNumbers, ghNames, ghRepo, ghRepoIsHere, ghSkipped, ghSteps,
} from './gh-edit.js';
import { pkgMarkerPath, suiteMarkerPath } from './markers.js';
import { rosterOf, rosterPath } from './optin.js';
import { viewHasProof } from './proof.js';
import { isPlain, parseJson } from './settings.js';
import { LONG_RUN_MS, factOf, hasTestScript, pkgProved, suiteProved, testPackageDir, treeHash } from './suite.js';
import { isTestName, isTestPath } from './test-reminder.js';

const NOT_PLANNED = /(^|[ \t\r\f\v])(--reason|-r)[= \t\r\f\v]+["']?not[ \t\r\f\v\\]+planned/im;
const DUPLICATE = /(^|[ \t\r\f\v])--duplicate-of[= \t\r\f\v]/m;

const UNREAD = 'proof-guard: BLOCKED this command. Its --repo value could not be read (a variable, a command substitution, a backtick or a quoted span), so the gate cannot tell which repo the flip or close acts on. Write the repo out as owner/name, then run it again.';
const SHAPE = 'The settings key proof.rootOnly in .workkit/settings.json is not an array of folder strings, so no package was taken as proved by the root run alone.';
const BASELESS = ' Commits since the default branch were not read: origin names no default branch and this branch has no upstream, or HEAD shares no merge base with it.';

const skipped = ghSkipped('proof-guard', 'proof gate');
const unproved = (n, what) => `proof-guard: BLOCKED this command. Issue #${n} carries no comment whose line starts with "Proof:", so it cannot ${what} (docs/project-state.md, "The proof": the proof is a hard gate).\nThe proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf.`;
const label = (pkg) => (pkg === '.' ? 'the repo root' : pkg);

/**
 * Whether the command could reach the guard: a `gh issue edit|close` that
 * spells status:complete or status:qa, or the close. None can hide its
 * literal in a variable and still do its work, so this hides nothing.
 * @param {string} command the command text
 * @returns {boolean}
 */
function proofTriggers(command) {
  if (!command || !ghNames(command, 'edit|close')) return false;
  return command.includes('status:complete') || command.includes('status:qa') || ghNames(command, 'close');
}

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
  for (const path of (await factOf(facts.touched, root)) ?? []) {
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
  let missingCount = 0;
  for (const [pkg, files] of pkgs) {
    if (rootOnly?.includes(pkg)) rooted += ` proved by the root run alone (settings proof.rootOnly): ${pkg}.`;
    else if (pkgProved(record, tree, pkg)) proved.push(`${label(pkg)} (${files.length} file(s))`);
    else {
      missing.push(`${label(pkg)}: ${files.join(' ')}`);
      missingCount += files.length;
    }
  }
  if (missing.length > 0) {
    const head = `proof-guard: BLOCKED this flip to status:qa: the ${missingCount} touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again.`;
    return { deny: [head, ...missing, ...(rootOnly === null ? [SHAPE] : [])].join('\n') };
  }
  if (rooted) notes = ` The root npm test before the commit is the proof of the package(s) the settings declare:${rooted}${notes}`;
  if (proved.length === 0 && !rooted) return { context: `proof-guard: no touched test file can be proved by npm test here, so the qa flip needs no test record.${notes}` };
  if (proved.length === 0) return { context: `proof-guard: no touched test file needs a package record on this tree.${notes}` };
  return { context: `proof-guard: every touched test file has a green npm test recorded on this tree: ${proved.join(', ')}.${notes}` };
}

/**
 * proof-guard's verdict on a Bash command: a block (the failed-read lines
 * before it), one notice, or null. Lazy facts may be async functions of the
 * repo root, called only when the qa check needs them (factOf).
 * @param {object} facts `command`, `cwd`, `root` (cwd's repo root or null); `issueView(n, repo)`
 *   async gh's `--json comments` view or null; `touched` (lazy) the working paths that exist;
 *   `packages(path, root)` async the owning package, `.` the root, null when the root has no
 *   test script; `suiteRecord`, `packageRecord`, `treeId` (lazy) text or null; `roster` the
 *   parsed .repos.json; `rootOnly` (lazy) proof.rootOnly, undefined for none, null unreadable;
 *   `slugOf(dir)`, `toplevel(dir)` async; `baseless` (lazy) the commits went unread
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function proofGuardVerdict(facts) {
  const { command, cwd, slugOf } = facts;
  if (!proofTriggers(command)) return null;
  const notes = [];
  const deny = denyAfter(notes);
  let here = null;
  const hereSlug = async () => (here ??= String((await slugOf(cwd)) ?? ''));
  let qaHere = false;
  const qaOthers = [];
  for (const { clause, detect, sawCd } of ghSteps(command)) {
    const sub = ghClauseSub(detect);
    if (!sub) continue;
    if (sub === 'close') {
      // Nothing was built, so nothing is proved: the two closes this gate ignores.
      if (NOT_PLANNED.test(clause) || DUPLICATE.test(clause)) continue;
    } else {
      const labels = ghFlagValues(clause, '--add-label').join('\n');
      if (labels.includes('status:qa')) {
        if (sawCd) return deny(ghBlocksCd('proof-guard'));
        const qaRepo = ghRepo(clause);
        if (qaRepo === null) return deny(UNREAD);
        if (qaRepo === '' || ghRepoIsHere(qaRepo, await hereSlug())) qaHere = true;
        else if (!qaOthers.includes(qaRepo.toLowerCase())) qaOthers.push(qaRepo.toLowerCase());
      }
      if (!labels.includes('status:complete')) continue;
    }
    const issues = ghIssueNumbers(detect, sub);
    if (issues.length === 0) continue;
    if (sawCd) return deny(ghBlocksCd('proof-guard'));
    const repo = ghRepo(clause);
    if (repo === null) return deny(UNREAD);
    for (const n of issues) {
      const view = await facts.issueView(n, repo);
      const proved = view === null ? null : viewHasProof(view);
      if (proved === true) continue;
      if (proved === null) notes.push(skipped(n, 'gh could not answer'));
      else return deny(unproved(n, sub === 'close' ? 'be closed' : 'move to status:complete'));
    }
  }
  if (Number(qaHere) + qaOthers.length > 1) {
    const names = [...(qaHere ? [(await hereSlug()) || "the session's repo"] : []), ...qaOthers].join(', ');
    return deny(`proof-guard: BLOCKED this command. Its flips to status:qa span more than one repo (${names}), and the park's test-record check reads one repo per command. Run one command per repo, then each flip is proved in its own repo.`);
  }
  let qa = null;
  if (qaHere) {
    qa = facts.root
      ? await checkQa(facts.root, facts)
      : { context: `proof-guard: ${cwd} is inside no git repository, so the park's test-record check did not run at the qa flip.` };
  } else if (qaOthers.length === 1) {
    const folder = await rosterPath(qaOthers[0], facts.roster, slugOf);
    const root = folder ? await facts.toplevel(folder) : null;
    if (!folder) qa = { context: `proof-guard: ${qaOthers[0]} is not opted in on this machine's workkit roster (absent or declined), so the park's test-record check did not run.` };
    else if (!root) qa = { context: `proof-guard: ${folder} is inside no git repository, so the park's test-record check did not run at the qa flip.` };
    else qa = await checkQa(root, facts);
  }
  if (qa?.deny) return deny(qa.deny);
  if (qa?.context) notes.push(qa.context);
  return notes.length > 0 ? { context: notes.join('\n') } : null;
}

// proof.rootOnly as the settings text declares it: undefined for no file, no
// proof key or a proof object without it; null for a shape that cannot hold it.
function rootOnlyDeclared(raw) {
  if (raw === null) return undefined;
  const settings = parseJson(raw);
  if (!isPlain(settings)) return null;
  if (!('proof' in settings)) return undefined;
  if (!isPlain(settings.proof)) return null;
  return 'rootOnly' in settings.proof ? settings.proof.rootOnly : undefined;
}

// The working paths under the root that still exist, as the qa check reads
// them: the working diff, then the commits since the merge base with
// origin's default branch, else with the upstream; and whether a base was found.
// Its first two reads change together with hook_working_paths in hooks/lib/tree.sh.
async function touchedOf(root, { run, read }) {
  const git = (...args) => run(['git', ...args], { cwd: root, timeoutMs: LONG_RUN_MS });
  const out = (r) => (r.exitCode === 0 ? r.stdout.trim() : '');
  const ref = out(await git('symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'))
    || out(await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'));
  const base = ref ? out(await git('merge-base', ref, 'HEAD')) : '';
  const lists = [
    (await git('diff', 'HEAD', '--name-only', '--no-renames', '-z')).stdout,
    (await git('ls-files', '--others', '--exclude-standard', '-z')).stdout,
  ].map((text) => (text ?? '').split('\0'));
  if (base) lists.push(((await git('-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=d', base, 'HEAD')).stdout ?? '').split('\n'));
  const paths = [];
  for (const path of [...new Set(lists.flat())].filter(Boolean).sort()) {
    // Only a test path is ever read, so only it pays for the deletion check.
    if (!isTestPath(path) || (await read(`${root}/${path}`)) !== null) paths.push(path);
  }
  return { paths, base };
}

/**
 * The guard's run over the Bash facts: the root and the roster are read only
 * for a command that could reach the guard, and the qa check's reads only
 * when a qa flip asks for them, each once per root.
 * @param {object} facts the chain's facts (guards.js)
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function proofGuardGuard(facts) {
  if (!proofTriggers(facts.command)) return null;
  const { run, read, env } = facts;
  const touched = new Map();
  const touchedAt = (root) => {
    if (!touched.has(root)) touched.set(root, touchedOf(root, facts));
    return touched.get(root);
  };
  const tested = (root) => async (dir) => hasTestScript(parseJson(await read(`${root}/${dir}/package.json`)));
  return proofGuardVerdict({
    command: facts.command,
    cwd: facts.cwd,
    root: await facts.top(facts.cwd),
    roster: await rosterOf(env, read),
    slugOf: (dir) => repoSlug(dir, run),
    toplevel: facts.top,
    issueView: (n, repo) => issueView(run, n, 'comments', { repo, cwd: facts.cwd, timeoutMs: LONG_RUN_MS }),
    touched: async (root) => (await touchedAt(root)).paths,
    baseless: async (root) => !(await touchedAt(root)).base,
    packages: async (path, root) => {
      const pkg = await testPackageDir(path, tested(root));
      if (pkg) return pkg;
      return hasTestScript(parseJson(await read(`${root}/package.json`))) ? '.' : null;
    },
    treeId: (root) => treeHash(run, facts.pluginRoot, root),
    suiteRecord: async (root) => read(await suiteMarkerPath(root, env.TMPDIR)),
    packageRecord: async (root) => read(await pkgMarkerPath(root, env.TMPDIR)),
    rootOnly: async (root) => rootOnlyDeclared(await read(`${root}/.workkit/settings.json`)),
  });
}
