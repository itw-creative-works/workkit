/**
 * hooks/mods/state-check.js: docs:state-check's announcement of the upkeep a
 * repo owes at session start: open status:inbox issues, a non-empty capture
 * file, a repo CLAUDE.md, an AGENTS.md past its budget
 * (docs/hooks.md § docs:state-check).
 */

import { AGENTS_MAX_BYTES, AGENTS_MAX_LINES, agentsBudget } from './board-guard.js';
import { rowsOf } from './session-guard.js';

const plural = (n) => (n === 1 ? '' : 's');

/**
 * The open inbox count `gh issue list --json number` printed; 0 for anything
 * that is not a list.
 * @param {string} stdout what gh printed
 * @returns {number}
 */
export function inboxCount(stdout) {
  try {
    const issues = JSON.parse(stdout);
    return Array.isArray(issues) ? issues.length : 0;
  } catch {
    return 0;
  }
}

/**
 * The announcement, or null when all is current.
 * @param {object} facts what the session start found in its directory
 * @param {string} facts.cwd the session's directory
 * @param {number} [facts.inbox] open status:inbox issues
 * @param {string|null} [facts.capture] `.workkit/capture.md`'s text
 * @param {string|null} [facts.claude] a repo CLAUDE.md's text
 * @param {string|null} [facts.agents] AGENTS.md's text
 * @param {boolean} [facts.isUserClaude] the directory is the user's own ~/.claude
 * @returns {string|null}
 */
export function stateCheckContext(facts) {
  const { cwd, inbox = 0, capture = null, claude = null, agents = null, isUserClaude = false } = facts;
  if (!cwd) return null;
  const msg = [];
  if (inbox > 0) {
    msg.push(`ISSUES: ${inbox} open status:inbox issue${plural(inbox)}. Run triage (workkit:triage) to route them.`);
  }
  if (typeof capture === 'string' && rowsOf(capture).some((row) => !/^\s*$|^#|^>/.test(row))) {
    msg.push(`SCRATCH: the local capture file has entries (${cwd}/.workkit/capture.md): triage drains it.`);
  }
  // Claude Code reads AGENTS.md itself, and a project CLAUDE.md stops that read.
  if (typeof claude === 'string' && !isUserClaude) {
    if (rowsOf(claude).every((row) => /^\s*$|^\s*@AGENTS\.md\s*$/.test(row))) {
      msg.push('CLAUDE.md is only the @AGENTS.md pointer, and Claude Code reads AGENTS.md itself. Delete it: git rm CLAUDE.md.');
    } else if (typeof agents !== 'string') {
      msg.push('CLAUDE.md holds content and no AGENTS.md sits beside it; a project CLAUDE.md stops Claude Code reading AGENTS.md. Rename it: git mv CLAUDE.md AGENTS.md (the rename keeps its history).');
    } else {
      msg.push('CLAUDE.md holds content beside an AGENTS.md; a project CLAUDE.md stops Claude Code reading AGENTS.md. Merge it into AGENTS.md by hand, then git rm CLAUDE.md.');
    }
  }
  if (typeof agents === 'string') {
    const { lines, dense } = agentsBudget(agents);
    if (lines > AGENTS_MAX_LINES) {
      msg.push(`AGENTS.md is ${lines} lines (budget ${AGENTS_MAX_LINES}). Move deep references to docs/<topic>.md and keep pointer lines; the board-guard hook bounces writes until it fits.`);
    }
    if (dense > 0) {
      msg.push(`AGENTS.md has ${dense} line${plural(dense)} over ${AGENTS_MAX_BYTES} bytes (density rule). Bulletize them or move the detail to docs/<topic>.md; the board-guard hook bounces writes until it fits.`);
    }
  }
  return msg.length > 0 ? msg.join(' ') : null;
}
