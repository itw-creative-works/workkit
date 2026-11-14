// Suite discovery for the kit's runner (test/run.js), `workkit tools`
// (test/tools.js) and `workkit convert` (test/convert.js), so which files
// count as a suite has one home: the suites by name under the start folder,
// and the mod half's `test/mods/*.test.ts`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './spawn.js';

// How many suites the runner runs at once: a core left for everything else.
export const POOL = Math.max(1, os.availableParallelism() - 1);

// A suite's file name.
const SUITE_NAME = /\.test\.[cm]?js$/;

// What git says, under LC_ALL=C, when the folder is in no work tree.
const NO_WORK_TREE = /^fatal: (not a git repository|this operation must be run in a work tree)/m;

// One git call in <root> under LC_ALL=C; null with no git on the PATH.
const gitIn = (root, verb, args) => {
  let res;
  try {
    res = run('git', [verb, ...args], { cwd: root, env: { ...process.env, LC_ALL: 'C' } });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (res.timedOut) throw new Error(`findSuites: git ${verb} timed out in ${root}`);
  return res;
};

// A git call's failure, which stops the run.
const gitFailed = (root, verb, res) => new Error(`findSuites: git ${verb} failed in ${root}: ${res.stderr.trim() || `exit ${res.status}`}`);

// What git ignores under <root>: paths from <root> with `/` between parts, a
// wholly ignored folder ending in `/` (`./` when <root> is in one, asked first,
// since the listing fails below an ignored folder's top). None outside a work
// tree, or with no git on the PATH.
const ignoredUnder = (root) => {
  const asked = gitIn(root, 'check-ignore', ['-q', '.']);
  if (asked === null) return new Set();
  if (asked.status === 0) return new Set(['./']);
  if (asked.status !== 1) {
    if (NO_WORK_TREE.test(asked.stderr)) return new Set();
    throw gitFailed(root, 'check-ignore', asked);
  }
  const listed = gitIn(root, 'ls-files', ['--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  if (listed.status !== 0) throw gitFailed(root, 'ls-files', listed);
  return new Set(listed.stdout.split('\0').filter(Boolean));
};

/**
 * The mod half's folder under the start folder, `test/mods`.
 * @param {string} root the folder the runner starts in
 * @returns {string}
 */
export const modDir = (root) => path.join(root, 'test', 'mods');

/**
 * A suite's printed name: its path from <root> with `/` between parts, on
 * every platform.
 * @param {string} root the folder the runner starts in
 * @param {string} file the suite's absolute path
 * @param {object} [paths] the `node:path` flavor to read both with (`path.win32` for Windows)
 * @returns {string}
 */
export const suiteName = (root, file, paths = path) => paths.relative(root, file).split(paths.sep).join('/');

/**
 * Every suite under <root>: a `*.test.js`, `*.test.mjs` or `*.test.cjs` file
 * in any folder, never in `node_modules`, a file or folder whose name starts
 * with `.` or `_`, a folder below <root> holding its own package.json (a nested
 * package, which runs its own suites), or a file git ignores.
 * @param {string} root the folder the runner starts in
 * @returns {string[]} absolute paths, sorted
 */
export const findSuites = (root) => {
  const ignored = ignoredUnder(root);
  if (ignored.has('./')) return [];
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const { name } = entry;
      if (name === 'node_modules' || name.startsWith('.') || name.startsWith('_')) continue;
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        if (!ignored.has(`${relPath}/`) && !fs.existsSync(path.join(full, 'package.json'))) walk(full, relPath);
      } else if (SUITE_NAME.test(name) && !ignored.has(relPath)) {
        out.push(full);
      }
    }
  };
  walk(root, '');
  return out.sort();
};

// The mod half's wiring suites: every `*.test.ts` and `*.test.tsx` in the
// test/mods/ folder, which `claude plugin test` runs; none when there is no folder.
export const findModSuites = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
};
