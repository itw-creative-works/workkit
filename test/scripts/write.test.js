// Tests for workflow/lib/write.js: writeWhole's mode for the new file, on real
// files in a scratch folder. Its failed-write cleanup is the records and login
// suites' own cases, through their writers.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { skipWithoutModes } = require('../lib/platform');

const WRITE = path.join(__dirname, '..', '..', 'workflow', 'lib', 'write.js');

describe('lib/write: writeWhole', () => {
  test('a mode given: the file lands at it, even over a temp file a killed write left at a wider mode', { skip: skipWithoutModes('a file mode cannot be read back') }, () => {
    const { writeWhole } = require(WRITE);
    const dir = mkTmp('wk-write-mode-');
    const file = path.join(dir, 'login.json');
    const stale = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(stale, 'stale\n');
    fs.chmodSync(stale, 0o644);
    writeWhole(file, '{}\n', { mode: 0o600 });
    expect((fs.statSync(file).mode & 0o777).toString(8), 'owner read and write only').toBe('600');
  });
});
