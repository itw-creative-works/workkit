// Suite discovery for the kit's runner (test/run.js), `workkit tools`
// (test/tools.js) and a repo's runner suite (test/runner.test.js), so which
// files count as a suite has one home: the suite folder, the Node suites, and
// the mod half's `test/mods/*.test.ts`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// How many suites the runner runs at once: a core left for everything else.
export const POOL = Math.max(1, os.availableParallelism() - 1);

// The repo's suite folder: `test/`, Node's convention; `tests/` only when the
// repo has that folder and no `test/`.
export const suiteDir = (root) => {
  const isDir = (dir) => fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  const dir = path.join(root, 'test');
  const legacy = path.join(root, 'tests');
  return !isDir(dir) && isDir(legacy) ? legacy : dir;
};

export const findSuites = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSuites(full));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
};

// The mod half's wiring suites: every `*.test.ts` and `*.test.tsx` in the
// test/mods/ folder, which `claude plugin test` runs; none when there is no folder.
export const findModSuites = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
};
