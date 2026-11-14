// Tests for standards.sh: offline and unauthenticated, and run from anywhere.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, WORKKIT_DIR: W, mkTmp, SPAWN_DEADLINE,
} = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath, systemPathWith } = require('../../lib/platform');
const { isCall } = require('../../lib/argv-log');
const {
  SCRIPT, IGNORE_GLOB, cleanup, makeRepo, makeGhStub, readFile, ghCalls, binDirWithout,
  runScript,
} = require('./helpers');

describe('standards.sh: offline and unauthenticated', () => {
  test('no gh on PATH: clean exit, local heals still applied', () => {
    const repo = makeRepo();
    // Hand-built PATH, like the jq test below: `command -v gh` searches every
    // PATH entry, and a machine that keeps gh in /usr/bin (a CI runner does)
    // would otherwise reach the authentication check instead of this one.
    const binDir = binDirWithout('gh');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    const code = res.status;
    const stdout = (res.stdout || '') + (res.stderr || '');
    expect(code, 'exit 0').toBe(0);
    expect(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes('gh not installed'), `says why the label step was skipped, got: ${stdout}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed').toBeTruthy();
    expect(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed').toBeTruthy();
    cleanup(repo); cleanup(binDir);
  });

  test('no jq on PATH: only the label step is skipped, local heals run', () => {
    const repo = makeRepo();
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    expect(res.status, 'exit 0').toBe(0);
    expect(stdout.includes('jq not installed'), `says why the label step was skipped, got: ${stdout}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed').toBeTruthy();
    expect(fs.existsSync(path.join(repo, W, 'capture.md')), 'the capture file is still created').toBeTruthy();
    expect(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed').toBeTruthy();
    cleanup(repo); cleanup(binDir);
  });

  test('gh present but unauthenticated: skipped without any label call', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ authed: false });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0').toBe(0);
    expect(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes('not authenticated'), `says why, got: ${stdout}`).toBeTruthy();
    expect(!ghCalls(stub).some((c) => isCall(c, 'label')), 'never reaches the label API').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('no origin remote: labels skipped, exit 0', () => {
    const repo = makeRepo({ remote: false });
    const stub = makeGhStub();
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    expect(code, 'exit 0').toBe(0);
    expect(stdout.includes('no origin remote'), `says why, got: ${stdout}`).toBeTruthy();
    expect(!ghCalls(stub).some((c) => isCall(c, 'label', 'list')), 'never queries labels').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});

describe('standards.sh: runs from anywhere', () => {
  test('defaults to the current directory when given no argument', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      cwd: repo,
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        // Inherited HOME plus the two user-level seeds would write the real
        // ~/.workkit and repoint the real ~/.claude/workkit.
        WORKFLOW_HOME: shellPath(path.join(mkTmp('wf-std-'), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('wf-std-'), 'ch')),
      },
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
    });
    expect(res.status, 'exit 0').toBe(0);
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'dump.md')), 'healed the cwd repo').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });

  test('a subdirectory resolves to the repo root', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    runScript(nested, { pathPrefix: stub.binDir });
    expect(fs.existsSync(path.join(repo, '.gitignore')), 'root .gitignore healed, not the subdir').toBeTruthy();
    expect(!fs.existsSync(path.join(nested, '.gitignore')), 'nothing written in the subdirectory').toBeTruthy();
    cleanup(repo); cleanup(stub.dir);
  });
});
