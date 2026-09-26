//
// The shared prologue of the hooks/safety/capture-guard suites, the `*.test.js`
// files beside this one, which test the PreToolUse hook that keeps
// .workkit/capture.md the owner's capture surface: its CONTENTS are read, and
// its drained entries cleared, only during a triage run, which the
// workkit:triage skill announces by touching a marker. A missing or stale
// (>30 min) marker blocks every read and every rewrite; ADDING to the file is
// never the agent's, marker or not. Counting stays open. One suite per path
// the capture file is reached by. A plain module, never a suite: the runner
// only loads files ending in `.test.js`.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { skipSuite, WORKKIT_DIR: W } = require('../../lib/harness');
const { BASH, NO_RC, shellPath, digestTool } = require('../../lib/platform');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'safety', 'capture-guard', 'run.sh');

// One throwaway git repo holding the capture file, plus a TMPDIR of its own so
// the marker this suite writes can never be the machine's real one.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-tmp-'));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-guard-'));
spawnSync('git', ['init', '-q'], { cwd: REPO });
fs.mkdirSync(path.join(REPO, W, 'agents'), { recursive: true });
fs.writeFileSync(path.join(REPO, W, 'capture.md'), '# capture\n\n- a private thought\n');
fs.writeFileSync(path.join(REPO, W, 'agents', 'session.md'), '# Session\n');
// Every suite beside this one reads the same repo and TMPDIR, and the runner
// loads them all in one process, so they are removed when the process ends,
// not when any one suite does.
process.on('exit', () => {
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

// The repo root as GIT reports it: on macOS the temp dir is reached through a
// symlink, and the marker's name is the sha of the PHYSICAL path.
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' })
  .stdout.trim();
const MARKER_DIR = path.join(TMP, 'claude-triage-marker');
// The digest THIS machine spells: macOS ships `shasum`, a Linux machine
// `sha1sum`, and the guard keys the marker through hook_sha1, which takes
// either. The expected path this suite builds follows the same rule, or the
// suite would only ever pass on half the platforms the kit runs on.
const DIGEST = digestTool();

// Every suite asks this first: without a digest tool no marker path can be named.
const skipWithoutDigest = () => {
  if (!DIGEST) {
    skipSuite('this machine has neither shasum nor sha1sum, so no marker path can be named');
  }
};

// The marker's name is the sha of the ANCHOR: the capture file's repo root, or the
// .workkit directory's own parent outside a repo.
const markerFor = (anchor) => path.join(
  MARKER_DIR,
  DIGEST ? spawnSync(DIGEST, [], { input: anchor, encoding: 'utf8' }).stdout.split(' ')[0] : 'no-digest',
);
const MARKER = markerFor(REPO_ROOT);
const CAPTURE = path.join(REPO, W, 'capture.md');

const clearMarker = (marker = MARKER) => fs.rmSync(marker, { force: true });
const touchMarker = (ageSeconds = 0, marker = MARKER) => {
  fs.mkdirSync(MARKER_DIR, { recursive: true });
  fs.writeFileSync(marker, '');
  if (ageSeconds) {
    const when = new Date(Date.now() - ageSeconds * 1000);
    fs.utimesSync(marker, when, when);
  }
};

const runHook = (payload, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input: JSON.stringify({ cwd: shellPath(REPO), ...payload }),
    env: {
      ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP), ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const read = (file) => runHook({ tool_name: 'Read', tool_input: { file_path: shellPath(file) } });
const bash = (command) => runHook({ tool_name: 'Bash', tool_input: { command } });

module.exports = {
  HOOK, TMP, REPO, MARKER, CAPTURE, skipWithoutDigest, markerFor, clearMarker, touchMarker,
  runHook, read, bash,
};
