// The suites the kit's runner (packages/core/test/run.js) holds back for its serial tail, run one
// at a time after the parallel wave: each touches a fixed shared path, named
// beside its entry. Paths are from the repo root. AGENTS.md § Tests.

const SERIAL = [
  'test/scripts/workflow-standards/engine-address.test.js', // checks for and removes the kit's live workflow/workflow link
  'test/scripts/workflow-standards/roster.test.js', // checks for and removes the kit's live workflow/workflow link
  'test/tower/start/filter.test.js', // reclaims the fixed ports 18693 and 14300 through the machine's process table
  'test/tower/start/terminal.test.js', // reclaims the fixed ports 18693 and 14300 through the machine's process table
];

module.exports = { SERIAL };
