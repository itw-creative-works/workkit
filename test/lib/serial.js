// The suites the kit's runner (packages/core/test/run.js) holds back for its serial tail, run one
// at a time after the parallel wave: each touches a fixed shared path, named
// beside its entry. Paths are relative to test/. AGENTS.md § Tests.

const SERIAL = [
  'scripts/workflow-standards/engine-address.test.js', // checks for and removes the kit's live workflow/workflow link
  'scripts/workflow-standards/roster.test.js', // checks for and removes the kit's live workflow/workflow link
  'tower/start/filter.test.js', // reclaims the fixed ports 18693 and 14300 through the machine's process table
  'tower/start/terminal.test.js', // reclaims the fixed ports 18693 and 14300 through the machine's process table
];

module.exports = { SERIAL };
