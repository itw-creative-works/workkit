// The shared prologue of the workflow:standards logic suites beside this one:
// standardsContext(state, healResult, updateResult) in hooks/mods/standards.js
// fed the engine's real output. The engine's own suites are
// test/scripts/workflow-standards/; the session-start wiring (the daily
// marker, the gate, the pester's every-session rule) is test/mods/session-start.test.ts.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { WORKKIT_DIR: W } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, basePathWithout, joinPath,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const { mods, textOf, runResult, standardsState } = require('../../lib/mods-inputs');
const { SPAWN_DEADLINE } = require('../../lib/process');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// An opted-in repo with an origin, the state a daily heal acts on.
const makeRepo = () => {
  const dir = mkTmp('wf-hook-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/alice/repo.git'], { cwd: dir });
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  fs.writeFileSync(path.join(dir, W, 'settings.json'), '{ "version": 1, "enabled": true }\n');
  return dir;
};

// The machine without `gh`, so the heal never touches the network. Built
// once, removed with the suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('wf-hook-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

/** The engine's heal of `repo` under QUIET=1, as the process.run result the module receives. */
const heal = (repo) => {
  const home = mkTmp('wf-hook-');
  const res = spawnSync(BASH, [...NO_RC, shellPath(path.join(WORKFLOW_DIR, 'standards.sh')), shellPath(repo)], {
    cwd: repo,
    env: homeEnv(home, {
      PATH: joinPath(pathWithoutGh(), NODE_DIR),
      QUIET: '1',
      WORKFLOW_HOME: shellPath(path.join(home, '.workkit')),
      WORKFLOW_CLAUDE_HOME: shellPath(path.join(home, 'claude-home')),
    }),
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  cleanup(home);
  return runResult({ exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' });
};

/** What the hook says for this state and these two runs. */
const say = (state, healResult = runResult(), updateResult = runResult()) => textOf(
  mods('standards').standardsContext(standardsState(state), healResult, updateResult),
);

module.exports = {
  WORKFLOW_DIR, BASE_PATH: joinPath(SYSTEM_PATH, NODE_DIR), cleanup, makeRepo, heal, say, dropPathWithoutGh,
};
