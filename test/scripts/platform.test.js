// Tests for test/lib/platform.js's own seams that no suite reaches by using
// them: a stand-in that hands over to the real program, and samePath.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, stubToolJs, handOverJs, pathWith, linkTool, which, joinPath, samePath, spawnSync,
} = require('../lib/platform');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// A stand-in that only hands over, started by its bare name through the kit's starter.
describe('test/lib/platform.js: a hand-over stand-in', () => {
  test('a stand-in that hands over passes on the real program\'s exit code, its output and its arguments', () => {
    const dir = mkTmp('wf-platform-');
    const real = path.join(dir, 'real.js');
    fs.writeFileSync(real, [
      "process.stdout.write(`${process.argv.slice(2).join('|')}\\n`);",
      "process.stderr.write('to-stderr\\n');",
      'process.exitCode = 3;',
    ].join('\n'));
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    stubToolJs(bin, 'gh', handOverJs(process.execPath, [real]));
    const res = spawnSync('gh', ['a "b" c', 'd e'],
      { env: { ...process.env, PATH: pathWith(bin) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `the real program's exit code, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(3);
    expect(res.stdout, 'each argument whole, quotes and spaces kept').toBe('a "b" c|d e\n');
    expect(res.stderr, 'its stderr').toBe('to-stderr\n');
    cleanup(dir);
  });

  test('an exe mirrored by linkTool is started from Node by its bare name', {
    skip: !IS_WINDOWS && 'linkTool hands an exe over on Windows alone; elsewhere it links',
  }, () => {
    const dir = mkTmp('wf-platform-');
    linkTool(dir, which('git'));
    expect(fs.existsSync(path.join(dir, 'git')), 'the mirror holds the stand-in by its stem, ahead of the real git on PATH').toBeTruthy();
    const res = spawnSync('git', ['--version'],
      { env: { ...process.env, PATH: joinPath(dir, SYSTEM_PATH) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    expect(res.status, `git answered, error: ${res.error || ''} stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith('git version'), `git's own answer, got: ${JSON.stringify(res.stdout)}`).toBeTruthy();
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
