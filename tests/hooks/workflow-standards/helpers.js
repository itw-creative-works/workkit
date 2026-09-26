//
// The shared prologue of the hooks/workflow:standards suites, the `*.test.js`
// files beside this one, which test the SessionStart hook that runs the
// workflow core's standards.sh against the session's repo, at most once per
// repo per day, and reports only what it created or corrected. One suite per
// concern. The engine's own suites are tests/scripts/workflow-standards/. A
// plain module, never a suite: the runner only loads files ending in
// `.test.js`.
//
// The standards script's label step needs gh; every test here runs with a PATH
// that has no gh on it (or a recording stub), so nothing touches the network.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { WORKKIT_DIR: W } = require('../../lib/harness');
const {
  BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, homeEnv, basePathWithout, joinPath,
} = require('../../lib/platform');

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

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-hook-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// Participation gate: a committed .workkit/settings.json holding
// `enabled: true` at the repo root IS the opt-in, so every repo fixture gets one
// unless a test is exercising another state.
const makeRepo = ({ optIn = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
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
    WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'claude-home')),
  },
  encoding: 'utf8',
});

// Each run gets its own cache dir unless one is passed in: the daily marker
// must never leak between tests (or into the real ~/.claude/logs).
// `home` overrides HOME; passing workflowDir: null DROPS WORKFLOW_DIR from the
// environment so the hook resolves the engine beside itself.
// WORKFLOW_HOME and WORKFLOW_CLAUDE_HOME always point somewhere disposable: the
// user-level settings file and the engine's address symlink, both written by
// the engine on every run, must never be the real ~/.workkit or ~/.claude.
// A machine that has run `workkit setup`, as far as the setup pester (#72) can
// see it: the CLI symlink the wizard installs, pointed at this checkout's
// engine: exactly what `workkit update` calls current. Every run seeds it
// unless the test is exercising a machine that never ran setup (setup: false),
// because a scratch HOME is otherwise indistinguishable from a fresh machine
// and every case here would carry the pester.
const seedSetup = (home) => {
  const dir = path.join(home, '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(dir, 'workkit');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(WORKFLOW_DIR, 'workkit.sh'), link);
  return link;
};


// The machine that does NOT have `gh`. A runner ships the real one in /usr/bin,
// so a case about its absence has to take it off the PATH rather than trust the
// system one, or the REAL gh answers and the case passes for another reason.
// Built once, since the mirror links every system tool, and removed with the
// suite.
let noGhPath = null;
const pathWithoutGh = () => {
  if (!noGhPath) noGhPath = basePathWithout(mkTmp(), 'gh');
  return noGhPath;
};
const dropPathWithoutGh = () => {
  if (noGhPath) cleanup(path.dirname(noGhPath));
  noGhPath = null;
};

const runHook = (cwd, { cache, pathPrefix, home, workflowDir, workflowHome, setup = true } = {}) => {
  const cacheDir = cache || mkTmp();
  // The home stays NATIVE for anything this suite writes into it, and goes
  // through the shell's spelling only on the way into the child's environment.
  const homeDir = home || mkTmp();
  // A scratch HOME by default: the hook's daily run now also drives the
  // machine-side upkeep (`workkit update --auto`), which reads
  // ~/Library/LaunchAgents and ~/.local/bin. Neither may ever be the
  // developer's own.
  const env = homeEnv(homeDir, {
    PATH: pathPrefix ? joinPath(pathPrefix, BASE_PATH) : joinPath(pathWithoutGh(), NODE_DIR),
    WORKFLOW_STANDARDS_CACHE: shellPath(cacheDir),
    // OUTSIDE the marker cache: the engine now seeds the user settings file on
    // every run, and a workflow-home nested in the cache would be counted by
    // the tests that assert one marker file per repo.
    WORKFLOW_HOME: shellPath(workflowHome || path.join(mkTmp(), 'workflow-home')),
    WORKFLOW_CLAUDE_HOME: shellPath(path.join(mkTmp(), 'claude-home')),
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
  HOOK, WORKFLOW_DIR, BASE_PATH, IGNORE_GLOB, mkTmp, cleanup, makeRepo, decline, runHook,
  dropPathWithoutGh,
};
