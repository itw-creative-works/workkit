/**
 * hooks/mods/proof.js: the issue view's two answers (the proof and the stage),
 * the building list's read, and the `Proof:` line pattern. Plain functions
 * over gh's JSON text; the gh calls are gh.js's.
 */

import { parseJson } from './settings.js';

/**
 * The line that proves an item was built: any LINE opening with `Proof:`,
 * leading whitespace tolerated and nothing else. Its homes change together:
 * this, workflow/ship/ship-items.sh, and PROOF_LINE in tower/api/server/validate.js
 * and libs/tower/github/writes.js (docs/hooks.md § safety:proof-guard).
 */
export const PROOF_RE = /(^|\n)[ \t]*Proof:/;

const listOf = (value) => (Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []);

/**
 * Whether gh's `--json comments` view carries a comment line opening `Proof:`.
 * @param {string} view gh's answer
 * @returns {boolean|null} null when the view cannot be read
 */
export function viewHasProof(view) {
  const issue = parseJson(view);
  if (!issue || typeof issue !== 'object') return null;
  const bodies = listOf(issue.comments).map((comment) => comment?.body ?? '');
  if (bodies.some((body) => typeof body !== 'string')) return null;
  return bodies.some((body) => PROOF_RE.test(body));
}

/**
 * The stage of gh's view read with `url`, `state` and `labels`: `pull` for a
 * pull request, which gh answers by number too but is no work item; `closed`
 * for anything not OPEN; else its status: label, else `none`.
 * @param {string} view gh's answer
 * @returns {string|null} null when the view cannot be read
 */
export function viewStage(view) {
  const issue = parseJson(view);
  if (!issue || typeof issue !== 'object') return null;
  if (/\/pull\/[0-9]+$/.test(String(issue.url ?? ''))) return 'pull';
  if (issue.state !== 'OPEN') return 'closed';
  const label = listOf(issue.labels).map((l) => l?.name ?? '').find((name) => String(name).startsWith('status:'));
  return label ?? 'none';
}

/**
 * The open issues at status:building, from gh's `issue list --json
 * number,labels` answer. Never agent:claimed: an agent:ok item keeps that
 * claim through the park, so it would hold the ship's own run.
 * @param {string} list gh's answer
 * @returns {number[]|null} null when the list cannot be read
 */
export function issuesBuilding(list) {
  const issues = parseJson(list);
  if (!Array.isArray(issues)) return null;
  return issues
    .filter((issue) => listOf(issue?.labels).some((l) => l?.name === 'status:building'))
    .map((issue) => issue.number);
}
