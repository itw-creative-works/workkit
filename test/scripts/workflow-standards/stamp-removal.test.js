// Tests for standards.sh: a repo carries no standard version, so the heal
// removes a `version` key it finds in .workkit/settings.json and writes nothing
// where there is none. The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, WORKKIT_DIR: W, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { SYSTEM_BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  SCRIPT, cleanup, makeRepo, makeGhStub, binDirWithout, runScript, readFile,
} = require('./helpers');

const settingsOf = (dir) => path.join(dir, W, 'settings.json');

// The settings file dated an hour back, so a rewrite shows in its mtime.
const backdate = (file) => {
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(file, past, past);
  return fs.statSync(file).mtimeMs;
};

describe('standards.sh: the version key is removed, never stamped', () => {
  test('a settings file with version and enabled: the heal leaves enabled and every other key, without version', () => {
    const dir = makeRepo({ settings: '{ "version": 9, "enabled": true, "tests": { "budget": 5 } }\n' });
    const stub = makeGhStub();
    runScript(dir, { pathPrefix: stub.binDir });
    const parsed = JSON.parse(readFile(settingsOf(dir)));
    expect(JSON.stringify(parsed), 'the key is gone, the rest kept').toBe(JSON.stringify({ enabled: true, tests: { budget: 5 } }));
    cleanup(dir); cleanup(stub.dir);
  });

  test('a settings file with no version key is not written: its bytes and its mtime stand', () => {
    const dir = makeRepo({ settings: '{ "enabled":   true }\n' });
    const stub = makeGhStub();
    const mtime = backdate(settingsOf(dir));
    runScript(dir, { pathPrefix: stub.binDir });
    expect(readFile(settingsOf(dir)), 'the text is as it was').toBe('{ "enabled":   true }\n');
    expect(fs.statSync(settingsOf(dir)).mtimeMs, 'and the file was never rewritten').toBe(mtime);
    cleanup(dir); cleanup(stub.dir);
  });

  test('no jq on PATH: one warning line naming the key and the file, and no write', () => {
    const text = '{ "version": 9, "enabled": true }\n';
    const dir = makeRepo({ settings: text });
    const mtime = backdate(settingsOf(dir));
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(dir)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(binDir, 'ch')) },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    const said = `${res.stdout || ''}${res.stderr || ''}`.split(/\r?\n/).filter((l) => l.includes('version') && l.includes('settings.json'));
    expect(said.length, `one line names the key and the file, got: ${res.stdout}${res.stderr}`).toBe(1);
    expect(readFile(settingsOf(dir)), 'the file keeps its key').toBe(text);
    expect(fs.statSync(settingsOf(dir)).mtimeMs, 'and was never rewritten').toBe(mtime);
    cleanup(dir); cleanup(binDir);
  });
});
