// Tests for standards.sh: its guards (a non-git directory is skipped).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun, mkTmp } = require('../../lib/harness');
const { cleanup, runScript } = require('./helpers');

const cases = async () => {
  group('standards.sh: guards');

  await test('a non-git directory is skipped cleanly', () => {
    const dir = mkTmp('wf-std-');
    const { code, output: stdout } = runScript(dir);
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('not a git repo'), `says why, got: ${stdout}`);
    assert(!fs.existsSync(path.join(dir, '.github')), 'creates nothing');
    cleanup(dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
