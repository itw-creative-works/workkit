//
// The shared prologue of the hooks/safety/commit-gate suites, the `*.test.js`
// files beside this one, which test the PreToolUse hook that gates every
// `git commit`: code commits need a fresh workkit:review marker, and repos
// with a test script need the suite green. One suite per check. A plain
// module, never a suite: the runner only loads files ending in `.test.js`.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { assert, assertEq, skipSuite } = require('../../lib/harness');
const {
  BASH, SYSTEM_BASH, NO_RC, shellPath, digestTool,
} = require('../../lib/platform');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'commit-gate', 'run.sh');
// The gate's CHANGELOG check resolves the engine by path; point it at this
// checkout so the suite tests the code under review, not the installed copy.
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const LIB = path.join(__dirname, '..', '..', '..', 'hooks', '_lib.sh');
// The review marker lives under the SESSION's temp dir, so the gate and this
// suite have to read the same one: Windows leaves TMPDIR unset, where node's
// `/tmp` fallback and a Git Bash `/tmp` are two different directories. One
// temp dir, handed to every child explicitly, and both sides agree by
// construction.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-tmp-'));

const mkRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-test-'));
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

// The digest THIS machine spells: macOS ships `shasum`, a Linux machine
// `sha1sum`, and the gate names the marker through hook_sha1, which takes
// either. The expected path this suite builds follows the same rule, or the
// suite would only ever pass on half the platforms the kit runs on.
const DIGEST = digestTool();

// Every suite asks this first: without a digest tool no marker can be named.
const skipWithoutDigest = () => {
  if (!DIGEST) {
    skipSuite('this machine has neither shasum nor sha1sum, so no review marker can be named');
  }
};

const markerPath = (dir) => {
  const hash = execSync(`printf '%s' "$(git rev-parse --show-toplevel)" | "${shellPath(DIGEST)}" | cut -d' ' -f1`,
    { cwd: dir, encoding: 'utf8', shell: SYSTEM_BASH }).trim();
  const mdir = path.join(TMP, 'claude-review-marker');
  fs.mkdirSync(mdir, { recursive: true });
  return path.join(mdir, hash);
};

// The marker script the review skill calls, and the skill's own line calling
// it: the cases below run the LINE, so the skill, the script and this gate
// cannot drift apart. CLAUDE_PLUGIN_ROOT is handed over the way a hook command
// hands it over.
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
const dropMarker = (dir) => { try { fs.rmSync(markerPath(dir)); } catch {} };

const runHook = (cwd, command, spawnCwd, extraEnv = {}) => {
  const input = JSON.stringify({ cwd: shellPath(cwd), tool_input: { command } });
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input,
    cwd: spawnCwd,
    env: {
      ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP),
      WORKFLOW_DIR: shellPath(WORKFLOW_DIR), ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// A stand-down's message, off the hook's JSON stdout: the channel a
// PreToolUse hook exiting 0 is actually heard on (#155). Empty stdout is no
// stand-down, and is returned as such so a case can assert silence.
const standDownMessage = (out) => {
  if (!out.stdout.trim()) return '';
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse', 'the event name the harness expects');
  assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage, 'the user and the model hear the same line');
  assert(parsed.permissionDecision === undefined, 'a stand-down never decides the commit');
  return parsed.systemMessage;
};

const cleanup = (dir) => { dropMarker(dir); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The repo the suite-run cases (check 5) are asked in: its test script leaves
// a sentinel and then fails, so a suite that ran is visible as the file.
const SENTINEL = 'suite-ran';
const pkg = (version, extra) => `${JSON.stringify({
  name: 'fixture', version, scripts: { test: `touch ${SENTINEL} && exit 1` }, ...extra,
}, null, 2)}\n`;
const suiteRan = (dir) => fs.existsSync(path.join(dir, SENTINEL));

// package.json and a source file already committed, so each case stages only
// what it is about, and so the version bumps a case stages have a HEAD copy to
// be judged against.
const mkReleaseRepo = () => {
  const dir = mkRepo();
  stage(dir, 'package.json', pkg('1.0.0'));
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

module.exports = {
  HOOK, WORKFLOW_DIR, LIB, TMP, PLUGIN_ROOT,
  mkRepo, stage, stageDeep, skipWithoutDigest, markerPath, runSkillLine, touchMarker, dropMarker,
  runHook, standDownMessage, cleanup, pkg, suiteRan, mkReleaseRepo, CHANGELOG, ISSUE, ENTRY,
};
