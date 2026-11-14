/**
 * hooks/mods/spec-guard.js: safety:spec-guard, the mechanical half of the
 * spec's Contract rule (docs/project-state.md § Specs). Blocks the flip to
 * status:specced while the issue's `## Spec` is written but carries no
 * `### Contract` (the `None needed: small item.` spec passes); the gh shim's
 * gate runs it, and it fails open, out loud (workflow/identity/gate.js,
 * docs/hooks.md § safety:spec-guard).
 */

import { denyAfter, ghSkipped, issueView } from './gh.js';
import { parseJson } from './settings.js';

/**
 * Does the body's `## Spec` hold a `### Contract` heading, or say only the
 * small-item line? No Spec section at all is not ok, and a `## ` line inside a
 * code fence is never the next section. The rule's three homes change
 * together: this, and specOk in tower/api/server/validate.js and the
 * dashboard's libs/tower/github/writes.js.
 * @param {string} body the issue body
 * @returns {boolean}
 */
export const specOk = (body) => {
  let fence = false;
  let section = null;
  for (const line of String(body).replace(/\r/g, '').split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    if (line.startsWith('## ') && !fence) {
      if (section) break;
      if (/^## Spec\s*$/.test(line)) {
        section = [];
        continue;
      }
    }
    if (section) section.push(line);
  }
  if (!section) return false;
  if (section.some((line) => /^### Contract\s*$/.test(line))) return true;
  const said = section.map((line) => line.trim()).filter(Boolean);
  return said.length === 1 && said[0] === 'None needed: small item.';
};

const skipped = ghSkipped('spec-guard', 'spec gate');

// The body gh's `--json body` view carries, null when the view does not parse.
function bodyOf(view) {
  const issue = parseJson(view);
  if (issue === null) return null;
  const body = issue.body;
  return body === undefined || body === null || body === false ? '' : String(body);
}

/**
 * spec-guard's verdict on one gh call's steps: a block for a flip to
 * status:specced whose issue has a Spec with no Contract, or a flip that also
 * edits the body; one notice line per issue it could not read; else null. A
 * block carries the notices before it.
 * @param {{steps: Array<{sub: string, number: string, add: string[], remove: string[], body?: boolean}>, cwd: string, repo: string, facts: {issueView: function}}} call
 *   one step per issue (`body` when the same call edits the body), the call's
 *   folder, the repo it acts on ('' for the folder's), and `issueView(n, repo)`
 *   async, gh's `--json body` view of the issue, null when gh failed
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function specVerdict({ steps, repo, facts }) {
  const notes = [];
  const deny = denyAfter(notes);
  for (const { sub, number: n, add, body } of steps) {
    if (sub !== 'edit' || !add.includes('status:specced')) continue;
    if (body) {
      return deny(`spec-guard: BLOCKED this flip: #${n} edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip.`);
    }
    const view = await facts.issueView(n, repo);
    if (view === null) {
      notes.push(skipped(n, 'gh could not answer'));
      continue;
    }
    const text = bodyOf(view);
    if (text === null) notes.push(skipped(n, 'the body did not parse'));
    else if (!specOk(text)) {
      return deny(`spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`);
    }
  }
  return notes.length > 0 ? { context: notes.join('\n') } : null;
}

/**
 * The facts specVerdict reads, over the call's: gh asked from the call's folder.
 * @param {{cwd: string, run: function}} facts the call's facts (facts.js bashFacts)
 * @returns {{issueView: function}}
 */
export const specFacts = ({ cwd, run }) => ({
  issueView: (n, repo) => issueView(run, n, 'body', { repo, cwd }),
});
