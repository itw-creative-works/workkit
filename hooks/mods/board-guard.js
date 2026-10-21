/**
 * hooks/mods/board-guard.js: docs:board-guard's verdict on an AGENTS.md write,
 * and the budget measurement docs:state-check announces from too
 * (docs/hooks.md § docs:board-guard).
 */

import { rowsOf } from './session-guard.js';

export const AGENTS_MAX_LINES = 250;
export const AGENTS_MAX_BYTES = 400;

const encoder = new TextEncoder();
// Either separator: a Windows path's backslashes read as slashes.
const baseName = (path) => String(path ?? '').split(/[\\/]/).pop();

/**
 * An AGENTS.md text against its budget, counted as awk counts records and in
 * BYTES, so one rule judges every platform alike.
 * @param {string} text the file's text
 * @returns {{lines: number, dense: number, named: string}} the line count, the
 *   lines over AGENTS_MAX_BYTES, and the first three as `line N (M bytes)`
 */
export function agentsBudget(text) {
  const rows = rowsOf(text);
  const offenders = [];
  rows.forEach((row, i) => {
    const bytes = encoder.encode(row).length;
    if (bytes > AGENTS_MAX_BYTES) offenders.push(`line ${i + 1} (${bytes} bytes)`);
  });
  const more = offenders.length > 3 ? `, and ${offenders.length - 3} more` : '';
  return { lines: rows.length, dense: offenders.length, named: `${offenders.slice(0, 3).join(', ')}${more}` };
}

/**
 * The bounce for a write that leaves AGENTS.md past its budget, or null.
 * @param {string} path the written file's path
 * @param {string|null|undefined} text the file's text, null when it is gone
 * @param {string} [spec] the spec the bounce names
 * @returns {string|null}
 */
export function boardGuardVerdict(path, text, spec = 'docs/project-state.md') {
  if (baseName(path) !== 'AGENTS.md' || typeof text !== 'string') return null;
  const { lines, dense, named } = agentsBudget(text);
  const violations = [];
  if (lines > AGENTS_MAX_LINES) {
    violations.push(`AGENTS BUDGET: ${lines} lines (max ${AGENTS_MAX_LINES}). AGENTS.md is the architectural overview; deep references move to docs/<topic>.md and AGENTS.md keeps a pointer line.`);
  }
  if (dense > 0) {
    violations.push(`AGENTS DENSITY: ${named}. No line may exceed ${AGENTS_MAX_BYTES} bytes. A markdown paragraph is one source line, so AGENTS.md passes the ${AGENTS_MAX_LINES}-line budget while carrying a book. Bulletize those lines, or move the detail to docs/<topic>.md and keep a pointer here.`);
  }
  if (violations.length === 0) return null;
  const list = violations.map((line) => `  - ${line}`).join('\n');
  return `board-guard: AGENTS.md violates the document rules of the project-state spec v4 (spec: ${spec}). Fix these NOW, before any other work:\n${list}`;
}
