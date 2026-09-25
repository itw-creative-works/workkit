//
// Suite discovery for the Node runner (tests/run.js) and the runner's own
// suite (tests/runner.test.js), so which files count as a suite has one home.
//

const fs = require('fs');
const path = require('path');

// Recursively collect *.test.js files (skipping lib/ and node_modules).
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

module.exports = { findSuites };
