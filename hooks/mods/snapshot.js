/**
 * hooks/mods/snapshot.js: workflow:snapshot. The claim of an issue to
 * status:building takes the repo snapshot `workkit proof red` runs against,
 * or adds its number to the live one (replacing it once stale); a release (a
 * complete flip, or a close) leaving no issue there at status:building or
 * status:qa drops it, each read off the gh journal lines the Bash call wrote. The
 * copy, fill and sweep stay in hooks/lib/snapshot.sh, run
 * through its entry; a notice at most, never a block (docs/hooks.md § workflow:snapshot).
 */

import { stageList } from './gh.js';
import { userDirOf } from './log.js';
import { onIssue, snapshotMarkerPath } from './markers.js';
import { placeLine, repoSlug, rosterOf } from './optin.js';
import { issuesAt } from './proof.js';
import { LONG_RUN_MS } from './suite.js';

// The stages that hold the snapshot: a release leaving an issue at either keeps it.
const HOLDING = ['status:building', 'status:qa'];

// A journal line that claims its issues: an edit adding status:building.
const claims = (line) => onIssue(line) && line.sub === 'edit' && line.add.includes('status:building');

// A journal line that releases: a close, or an edit adding status:complete.
const releases = (line) => onIssue(line)
  && (line.sub === 'close' || (line.sub === 'edit' && line.add.includes('status:complete')));

/**
 * What a Bash call's gh writes ask of the snapshot, one step per journal line
 * that claims or releases, in order: take (the folder, the claimed numbers and
 * the repo), drop (a release GitHub says left nothing building or at qa), or
 * a note for a line naming a repo off the roster. A release that leaves an
 * issue building or at qa is no step.
 * @param {{lines: object[], cwd: string, roster: object|null, slugOf: function, building: function}} facts
 *   the journal lines the call wrote (journalLines in markers.js), the session's folder, the parsed
 *   ~/.workkit/.repos.json, `slugOf(dir)` async a folder's origin slug, `building(dir, repo)` async
 *   gh's status:building list there, its status:qa list when none is building, null when unread
 * @returns {Promise<Array<{take: string, issues: string[], repo: string}|{drop: string, repo: string}|{note: string}>>}
 */
export async function snapshotPlan(facts) {
  const steps = [];
  for (const line of facts.lines) {
    const claim = claims(line);
    if (!claim && !releases(line)) continue;
    const placed = await placeLine({ dir: line.cwd || facts.cwd, repo: line.repo }, facts);
    if (placed.note) steps.push(placed);
    else if (claim) steps.push({ take: placed.dir, issues: line.numbers, repo: placed.repo });
    else {
      const list = await facts.building(placed.dir, placed.repo);
      if (HOLDING.every((stage) => issuesAt(list, stage)?.length === 0)) steps.push({ drop: placed.dir, repo: placed.repo });
    }
  }
  return steps;
}

// gh's list at the first HOLDING stage holding an issue, else the last stage's; null when unread.
async function holdingList(run, init) {
  let list = null;
  for (const stage of HOLDING) {
    list = await stageList(run, stage, init);
    if (issuesAt(list, stage)?.length !== 0) return list;
  }
  return list;
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
 * The hook's run over the Bash facts after the command ran: the plan over the
 * journal lines the call wrote, then each step in order through `bash
 * hooks/lib/snapshot.sh take|add|stale|drop <root>` in the repo it names, the
 * notes joined into one notice. A claim on a live snapshot adds its numbers
 * unless none of the recorded issues is still building, which takes it afresh.
 * @param {object} facts the chain's facts (guards.js), `lines` among them
 * @returns {Promise<{context: string}|null>}
 */
export async function snapshotGuard(facts) {
  if (!facts.lines.some((line) => claims(line) || releases(line))) return null;
  const snapOf = (root) => snapshotMarkerPath(root, userDirOf(facts.env));
  const steps = await snapshotPlan({
    lines: facts.lines,
    cwd: facts.cwd,
    roster: await rosterOf(facts.env, facts.read),
    slugOf: (dir) => repoSlug(dir, facts.run),
    // A release with no snapshot there has nothing to drop, so GitHub is not asked.
    building: async (dir, repo) => {
      const root = await facts.top(dir);
      if (!root || (await facts.list(await snapOf(root))).length === 0) return null;
      return holdingList(facts.run, { repo, cwd: root });
    },
  });
  const notes = [];
  for (const step of steps) {
    const said = step.note ?? (await runStep(step, facts, snapOf));
    if (said) notes.push(said);
  }
  return notes.length > 0 ? { context: `workflow:snapshot: ${notes.join(' ')}` } : null;
}
