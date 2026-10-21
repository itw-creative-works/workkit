// Suite discovery for the Node runner (tests/run.js) and the runner's own
// suite (tests/runner.test.js), so which files count as a suite has one home:
// the Node suites, and the mod half's `hooks/*.test.ts`.

const fs = require('fs');
const path = require('path');

const findSuites = (dir) => {
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
// hooks folder, which `claude plugin test` runs; none when there is no folder.
const findModSuites = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name));
};

module.exports = { findSuites, findModSuites };
