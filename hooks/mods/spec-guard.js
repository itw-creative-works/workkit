/**
 * hooks/mods/spec-guard.js: safety:spec-guard, the mechanical half of the
 * spec's Contract rule (docs/project-state.md § Specs). Blocks the flip to
 * status:specced while the issue's `## Spec` is written but carries no
 * `### Contract` (the `None needed: small item.` spec passes). A flip behind a
 * cd bounces; it fails open, out loud (docs/hooks.md § safety:spec-guard).
 */

import { issueView } from './gh.js';
import { denyAfter, ghBlocksCd, ghFlagValues, ghIssueNumbers, ghNames, ghRepo, ghSkipped, ghSteps, hasLabel } from './gh-edit.js';
import { parseJson } from './settings.js';

const BODY_EDIT = /(^|[ \t\r\f\v])(--body(-file)?([= \t\r\f\v]|$)|-[bF])/m;

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
 * spec-guard's verdict on a Bash command: a block for a flip to
 * status:specced whose issue has a Spec with no Contract, a flip that also
 * edits the body, or one behind a cd; one notice line per issue it could not
 * read; else null. A block carries the notices before it.
 * @param {{command: string, cwd: string, issueView: function}} facts the
 *   command, its folder, and `issueView(n, repo)` async, gh's `--json body`
 *   view of the issue (repo '' for the session's), null when gh failed
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export async function specGuardVerdict({ command, issueView }) {
  if (!command || !ghNames(command, 'edit') || !command.includes('status:specced')) return null;
  const notes = [];
  const deny = denyAfter(notes);
  for (const { clause, detect, sawCd } of ghSteps(command)) {
    if (!ghNames(detect, 'edit')) continue;
    if (!hasLabel(ghFlagValues(clause, '--add-label'), 'status:specced')) continue;
    const issues = ghIssueNumbers(detect, 'edit');
    if (issues.length === 0) continue;
    if (sawCd) return deny(ghBlocksCd('spec-guard'));
    if (BODY_EDIT.test(detect)) {
      return deny(`spec-guard: BLOCKED this flip: #${issues[0]} edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip.`);
    }
    const repo = ghRepo(clause);
    for (const n of issues) {
      if (repo === null) {
        notes.push(skipped(n, 'the --repo value could not be read'));
        continue;
      }
      const view = await issueView(n, repo);
      if (view === null) {
        notes.push(skipped(n, 'gh could not answer'));
        continue;
      }
      const body = bodyOf(view);
      if (body === null) notes.push(skipped(n, 'the body did not parse'));
      else if (!specOk(body)) {
        return deny(`spec-guard: BLOCKED this flip: #${n} has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip.`);
      }
    }
  }
  return notes.length > 0 ? { context: notes.join('\n') } : null;
}

/**
 * The guard's run over the Bash facts: gh is asked only for a flip it gates,
 * from the command's folder.
 * @param {{command: string, cwd: string, run: function}} facts the chain's facts
 * @returns {Promise<{deny: string}|{context: string}|null>}
 */
export function specGuardGuard(facts) {
  return specGuardVerdict({
    command: facts.command,
    cwd: facts.cwd,
    issueView: (n, repo) => issueView(facts.run, n, 'body', { repo, cwd: facts.cwd }),
  });
}
