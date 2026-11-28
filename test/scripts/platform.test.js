// Tests for test/lib/platform.js's own seams that no suite reaches by using
// them: the `.exe` launcher it puts beside a PATH stub on Windows, and samePath.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, stubTool, pathWith, linkTool, which, joinPath, WINDOWS_CSC, samePath,
} = require('../lib/platform');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// The `.exe` launcher test/lib/platform.js puts beside a PATH stub so Node starts it by name.
describe('test/lib/platform.js: the stub launcher', () => {
  const onlyWindows = (!IS_WINDOWS || !fs.existsSync(WINDOWS_CSC)) && 'the launcher needs Windows and its C# compiler';

  test('a stub is started from Node by its bare name, its argv whole and its exit code back', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'gh', ['#!/bin/bash', 'echo "$1|$2"', 'exit 3']);
    const res = spawnSync('gh', ['a "b" c', 'd e'],
      { env: { ...process.env, PATH: pathWith(dir) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the stub's exit code, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(3);
    expect(res.stdout, 'each argument whole, quotes and spaces kept').toBe('a "b" c|d e\n');
    cleanup(dir);
  });

  test('an exe mirrored by linkTool is started from Node by its bare name', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    linkTool(dir, which('git'));
    expect(fs.existsSync(path.join(dir, 'git.exe')), 'the mirror holds the launcher, ahead of the real git on PATH').toBeTruthy();
    const res = spawnSync('git', ['--version'],
      { env: { ...process.env, PATH: joinPath(dir, SYSTEM_PATH) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `git answered, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith('git version'), `git's own answer, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
    cleanup(dir);
  });

  test('two stubs in one process share one launcher build', { skip: onlyWindows }, () => {
    const dir = mkTmp('wf-platform-');
    stubTool(dir, 'one', ['#!/bin/bash', 'exit 0']);
    const first = fs.readFileSync(path.join(dir, 'one.exe'));
    // csc stamps every build with a fresh id, so the byte-equal cache entry is this build;
    // only finished `<digest>.exe` entries are read, never another build's temp file.
    const cacheDir = path.join(os.tmpdir(), 'workkit-stub-launcher');
    const cached = fs.readdirSync(cacheDir).filter((name) => /^[0-9a-f]{12}\.exe$/.test(name))
      .map((name) => path.join(cacheDir, name)).filter((file) => fs.readFileSync(file).equals(first));
    expect(cached.length, `one cached launcher matches the copy, got: ${cached.join(', ')}`).toBe(1);
    const built = fs.statSync(cached[0]).mtimeMs;
    stubTool(dir, 'two', ['#!/bin/bash', 'exit 0']);
    expect(fs.readFileSync(path.join(dir, 'two.exe')).equals(first), 'the second stub got the same launcher').toBeTruthy();
    expect(fs.statSync(cached[0]).mtimeMs, 'csc did not run again: the cached build is untouched').toBe(built);
    cleanup(dir);
  });
});

describe('test/lib/platform.js: samePath', () => {
  test('samePath reads a Windows path in any spelling as one path, and nothing else as one', () => {
    expect(samePath('/d/a/x', 'D:\\a\\X', 'win32'), 'a drive mount, backslashes and case are one path on win32').toBe(true);
    expect(samePath('/d/a/x', '/d/a/y', 'win32'), 'two files stay two').toBe(false);
    expect(samePath('/a', '/A', 'darwin'), 'off win32 the case is part of the name').toBe(false);
  });
});
