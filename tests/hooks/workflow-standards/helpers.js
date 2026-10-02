// The shared prologue of the hooks/workflow:standards suites beside this one,
// one suite per concern (the engine's own: tests/scripts/workflow-standards/).
// Every run has no gh on its PATH, or a recording stub, so nothing touches the
// network.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { WORKKIT_DIR: W } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, basePathWithout, joinPath,
} = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');

const HOOK = path.join(__dirname, '..', '..', '..', 'hooks', 'workflow', 'standards', 'run.sh');

// The hook resolves the engine from its own location; WORKFLOW_DIR overrides
// that. Most tests point it at the repo's own workflow/ explicitly, and the
// default-path group drops it to prove the relative resolution.
const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');

// node is on the PATH of any machine running this standard: the engine lints
// CHANGELOGs with it, and its hook-layer self-check counts it among the tools
// the hooks call. A PATH without it makes every heal here report a machine that
// does not exist.
const BASE_PATH = joinPath(SYSTEM_PATH, NODE_DIR);

// The ignore line the engine writes, built from the harness constant so the
// directory's name lives in exactly one place here too.
const IGNORE_GLOB = new RegExp(`^${W.replace(/\./g, '\\.')}/\\*$`, 'm');

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// Participation gate: a committed .workkit/settings.json holding
// `enabled: true` at the repo root is the opt-in, so every repo fixture gets one
// unless a test is exercising another state.
const makeRepo = ({ optIn = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp('wf-hook-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/alice/repo.git'], { cwd: dir });
  if (optIn) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// Record a decline the way the engine does, through its own entry point, so
// the test proves the two halves agree on the file's shape.
const decline = (repo, workflowHome) => spawnSync(BASH, [...NO_RC,
  shellPath(path.join(WORKFLOW_DIR, 'standards.sh')), '--decline', shellPath(repo),
], {
  env: {
    ...process.env,
    WORKFLOW_HOME: shellPath(workflowHome),
    WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp('wf-hook-'), 'claude-home')),
  },
  encoding: 'utf8',
});

// A machine that has run `workkit setup`, as far as the setup pester can see:
// the CLI symlink pointed at this checkout's engine. Every run seeds it unless
// the case is a machine that never ran setup (setup: false).
const seedSetup = (home) => {
  const dir = path.join(home, '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(dir, 'workkit');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(WORKFLOW_DIR, 'workkit.sh'), link);
  return link;
};


// The machine without `gh`: a runner ships the real one in /usr/bin, so a case
// about its absence takes it off the PATH. Built once, removed with the suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp('wf-hook-'), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

// Every run gets a disposable cache, home, WORKFLOW_HOME and claude home (or
// the `claudeHome` given), so nothing the engine writes leaks between tests or
// reaches the developer's own. workflowDir: null drops WORKFLOW_DIR so the
// hook resolves the engine beside itself.
const runHook = (cwd, {
  cache, pathPrefix, home, workflowDir, workflowHome, claudeHome, setup = true,
} = {}) => {
  const cacheDir = cache || mkTmp('wf-hook-');
  // The home stays native for anything this suite writes into it, and goes
  // through the shell's spelling only on the way into the child's environment.
  const homeDir = home || mkTmp('wf-hook-');
  const env = homeEnv(homeDir, {
    PATH: pathPrefix ? joinPath(pathPrefix, BASE_PATH) : joinPath(pathWithoutGh(), NODE_DIR),
    WORKFLOW_STANDARDS_CACHE: shellPath(cacheDir),
    // Outside the marker cache: the engine seeds the user settings file there,
    // and the tests count one marker file per repo in the cache.
    WORKFLOW_HOME: shellPath(workflowHome || path.join(mkTmp('wf-hook-'), 'workflow-home')),
    WORKFLOW_CLAUDE_HOME: shellPath(claudeHome || path.join(mkTmp('wf-hook-'), 'claude-home')),
  });
  if (setup) seedSetup(homeDir);
  const dir = workflowDir === undefined ? WORKFLOW_DIR : workflowDir;
  if (dir !== null) env.WORKFLOW_DIR = shellPath(dir);
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input: JSON.stringify({ cwd: shellPath(cwd), source: 'startup' }),
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '', cacheDir };
};

module.exports = {
  HOOK, WORKFLOW_DIR, BASE_PATH, IGNORE_GLOB, cleanup, makeRepo, decline, runHook,
  dropPathWithoutGh,
};
