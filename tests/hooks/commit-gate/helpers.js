// The shared prologue of the hooks/safety/commit-gate suites beside this one,
// one suite per check.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { assert, assertEq, skipSuite } = require('../../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_BASH, NO_RC, WINDOWS_CSC, shellPath, gitPath, digestTool, pathWith, stubTool,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { plantRecord, reviewMarkerPath } = require('../../lib/suite-record');
const { recordArgv, readArgv } = require('../../lib/argv-log');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'commit-gate', 'run.sh');
// The gate's CHANGELOG check resolves the engine by path; point it at this
// checkout so the suite tests the code under review, not the installed copy.
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const LIB = path.join(__dirname, '..', '..', '..', 'hooks', '_lib.sh');
// One temp dir handed to every child explicitly, so the gate and this suite
// read the same review marker: on Windows node's `/tmp` and Git Bash's differ.
const TMP = mkTmp('cg-tmp-');

const mkRepo = () => {
  const dir = mkTmp('cg-test-');
  execSync('git init && git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
  return dir;
};

const stage = (dir, name, content) => {
  fs.writeFileSync(path.join(dir, name), content);
  execSync(`git add "${name}"`, { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
};

const stageDeep = (dir, name, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  stage(dir, name, content);
};

const DIGEST = digestTool();

// Every suite asks this first: without a digest tool no marker can be named.
const skipWithoutDigest = () => {
  if (!DIGEST) {
    skipSuite('this machine has neither shasum nor sha1sum, so no review marker can be named');
  }
};

const markerPath = (dir) => {
  const marker = reviewMarkerPath(TMP, dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  return marker;
};

// The marker script the review skill calls, and the skill's own line calling
// it: the cases run that line, so the skill, the script and this gate cannot
// drift apart. CLAUDE_PLUGIN_ROOT is handed over the way a hook command does.
const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');
const skillLine = () => {
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
  const line = skill.split('\n').find((l) => l.includes('scripts/review-marker.sh') && l.startsWith('bash '));
  assert(line, 'the skill carries the marker line');
  return line;
};
const runSkillLine = (dir) => spawnSync(BASH, [...NO_RC, '-c', skillLine()], {
  cwd: dir,
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: shellPath(PLUGIN_ROOT), TMPDIR: shellPath(TMP) },
  encoding: 'utf8',
  timeout: 10000,
});

const touchMarker = (dir) => fs.writeFileSync(markerPath(dir), '');
// The record a green root `npm test` leaves for the tree on disk (check 5).
const proveTree = (dir) => plantRecord(TMP, dir);
const dropMarker = (dir) => { try { fs.rmSync(markerPath(dir)); } catch {} };

// npm's script shell as setup wires it: the wrapper beside this checkout's
// engine, or on Windows the executable built into a scratch machine folder
// (null with no compiler), which reaches this checkout's wrapper through a
// scratch claude home whose `workkit` is a junction to it.
const EXE_HOME = path.join(TMP, 'workkit-home');
const EXE_CLAUDE_HOME = path.join(TMP, 'claude-home');
const EXE = path.join(EXE_HOME, 'script-shell.exe');
fs.mkdirSync(EXE_HOME, { recursive: true });
const buildExe = () => {
  if (!fs.existsSync(WINDOWS_CSC)) return null;
  const cli = path.join(WORKFLOW_DIR, 'workkit.sh');
  const res = spawnSync(BASH, [...NO_RC, '-c', `. "${shellPath(cli)}" help >/dev/null; script_shell_exe`], {
    env: { ...process.env, WORKFLOW_HOME: shellPath(EXE_HOME) }, encoding: 'utf8', timeout: 60000,
  });
  // A compile error must never read as a machine without a compiler.
  if (!fs.existsSync(EXE)) throw new Error(`${WINDOWS_CSC} built no ${EXE}: ${res.stderr || res.error || ''}`);
  fs.mkdirSync(EXE_CLAUDE_HOME, { recursive: true });
  fs.symlinkSync(path.resolve(WORKFLOW_DIR), path.join(EXE_CLAUDE_HOME, 'workkit'), 'junction');
  return gitPath(EXE);
};
const WRAPPER = IS_WINDOWS ? buildExe() : path.join(WORKFLOW_DIR, 'script-shell.sh');
// The gate compares npm's value with the machine folder's executable on Windows.
const EXE_ENV = IS_WINDOWS ? { WORKFLOW_HOME: shellPath(EXE_HOME) } : {};

// A scratch user npmrc naming <shell>: the gate's hint reads npm's config, never
// the machine's.
const scratchNpmrc = (shell) => {
  const file = path.join(mkTmp('cg-npmrc-'), 'npmrc');
  fs.writeFileSync(file, shell ? `script-shell=${shell}\n` : '');
  return file;
};
// The gate asks only that the executable exists before it compares paths, so
// with no compiler an empty stand-in wires it.
if (IS_WINDOWS && !fs.existsSync(EXE)) fs.writeFileSync(EXE, '');
const WIRED_NPMRC = scratchNpmrc(IS_WINDOWS ? gitPath(EXE) : WRAPPER);

// A parent `npm test` exports its own npm_config_* (the real userconfig among
// them), which would beat the scratch one, so none is passed on.
const withoutNpmConfig = (env) => Object.fromEntries(
  Object.entries(env).filter(([k]) => !/^npm_config_/i.test(k)),
);

const runHook = (cwd, command, spawnCwd, extraEnv = {}) => {
  const input = JSON.stringify({ cwd: shellPath(cwd), tool_input: { command } });
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input,
    cwd: spawnCwd,
    env: {
      ...withoutNpmConfig(process.env), HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP),
      WORKFLOW_DIR: shellPath(WORKFLOW_DIR), NPM_CONFIG_USERCONFIG: WIRED_NPMRC, ...EXE_ENV, ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// A stand-down's message, off the hook's JSON stdout: the channel a
// PreToolUse hook exiting 0 is actually heard on. Empty stdout is no
// stand-down, and is returned as such so a case can assert silence.
const standDownMessage = (out) => {
  if (!out.stdout.trim()) return '';
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', 'the event name the harness expects');
  assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage, 'the user and the model hear the same line');
  assert(parsed.permissionDecision === undefined, 'a stand-down never decides the commit');
  return parsed.systemMessage;
};

// A `gh` on PATH answering `issue view <N>` from fixtures, so checks 6 and 7
// read issues without reaching GitHub. Each issue is `{ comments, state,
// labels, url }`, an OPEN issue at status:complete unless a case says
// otherwise; `fails: true` makes every view exit non-zero, like an offline gh.
const ghStub = ({ issues = {}, fails = false } = {}) => {
  const dir = mkTmp('cg-gh-');
  const bodies = path.join(dir, 'issues');
  fs.mkdirSync(bodies);
  for (const [number, issue] of Object.entries(issues)) {
    const {
      comments = [], state = 'OPEN', labels = ['status:complete'], url = `https://github.com/o/r/issues/${number}`,
    } = issue;
    fs.writeFileSync(path.join(bodies, `${number}.json`), JSON.stringify({
      state, url, labels: labels.map((name) => ({ name })), comments: comments.map((body) => ({ body })),
    }));
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const logFile = path.join(dir, 'gh.log');
  stubTool(bin, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1 $2" == "issue view" ]]; then',
    ...(fails ? ['  echo "gh: offline" >&2', '  exit 1'] : [
      `  file="${shellPath(bodies)}/$3.json"`,
      '  [[ -f "$file" ]] || exit 1',
      '  cat "$file"',
      '  exit 0',
    ]),
    'fi',
    'exit 0',
  ]);
  return { env: { PATH: pathWith(bin) }, dir, logFile };
};

const ghCalls = (stub) => readArgv(stub.logFile);

const cleanup = (dir) => { dropMarker(dir); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The repo the check 5 cases are asked in: its test script leaves a sentinel
// and then fails, so a suite the gate ran would be visible as the file.
const SENTINEL = 'suite-ran';
const pkg = (version, extra) => `${JSON.stringify({
  name: 'fixture', version, scripts: { test: `touch ${SENTINEL} && exit 1` }, ...extra,
}, null, 2)}\n`;
const suiteRan = (dir) => fs.existsSync(path.join(dir, SENTINEL));

// package.json and a source file already committed, so each case stages only
// what it is about, and so the version bumps a case stages have a HEAD copy to
// be judged against.
const mkReleaseRepo = (manifest = pkg('1.0.0')) => {
  const dir = mkRepo();
  stage(dir, 'package.json', manifest);
  stage(dir, 'app.js', 'const x = 1;\n');
  execSync('git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
  return dir;
};

// A CHANGELOG.md in the format, holding the given bullets under
// [Unreleased] / Added, and the one entry a Fixes #4 commit closes against.
const CHANGELOG = (...bullets) => [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  ...bullets.flatMap((b) => [b, '']),
].join('\n');
const ISSUE = '[#4](https://github.com/o/r/issues/4)';
const ENTRY = CHANGELOG(`- ${ISSUE} - The thing the issue asked for.`);

// A repo whose commit is ready for every check but 6 and 7: CHANGELOG seeded
// and its entry staged (check 4), code staged, review marker fresh.
const shipReadyRepo = () => {
  const dir = mkRepo();
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG());
  execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
  stage(dir, 'app.js', 'const x = 1;\n');
  stage(dir, 'CHANGELOG.md', ENTRY);
  touchMarker(dir);
  return dir;
};

module.exports = {
  HOOK, WORKFLOW_DIR, LIB, TMP, PLUGIN_ROOT, WRAPPER, EXE_CLAUDE_HOME, EXE_ENV, scratchNpmrc,
  mkRepo, stage, stageDeep, skipWithoutDigest, markerPath, runSkillLine, touchMarker, dropMarker, proveTree,
  runHook, standDownMessage, ghStub, ghCalls, shipReadyRepo, cleanup, pkg, suiteRan, mkReleaseRepo, CHANGELOG, ISSUE, ENTRY,
};
