// Tests for standards.sh: a repo carries no standard version, so the heal
// removes a `version` key it finds in .workkit/settings.json and writes nothing
// where there is none. The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assertEq, summary, selfRun, WORKKIT_DIR: W, SPAWN_DEADLINE,
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

const cases = async () => {
  group('standards.sh: the version key is removed, never stamped');

  await test('a settings file with version and enabled: the heal leaves enabled and every other key, without version', () => {
    const dir = makeRepo({ settings: '{ "version": 9, "enabled": true, "tests": { "budget": 5 } }\n' });
    const stub = makeGhStub();
    runScript(dir, { pathPrefix: stub.binDir });
    const parsed = JSON.parse(readFile(settingsOf(dir)));
    assertEq(JSON.stringify(parsed), JSON.stringify({ enabled: true, tests: { budget: 5 } }), 'the key is gone, the rest kept');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a settings file with no version key is not written: its bytes and its mtime stand', () => {
    const dir = makeRepo({ settings: '{ "enabled":   true }\n' });
    const stub = makeGhStub();
    const mtime = backdate(settingsOf(dir));
    runScript(dir, { pathPrefix: stub.binDir });
    assertEq(readFile(settingsOf(dir)), '{ "enabled":   true }\n', 'the text is as it was');
    assertEq(fs.statSync(settingsOf(dir)).mtimeMs, mtime, 'and the file was never rewritten');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('no jq on PATH: one warning line naming the key and the file, and no write', () => {
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
    assertEq(said.length, 1, `one line names the key and the file, got: ${res.stdout}${res.stderr}`);
    assertEq(readFile(settingsOf(dir)), text, 'the file keeps its key');
    assertEq(fs.statSync(settingsOf(dir)).mtimeMs, mtime, 'and was never rewritten');
    cleanup(dir); cleanup(binDir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
