/**
 * hooks/mods/public-mirror.js: workflow:public-mirror. After a `gh issue edit`
 * that adds a status label in a repo paired with a public one (the `public`
 * setting, its merged settings' key), read off the gh journal lines the Bash
 * call wrote, it runs the engine's `public/mirror.js` for the issues that
 * edit named, so the public issue carries the same status. A failed mirror is
 * a notice, never a block (docs/hooks.md § workflow:public-mirror).
 */

import { onIssue } from './markers.js';
import { placeLine, repoSlug, rosterOf } from './optin.js';
import { rootSettings } from './settings.js';
import { LONG_RUN_MS } from './suite.js';

// A journal line whose edit adds a status label to the issues it names.
const addsStatus = (line) => onIssue(line) && line.sub === 'edit' && line.numbers.length > 0
  && line.add.some((label) => label.startsWith('status:'));

/**
 * What a Bash call's gh writes ask of the mirror: one step per journal line
 * whose edit adds a status label, the folder the call ran in, the repo it
 * acted on and the issues it named. Which repo's folder that is, and whether
 * it is paired, the guard reads.
 * @param {{lines: object[], cwd: string}} facts the journal lines the call wrote (journalLines
 *   in markers.js) and the session's folder, a line's own folder before it
 * @returns {Array<{dir: string, repo: string, issues: string[]}>}
 */
export function publicMirrorPlan({ lines, cwd }) {
  return lines.filter(addsStatus).map((line) => ({ dir: line.cwd || cwd, repo: line.repo, issues: line.numbers }));
}

// The root of the repo a step acted on (its folder, or the repo's roster
// folder), when that repo's settings pair it with a public one; else null.
async function pairedRoot(step, facts, roster) {
  const placed = await placeLine(step, { roster, slugOf: (dir) => repoSlug(dir, facts.run) });
  const root = placed.dir ? await facts.top(placed.dir) : null;
  if (!root) return null;
  const repo = (await rootSettings(root, facts.env, facts)).public;
  return typeof repo === 'string' ? root : null;
}

/**
 * The hook's run over the Bash facts after the command ran: the plan, then
 * `node <engine>/public/mirror.js <N>...` from the root of each step's paired
 * repo. A repo off the roster or not paired is no mirror; a mirror that fails
 * is one notice.
 * @param {object} facts the chain's facts (guards.js), `lines` among them
 * @returns {Promise<{context: string}|null>}
 */
export async function publicMirrorGuard(facts) {
  const steps = publicMirrorPlan({ lines: facts.lines, cwd: facts.cwd });
  if (steps.length === 0) return null;
  const roster = await rosterOf(facts.env, facts.read);
  const mirror = `${facts.env.WORKFLOW_DIR || `${facts.pluginRoot}/workflow`}/public/mirror.js`;
  const notes = [];
  for (const step of steps) {
    const root = await pairedRoot(step, facts, roster);
    if (!root) continue;
    const ran = await facts.run(['node', mirror, ...step.issues], { cwd: root, timeoutMs: LONG_RUN_MS });
    const said = `${ran.stderr ?? ''}`.trim();
    if (ran.exitCode !== 0 || said) notes.push(said || `the mirror of ${step.issues.map((n) => `#${n}`).join(' ')} in ${root} exited ${ran.exitCode}.`);
  }
  return notes.length > 0 ? { context: `workflow:public-mirror: ${notes.join(' ')}` } : null;
}
