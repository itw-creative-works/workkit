//
// Tests that the hook suites sharing a temp-dir helper leave no scratch folder
// behind: each suite runs as a child with a temp dir of its own, which must
// be empty once the child exits.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assertEq, summary, selfRun,
} = require('../lib/harness');

// One suite per helper that makes scratch folders in the temp dir.
const SUITES = ['workflow-standards/healing.test.js', 'commit-gate/parsing.test.js'];

const run = async () => {
  group('scratch cleanup: a suite removes the temp folders its helpers made');

  for (const suite of SUITES) {
    await test(`${suite} leaves nothing in the temp dir`, () => {
      // The child's own temp dir, so a run elsewhere on the machine cannot move
      // the count. TMPDIR is what node reads on POSIX, TEMP and TMP on Windows.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-cleanup-'));
      const res = spawnSync(process.execPath, [path.join(__dirname, suite)], {
        env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
        encoding: 'utf8',
        timeout: 120000,
      });
      const left = fs.readdirSync(tmp);
      fs.rmSync(tmp, { recursive: true, force: true });
      assertEq(res.status, 0, `the suite itself passes, got: ${res.stdout}${res.stderr}`);
      assertEq(left.length, 0, `the temp dir is empty when the suite exits, left: ${left.join(', ')}`);
    });
  }

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
