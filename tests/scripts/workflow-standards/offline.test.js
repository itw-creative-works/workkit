//
// Tests for standards.sh: offline and unauthenticated, and run from anywhere.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W,
} = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath, systemPathWith } = require('../../lib/platform');
const { isCall } = require('../../lib/argv-log');
const {
  SCRIPT, IGNORE_GLOB, mkTmp, cleanup, makeRepo, makeGhStub, readFile, ghCalls, binDirWithout,
  runScript,
} = require('./helpers');

const run = async () => {
  group('standards.sh: offline and unauthenticated');

  await test('no gh on PATH: clean exit, local heals still applied', () => {
    const repo = makeRepo();
    // Hand-built PATH, like the jq test below: `command -v gh` searches every
    // PATH entry, and a machine that keeps gh in /usr/bin (a CI runner does)
    // would otherwise reach the authentication check instead of this one.
    const binDir = binDirWithout('gh');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    const code = res.status;
    const stdout = (res.stdout || '') + (res.stderr || '');
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`);
    assert(stdout.includes('gh not installed'), `says why the label step was skipped, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed');
    assert(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed');
    cleanup(repo); cleanup(binDir);
  });

  await test('no jq on PATH: only the label step is skipped, local heals run', () => {
    const repo = makeRepo();
    const binDir = binDirWithout('jq');
    const res = spawnSync(SYSTEM_BASH, [...NO_RC, shellPath(SCRIPT), shellPath(repo)], {
      env: { PATH: binDir, WORKFLOW_HOME: shellPath(path.join(binDir, 'workflow-home')) },
      encoding: 'utf8',
      timeout: 20000,
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    assertEq(res.status, 0, 'exit 0');
    assert(stdout.includes('jq not installed'), `says why the label step was skipped, got: ${stdout}`);
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed');
    assert(fs.existsSync(path.join(repo, W, 'capture.md')), 'the capture file is still created');
    assert(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed');
    cleanup(repo); cleanup(binDir);
  });

  await test('gh present but unauthenticated: skipped without any label call', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ authed: false });
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`);
    assert(stdout.includes('not authenticated'), `says why, got: ${stdout}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label')), 'never reaches the label API');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('no origin remote: labels skipped, exit 0', () => {
    const repo = makeRepo({ remote: false });
    const stub = makeGhStub();
    const { code, output: stdout } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(code, 0, 'exit 0');
    assert(stdout.includes('no origin remote'), `says why, got: ${stdout}`);
    assert(!ghCalls(stub).some((c) => isCall(c, 'label', 'list')), 'never queries labels');
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: runs from anywhere');

  await test('defaults to the current directory when given no argument', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT)], {
      cwd: repo,
      env: {
        ...process.env, PATH: systemPathWith(stub.binDir),
        // Inherited HOME plus the two user-level seeds would write the real
        // ~/.workkit and repoint the real ~/.claude/workkit.
        WORKFLOW_HOME: shellPath(path.join(mkTmp(), 'wh')), WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'ch')),
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    assertEq(res.status, 0, 'exit 0');
    assert(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'dump.md')), 'healed the cwd repo');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a subdirectory resolves to the repo root', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    runScript(nested, { pathPrefix: stub.binDir });
    assert(fs.existsSync(path.join(repo, '.gitignore')), 'root .gitignore healed, not the subdir');
    assert(!fs.existsSync(path.join(nested, '.gitignore')), 'nothing written in the subdirectory');
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
