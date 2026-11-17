// A monorepo root's members for the runner (test/run.js): the folders its
// package.json's `workspaces` lists, read by the publish plan's own expansion,
// and one member's `npm test`, judged by the lines the kit's runner writes to
// the summary and no-match files it is handed. The door does not re-export it.

import fs from 'node:fs';
import path from 'node:path';
import { suiteName } from './suites.js';
import { mkTmp } from './scratch.js';
import { kitModule } from './kit-module.js';

const IS_WINDOWS = process.platform === 'win32';

const { expandWorkspaces, PlanError } = kitModule('expand-workspaces');

// The row and failure text of a member whose run wrote no summary line.
const NOT_ON_RUNNER = 'its test script did not run workkit\'s runner';
// The row text of a member whose run under a filter matched no case.
const NO_CASE = 'no case matches';

export { PlanError };

// A package.json's content; one that does not parse ends the run by its path.
const readJson = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new PlanError(`${file} does not parse as JSON, so no member was started.`);
  }
};

/**
 * The members of <root>, in sorted folder order; none with no `workspaces`.
 * @param {string} root the folder the runner starts in
 * @returns {Array<{dir: string, rel: string, name: string, tested: boolean}>}
 *   every member, its absolute folder, its folder from <root>, its package
 *   name (else that folder) and whether it has a `test` script
 * @throws {PlanError} a `workspaces` pattern the expansion refuses, its line the
 *   plan's, or a package.json that does not parse
 */
export const membersOf = (root) => {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return [];
  return expandWorkspaces(root, readJson(file).workspaces, [])
    .map((listed) => {
      // Resolved: the absolute folder the member's own run starts in.
      const dir = path.resolve(listed);
      const pkg = readJson(path.join(dir, 'package.json'));
      const rel = suiteName(root, dir);
      return { dir, rel, name: pkg.name || rel, tested: typeof pkg.scripts?.test === 'string' };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : Number(a.rel > b.rel)));
};

// The counts the summary file holds, every line summed; null with no line.
const countsIn = (file) => {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  if (lines.length === 0) return null;
  return lines.map((line) => JSON.parse(line))
    .reduce((sum, each) => ({ passed: sum.passed + each.passed, failed: sum.failed + each.failed }), { passed: 0, failed: 0 });
};

/**
 * One member's `npm test` in its own folder, its output on the runner's own,
 * handed a summary file of its own (`WORKKIT_TEST_SUMMARY`). Under a filter
 * the text goes after `--` as `--filter=<text>`, one argument, and the member
 * is handed a no-match file too (`WORKKIT_TEST_NO_MATCH`). Off Windows it
 * leads its own process group, its pid in <live> while it runs.
 * @param {{dir: string}} member
 * @param {string|null} filter the run's filter text, null without the flag
 * @param {{spawn: Function, live: Set<number>}} seams the kit's program starter and the runner's live pids
 * @returns {Promise<{code: number|null, signal: string|null, error?: string, counts: {passed: number, failed: number}|null, noMatch: boolean}>}
 */
export const runMember = (member, filter, { spawn, live }) => new Promise((resolve) => {
  const scratch = mkTmp('workkit-member-');
  const summary = path.join(scratch, 'summary');
  const noMatch = path.join(scratch, 'no-match');
  const options = {
    cwd: member.dir,
    env: { ...process.env, WORKKIT_TEST_SUMMARY: summary, ...(filter === null ? {} : { WORKKIT_TEST_NO_MATCH: noMatch }) },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: !IS_WINDOWS,
  };
  const child = spawn('npm', ['test', ...(filter === null ? [] : ['--', `--filter=${filter}`])], options);
  if (child.pid !== undefined) live.add(child.pid);
  let settled = false;
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    live.delete(child.pid);
    // A run that counted a pass or a failure matched, whatever another run of the script wrote.
    const counts = countsIn(summary);
    const unmatched = fs.existsSync(noMatch) && (counts === null || counts.passed + counts.failed === 0);
    resolve({ ...outcome, counts, noMatch: unmatched });
  };
  child.on('error', (err) => settle({ code: null, signal: null, error: err.message }));
  child.on('close', (code, signal) => settle({ code, signal }));
});

/**
 * What one member's run adds to the root run: its row, its counts, and its
 * failure for the list. A run that wrote the no-match line and counted no pass
 * or failure is a `⊘` row with no count and no failure, whatever its exit. A
 * run that wrote no summary line did not run the kit's runner, so it fails by
 * name whatever its exit; an exit other than 0 with no failed case counts one
 * failure.
 * @param {string} name the member's name
 * @param {{code: number|null, signal: string|null, error?: string, counts: object|null, noMatch: boolean}} end
 * @returns {{row: string, passed: number, failed: number, failure: {name: string, message: string}|null}}
 */
export const memberOutcome = (name, { code, signal, error, counts, noMatch }) => {
  if (error !== undefined) {
    const message = `npm did not start: ${error}`;
    return { row: `✗ ${name}: ${message}`, passed: 0, failed: 1, failure: { name, message } };
  }
  if (noMatch) return { row: `⊘ ${name}: ${NO_CASE}`, passed: 0, failed: 0, failure: null };
  const exit = signal ? `killed by ${signal}` : `exit ${code}`;
  if (counts === null) {
    const message = code === 0 ? NOT_ON_RUNNER : `${NOT_ON_RUNNER} (${exit})`;
    return { row: `✗ ${name}: ${message}`, passed: 0, failed: 1, failure: { name, message } };
  }
  if (code === 0 && counts.failed === 0) return { row: `✓ ${name}`, ...counts, failure: null };
  return {
    row: `✗ ${name} (${exit})`,
    passed: counts.passed,
    failed: Math.max(counts.failed, 1),
    failure: { name, message: `npm test ended with ${exit}, ${counts.failed} failed` },
  };
};
