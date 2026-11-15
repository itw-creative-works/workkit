// A monorepo root's members for the runner (test/run.js): the folders its
// package.json's `workspaces` lists, read by the publish plan's own expansion,
// and one member's `npm test`, judged by the line the kit's runner writes to
// the summary file it is handed. The door does not re-export it.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { suiteName } from './suites.js';
import { mkTmp } from './scratch.js';

const require = createRequire(import.meta.url);
const IS_WINDOWS = process.platform === 'win32';

// The expansion: in the kit's own checkout the kit's file, so a copy a local
// `npm pack` left beside it never wins; elsewhere the packed copy at the
// package's root.
const PACKAGE_ROOT = path.join(import.meta.dirname, '..', '..');
const PACKED = path.join(PACKAGE_ROOT, 'expand-workspaces.cjs');
const IN_KIT = path.join(PACKAGE_ROOT, '..', '..', 'workflow', 'lib', 'expand-workspaces.js');
const { expandWorkspaces, PlanError } = require(fs.existsSync(IN_KIT) ? IN_KIT : PACKED);

// The row and failure text of a member whose run wrote no summary line.
const NOT_ON_RUNNER = 'its test script did not run workkit\'s runner';

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
      // Resolved, so `packages/a/` and a skip entry `packages/a` name one folder.
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
 * handed a summary file of its own (`WORKKIT_TEST_SUMMARY`). Off Windows it
 * leads its own process group, its pid in <live> while it runs.
 * @param {{dir: string}} member
 * @param {{spawn: Function, live: Set<number>}} seams the program starter and the runner's live pids
 * @returns {Promise<{code: number|null, signal: string|null, error?: string, counts: {passed: number, failed: number}|null}>}
 */
export const runMember = (member, { spawn, live }) => new Promise((resolve) => {
  const summary = path.join(mkTmp('workkit-member-'), 'summary');
  const options = {
    cwd: member.dir,
    env: { ...process.env, WORKKIT_TEST_SUMMARY: summary },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: !IS_WINDOWS,
  };
  // npm is npm.cmd on Windows, which starts only through the shell.
  const child = IS_WINDOWS ? spawn('npm test', { ...options, shell: true }) : spawn('npm', ['test'], options);
  if (child.pid !== undefined) live.add(child.pid);
  let settled = false;
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    live.delete(child.pid);
    resolve({ ...outcome, counts: countsIn(summary) });
  };
  child.on('error', (err) => settle({ code: null, signal: null, error: err.message }));
  child.on('close', (code, signal) => settle({ code, signal }));
});

/**
 * What one member's run adds to the root run: its row, its counts, and its
 * failure for the list. A run that wrote no summary line did not run the
 * kit's runner, so it fails by name whatever its exit; an exit other than 0
 * with no failed case counts one failure.
 * @param {string} name the member's name
 * @param {{code: number|null, signal: string|null, error?: string, counts: object|null}} end
 * @returns {{row: string, passed: number, failed: number, failure: {name: string, message: string}|null}}
 */
export const memberOutcome = (name, { code, signal, error, counts }) => {
  if (error !== undefined) {
    const message = `npm did not start: ${error}`;
    return { row: `✗ ${name}: ${message}`, passed: 0, failed: 1, failure: { name, message } };
  }
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
