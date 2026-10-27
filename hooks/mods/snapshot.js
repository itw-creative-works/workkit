/**
 * hooks/mods/snapshot.js: workflow:snapshot. The claim of an issue to
 * status:building takes the repo snapshot scripts/red-proof.sh runs against,
 * or adds its number to the live one (replacing it once stale); a release (a
 * qa or complete flip, or a close) leaving no issue there at status:building
 * drops it. The copy, fill and sweep stay in hooks/lib/snapshot.sh, run
 * through its entry; a notice at most, never a block (docs/hooks.md § workflow:snapshot).
 */

import { repoSlug } from './command.js';
import { buildingList } from './gh.js';
import { ghClauseSub, ghFlagValues, ghIssueNumbers, ghNames, ghRepo, ghRepoIsHere, ghSteps, hasLabel } from './gh-edit.js';
import { userDirOf } from './log.js';
import { snapshotMarkerPath } from './markers.js';
import { rosterOf, rosterPath } from './optin.js';
import { issuesBuilding } from './proof.js';
import { LONG_RUN_MS } from './suite.js';

/**
 * Whether the command could be a claim or a release: a `gh issue edit|close`
 * spelling status:building, status:qa or status:complete, or the close.
 * @param {string} command the command text
 * @returns {boolean}
 */
function snapshotTriggers(command) {
  if (!command || !ghNames(command, 'edit|close')) return false;
  return /status:(building|qa|complete)/.test(command) || ghNames(command, 'close');
}

// The folder a clause's flip acts on and the repo it named ('' for none), or a note.
async function place(clause, { cwd, roster, slugOf }, sawCd) {
  const repo = ghRepo(clause);
  if (repo === null) return { note: 'a --repo value could not be read (a variable, a substitution or a quoted span), so no snapshot was taken or dropped for it.' };
  if (repo === '' || ghRepoIsHere(repo, String((await slugOf(cwd)) ?? ''))) {
    if (repo === '' && sawCd) return { note: 'the command changes directory before a flip naming no --repo, so no snapshot was taken or dropped for it.' };
    return { dir: cwd, repo };
  }
  const folder = await rosterPath(repo, roster, slugOf);
  if (!folder) return { note: `${repo} is not opted in on this machine's workkit roster (absent or declined), so no snapshot was taken or dropped for it.` };
  return { dir: folder, repo };
}

// A failed call may have failed at the claim itself, so only the numbers
// GitHub lists as building are taken; each other one is named in a note.
async function failedClaim({ dir, repo }, issues, facts) {
  const list = await facts.building(dir, repo, { claim: true });
  if (list !== null && typeof list === 'object') return [list];
  const building = list === null ? null : issuesBuilding(list);
  const listed = building === null ? [] : building.map(String);
  const kept = issues.filter((n) => listed.includes(n));
  const missed = issues.filter((n) => !kept.includes(n)).map((n) => `#${n}`).join(', ');
  const where = repo ? ` in ${repo}` : '';
  const steps = kept.length > 0 ? [{ take: dir, issues: kept, repo }] : [];
  if (!missed) return steps;
  const why = building === null
    ? `GitHub's status:building list${where} could not be read`
    : `GitHub does not list ${missed}${where} as status:building`;
  return [...steps, { note: `the command failed and ${why}, so no snapshot was taken for ${missed}.` }];
}

/**
 * What a Bash command asks of the snapshot, one step per clause that claims
 * or releases, in order: take (the folder, the claimed numbers and the repo
 * named), drop (a release GitHub says left nothing building), or a note for
 * a flip it cannot place. A release that leaves an issue building is no step.
 * On a failed call a claim takes only the numbers GitHub lists as building.
 * @param {{command: string, cwd: string, roster: object|null, slugOf: function, building: function, failed: boolean}} facts
 *   the command, its folder, the parsed ~/.workkit/.repos.json, `slugOf(dir)` async a folder's
 *   origin slug, `building(dir, repo, { claim })` async gh's status:building list there, null when
 *   unread (`claim` set for a failed call's claim, answered `{ note }` for a folder in no git
 *   repository), and whether the Bash call failed
 * @returns {Promise<Array<{take: string, issues: string[], repo: string}|{drop: string, repo: string}|{note: string}>>}
 */
export async function snapshotPlan(facts) {
  const steps = [];
  if (!snapshotTriggers(facts.command)) return steps;
  for (const { clause, detect, sawCd } of ghSteps(facts.command)) {
    const sub = ghClauseSub(detect);
    if (!sub) continue;
    let claim = false;
    if (sub === 'edit') {
      const adds = ghFlagValues(clause, '--add-label');
      // A remove of status:building alone (a block, a re-spec) is neither.
      claim = hasLabel(adds, 'status:building');
      if (!claim && !hasLabel(adds, 'status:qa') && !hasLabel(adds, 'status:complete')) continue;
    }
    const placed = await place(clause, facts, sawCd);
    if (placed.note) steps.push(placed);
    else if (claim && facts.failed) steps.push(...(await failedClaim(placed, ghIssueNumbers(detect, 'edit'), facts)));
    else if (claim) steps.push({ take: placed.dir, issues: ghIssueNumbers(detect, 'edit'), repo: placed.repo });
    else {
      const list = await facts.building(placed.dir, placed.repo);
      if (list !== null && issuesBuilding(list)?.length === 0) steps.push({ drop: placed.dir, repo: placed.repo });
    }
  }
  return steps;
}

// The note for a step whose folder lies in no git repository.
const noRepoNote = (dir, repo, cwd) => (dir === cwd
  ? "the session's folder lies in no git repository, so no snapshot was taken or dropped."
  : `${repo}'s roster folder ${dir} lies in no git repository, so no snapshot was taken or dropped for it.`);

// One take or drop step run through the entry in its repo: a note, or null.
async function runStep(step, facts, snapOf) {
  const dir = step.take ?? step.drop;
  const root = await facts.top(dir);
  if (!root) return noRepoNote(dir, step.repo, facts.cwd);
  const entry = (mode, ...args) => facts.run(['bash', `${facts.pluginRoot}/hooks/lib/snapshot.sh`, mode, root, ...args], { cwd: root, timeoutMs: LONG_RUN_MS });
  if (step.drop) {
    await entry('drop');
    return null;
  }
  const snap = await snapOf(root);
  if ((await facts.list(snap)).includes('tree')) {
    const recorded = ((await facts.read(`${snap}/issues`)) ?? '').split('\n');
    // A re-claim of a recorded number keeps the snapshot, stale or not; a failed read keeps it too.
    const keep = step.issues.some((n) => recorded.includes(n))
      || (await entry('stale', ...(step.repo ? [step.repo] : []))).exitCode !== 0;
    if (keep) {
      const added = await entry('add', ...step.issues);
      return added.exitCode === 0 ? null : `could not add issue ${step.issues.join(' ')} to the snapshot of ${root}.`;
    }
  }
  const taken = await entry('take', ...step.issues);
  const said = `${taken.stdout ?? ''}${taken.stderr ?? ''}`.replace(/\s+$/, '');
  if (taken.exitCode !== 0) return `the snapshot of ${root} could not be taken, so red-proof has none for it: ${said || 'the copy failed'}`;
  return said || null;
}

/**
 * The hook's run over the Bash facts after the command ran: the plan, then
 * each step in order through `bash hooks/lib/snapshot.sh take|add|stale|drop
 * <root>` in the repo it names, the notes joined into one notice. A claim on
 * a live snapshot adds its numbers unless none of the recorded issues is
 * still building, which takes it afresh.
 * @param {object} facts the chain's facts (guards.js)
 * @returns {Promise<{context: string}|null>}
 */
export async function snapshotGuard(facts) {
  if (!snapshotTriggers(facts.command)) return null;
  const snapOf = (root) => snapshotMarkerPath(root, userDirOf(facts.env));
  const steps = await snapshotPlan({
    command: facts.command,
    cwd: facts.cwd,
    roster: await rosterOf(facts.env, facts.read),
    slugOf: (dir) => repoSlug(dir, facts.run),
    // A release with no snapshot there has nothing to drop, so GitHub is not asked.
    building: async (dir, repo, { claim = false } = {}) => {
      const root = await facts.top(dir);
      if (!root && claim) return { note: noRepoNote(dir, repo, facts.cwd) };
      if (!root || (!claim && (await facts.list(await snapOf(root))).length === 0)) return null;
      return buildingList(facts.run, { repo, cwd: root });
    },
    failed: facts.failed,
  });
  const notes = [];
  for (const step of steps) {
    const said = step.note ?? (await runStep(step, facts, snapOf));
    if (said) notes.push(said);
  }
  return notes.length > 0 ? { context: `workflow:snapshot: ${notes.join(' ')}` } : null;
}
