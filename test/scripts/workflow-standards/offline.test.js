// Tests for standards.js: offline and unauthenticated, and run from anywhere.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const {
  describe, test, expect, WORKKIT_DIR: W, mkTmp,
} = require('../../lib/harness');
const {
  NODE_DIR, systemPathWith, joinPath, nodeHomeEnv,
} = require('../../lib/platform');
const { isCall } = require('../../lib/argv-log');
const { linesOf } = require('../../lib/run-lists');
const {
  WORKFLOW_DIR, IGNORE_GLOB, cleanup, makeRepo, makeGhStub, readFile, ghCalls, binDirWithout, heal,
  runScript, claudeHomeWith,
} = require('./helpers');

describe('standards.js: offline and unauthenticated', () => {
  test('no gh on PATH: clean exit, local heals still applied', () => {
    const repo = makeRepo();
    // Hand-built PATH, like the jq test below: `command -v gh` searches every
    // PATH entry, and a machine that keeps gh in /usr/bin (a CI runner does)
    // would otherwise reach the authentication check instead of this one.
    const binDir = binDirWithout('gh');
    // A scratch home holding its own ~/.claude, so the heal's engine link lands there.
    const { home, claude } = claudeHomeWith();
    const res = heal([repo], nodeHomeEnv(home, {
      PATH: binDir, WORKFLOW_HOME: path.join(binDir, 'workflow-home'), WORKFLOW_CLAUDE_HOME: claude,
    }));
    const code = res.status;
    const stdout = (res.stdout || '') + (res.stderr || '');
    expect(code, 'exit 0').toBe(0);
    expect(!stdout.includes('⚠'), `announces nothing broken, got: ${stdout}`).toBeTruthy();
    expect(stdout.includes('gh not installed'), `says why the label step was skipped, got: ${stdout}`).toBeTruthy();
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed').toBeTruthy();
    expect(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed').toBeTruthy();
    expect(fs.realpathSync(path.join(claude, 'workkit')), 'the engine link is the case\'s own, in its scratch claude home')
      .toBe(fs.realpathSync(WORKFLOW_DIR));
    cleanup(repo); cleanup(binDir); cleanup(home);
  });

  test('no jq on PATH: the label step still runs, local heals run, the hook layer check is whole, and no line names jq', () => {
    const repo = makeRepo();
    const binDir = binDirWithout('jq');
    // The mirror keeps this machine's gh, so the stub goes ahead of it.
    const stub = makeGhStub();
    const res = heal([repo], {
      PATH: joinPath(stub.binDir, binDir),
      WORKFLOW_HOME: path.join(binDir, 'workflow-home'),
      WORKFLOW_CLAUDE_HOME: path.join(mkTmp('wf-std-'), 'claude-home'),
    });
    const stdout = (res.stdout || '') + (res.stderr || '');
    expect(res.status, `exit 0, got: ${stdout}`).toBe(0);
    expect(ghCalls(stub).some((c) => isCall(c, 'label', 'list')), `the label step read the labels, got: ${stdout}`).toBe(true);
    expect(stdout.includes('hook layer needs'), `the hook layer asks for no tool this machine lacks, got: ${stdout}`).toBe(false);
    expect(linesOf(stdout).filter((line) => /\bjq\b/.test(line)), `no line about jq, got: ${stdout}`).toEqual([]);
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md')), 'templates still installed').toBeTruthy();
    expect(fs.existsSync(path.join(repo, W, 'capture.md')), 'the capture file is still created').toBeTruthy();
    expect(IGNORE_GLOB.test(readFile(path.join(repo, '.gitignore'))), 'gitignore still healed').toBeTruthy();
    cleanup(repo); cleanup(binDir); cleanup(stub.dir);
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

describe('standards.js: runs from anywhere', () => {
  test('defaults to the current directory when given no argument', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const res = heal([], nodeHomeEnv(mkTmp('wf-std-'), {
      ...process.env, PATH: systemPathWith(stub.binDir, NODE_DIR),
      // The two user-level seeds, so nothing reaches a ~/.workkit or ~/.claude/workkit.
      WORKFLOW_HOME: path.join(mkTmp('wf-std-'), 'wh'), WORKFLOW_CLAUDE_HOME: path.join(mkTmp('wf-std-'), 'ch'),
      // A program that starts node in a folder hands on its own PWD, which names another; the folder is the cwd.
      PWD: mkTmp('wf-std-'),
    }), { cwd: repo });
    expect(res.status, `exit 0, got: ${res.stdout}${res.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'dump.md')), `healed the cwd repo, got: ${res.output}`).toBeTruthy();
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
