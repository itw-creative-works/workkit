/**
 * hooks/mods/public-mirror.js: workflow:public-mirror. After a `gh issue edit`
 * that adds a status label in a repo paired with a public one (the `public`
 * key of its .workkit/settings.json), it runs the engine's
 * `public/mirror.js` for the issues that command named, so the public issue
 * carries the same status. A failed mirror is a notice, never a block
 * (docs/hooks.md § workflow:public-mirror).
 */

import { repoSlug } from './command.js';
import { ghClauseSub, ghFlagValues, ghIssueNumbers, ghNames, ghSteps, labelValues } from './gh-edit.js';
import { place, rosterOf } from './optin.js';
import { parseJson, settingGet } from './settings.js';
import { LONG_RUN_MS } from './suite.js';

// Whether the clause's --add-label values name any status label.
const addsStatus = (clause) => labelValues(ghFlagValues(clause, '--add-label')).some((v) => v.startsWith('status:'));

// Whether any `gh issue edit` clause of the command adds a status label.
function mirrorTriggers(command) {
  if (!command || !ghNames(command, 'edit') || !command.includes('status:')) return false;
  return [...ghSteps(command)].some(({ clause, detect }) => ghClauseSub(detect) === 'edit' && addsStatus(clause));
}

/**
 * What a Bash command asks of the mirror: one step per `gh issue edit` clause
 * adding a status label in a paired repo, its folder and the issues named. A
 * clause it cannot place (a --repo it cannot read, a repo off the roster, a
 * cd before a clause naming no repo) and an unpaired repo are no step.
 * @param {{command: string, cwd: string, roster: object|null, slugOf: function, publicOf: function}} facts
 *   the command, its folder, the parsed ~/.workkit/.repos.json, `slugOf(dir)` async a folder's
 *   origin slug, `publicOf(dir)` async the `public` key of the repo holding the folder, or null
 * @returns {Promise<Array<{dir: string, issues: string[]}>>}
 */
export async function publicMirrorPlan(facts) {
  const steps = [];
  if (!mirrorTriggers(facts.command)) return steps;
  for (const { clause, detect, sawCd } of ghSteps(facts.command)) {
    if (ghClauseSub(detect) !== 'edit' || !addsStatus(clause)) continue;
    const { dir } = await place(clause, facts, sawCd);
    const issues = ghIssueNumbers(detect, 'edit');
    if (dir && issues.length > 0 && (await facts.publicOf(dir))) steps.push({ dir, issues });
  }
  return steps;
}

/**
 * The hook's run over the Bash facts after the command ran: the plan, then
 * `node <engine>/public/mirror.js <N>...` from each step's repo root. A failed
 * call is skipped, since the edit it made is in doubt and the session-start
 * sweep mirrors it; a mirror that fails is one notice.
 * @param {object} facts the chain's facts (guards.js)
 * @returns {Promise<{context: string}|null>}
 */
export async function publicMirrorGuard(facts) {
  if (facts.failed || !mirrorTriggers(facts.command)) return null;
  const roots = new Map();
  const publicOf = async (dir) => {
    const root = await facts.top(dir);
    const repo = root ? settingGet('public', parseJson(await facts.read(`${root}/.workkit/settings.json`)), null) : undefined;
    if (typeof repo !== 'string') return null;
    roots.set(dir, root);
    return repo;
  };
  const steps = await publicMirrorPlan({
    command: facts.command,
    cwd: facts.cwd,
    roster: await rosterOf(facts.env, facts.read),
    slugOf: (dir) => repoSlug(dir, facts.run),
    publicOf,
  });
  const mirror = `${facts.env.WORKFLOW_DIR || `${facts.pluginRoot}/workflow`}/public/mirror.js`;
  const notes = [];
  for (const { dir, issues } of steps) {
    const root = roots.get(dir);
    const ran = await facts.run(['node', mirror, ...issues], { cwd: root, timeoutMs: LONG_RUN_MS });
    const said = `${ran.stderr ?? ''}`.trim();
    if (ran.exitCode !== 0 || said) notes.push(said || `the mirror of ${issues.map((n) => `#${n}`).join(' ')} in ${root} exited ${ran.exitCode}.`);
  }
  return notes.length > 0 ? { context: `workflow:public-mirror: ${notes.join(' ')}` } : null;
}
