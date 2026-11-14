// Tests for standards.sh: its guards (a non-git directory is skipped).
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { cleanup, runScript } = require('./helpers');

describe('standards.sh: guards', () => {
  test('a non-git directory is skipped cleanly', () => {
    const dir = mkTmp('wf-std-');
    const { code, output: stdout } = runScript(dir);
    expect(code, 'exit 0').toBe(0);
    expect(stdout.includes('not a git repo'), `says why, got: ${stdout}`).toBeTruthy();
    expect(!fs.existsSync(path.join(dir, '.github')), 'creates nothing').toBeTruthy();
    cleanup(dir);
  });
});
