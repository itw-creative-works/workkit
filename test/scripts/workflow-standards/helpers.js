// The shared prologue of the standards heal suites beside this one, which test
// workflow/labels.json and workflow/standards.js. Every `gh` call reaches a PATH
// shim that records its arguments and answers from a fixture, so nothing here
// touches the network or a real repository.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { WORKKIT_DIR: W, mkTmp, run } = require('../../lib/harness');
const {
  IS_WINDOWS, SYSTEM_PATH, NODE_DIR, gitPath, basePathWithout, joinPath,
} = require('../../lib/platform');
const { readArgv } = require('../../lib/argv-log');
const { writeGh } = require('../../lib/gh-stub');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'standards.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'labels.json'), 'utf8'));

// The two .gitignore lines the engine writes, built from the harness constant
// so the directory's name is spelled out in exactly one place here too.
const W_RE = W.replace(/\./g, '\\.');
const IGNORE_GLOB = new RegExp(`^${W_RE}/\\*$`, 'm');
const IGNORE_GLOB_ALL = new RegExp(`^${W_RE}/\\*$`, 'gm');
const IGNORE_NEGATION = new RegExp(`^!${W_RE}/settings\\.json$`, 'm');

// Every group:value pair the manifest asks for, with its resolved color.
const desiredLabels = () => {
  const out = [];
  for (const [groupName, groupBody] of Object.entries(MANIFEST.groups)) {
    for (const [value, body] of Object.entries(groupBody.values)) {
      out.push({
        name: `${groupName}:${value}`,
        description: body.description,
        color: body.color || groupBody.color,
      });
    }
  }
  return out;
};

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// The roster and the declines, out of the machine-maintained `.repos.json`:
// absent until the engine has something to record there.
const rosterOf = (home) => {
  const file = path.join(home, '.repos.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).repos || {}) : {};
};

// The roster key a repo takes on Windows: git's spelling of its root.
const winRosterKey = (repo) => gitPath(fs.realpathSync(repo));

// A git repo with an origin remote: the shape the script expects. No commits
// are made and the remote is never contacted (gh is stubbed).
// Participation: the committed .workkit/settings.json is the repo's yes, so
// every fixture carries one unless a test is exercising another state.
const makeRepo = ({ remote = true, settings = OPT_IN_SHAPES.current } = {}) => {
  const dir = mkTmp('wf-std-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (remote) {
    spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/alice/repo.git'], { cwd: dir });
    // As a clone has it, so the default branch reads without GitHub.
    spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], { cwd: dir });
  }
  if (settings !== null) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// PATH shim: records each `gh` invocation with its argument boundaries (a label
// description has spaces, so an unquoted expansion must not pass) and answers
// `label list` and `issue list` from fixtures, through answerStandards.
const makeGhStub = ({
  labels = [], issues = [], authed = true, createFails = false, editFails = false,
  // `labeled` maps a label name to the issues carrying it, so
  // `gh issue list --label <name>` answers per label instead of handing back
  // the whole fixture. `labelQueryFails` makes that query fail.
  labeled = {}, labelQueryFails = false,
  // Branch protection: 'absent' (404s, PUT accepted), 'present' (GET answers
  // `protectionBody`, empty by default), 'denied' (404s, PUT rejected: the
  // free-plan private repo), 'unreadable' (GET rate-limited, PUT accepted).
  // `patchFails` refuses the PATCH; `remoteChecks`: checks.yml, null a 404.
  protection = 'absent', protectionBody = '', patchFails = false, remoteChecks = null,
  // `repoRead`: answer the repo's REST read, `defaultBranch` its branch; off by
  // default, so a case meets the "cannot resolve" bail-out unless it opts in.
  repoRead = false, defaultBranch = 'main',
} = {}) => {
  const dir = mkTmp('wf-std-');
  const logFile = path.join(dir, 'gh.log');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  writeGh(binDir, {
    log: logFile,
    answer: { module: require.resolve('./standards-answers'), name: 'answerStandards' },
    config: {
      labels, issues, authed, createFails, editFails, labelQueryFails,
      // An entry is a bare number, or a whole object when the fields matter (the
      // stale-claim sweep reads updatedAt and assignees).
      labeled: Object.fromEntries(Object.entries(labeled).map(([label, numbers]) => [
        label, numbers.map((n) => (typeof n === 'object' ? n : { number: n })),
      ])),
      protection, protectionBody, patchFails, remoteChecks, repoRead, defaultBranch,
      putBody: path.join(dir, 'put-body.json'),
      patchBody: path.join(dir, 'patch-body.json'),
    },
  });
  return { binDir, logFile, dir };
};

const readFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// A PATH holding every tool the script needs except one, built rather than
// assumed, since where a tool lives varies by machine.
const pathWithout = (excluded) => basePathWithout(mkTmp('wf-std-'), excluded);

// This machine's own folders, which no heal a case starts may reach.
const MACHINE_FOLDERS = ['.workkit', '.claude'].map((name) => path.join(os.homedir(), name));
const within = (folder, own) => {
  const rel = path.relative(own, path.resolve(folder));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * <env> for a kit program a case starts: the workflow home and the claude home
 * are scratch folders (the claude home left unmade) unless <env> names its own.
 * Throws when either resolves to this machine's own ~/.workkit or ~/.claude,
 * named, or reached through HOME (USERPROFILE on Windows) or its absence.
 * @param {object} env - the case's env, every path native
 * @returns {object} the env to start the program with
 */
const seededEnv = (env) => {
  const scratch = mkTmp('wf-std-');
  const seeded = {
    WORKFLOW_HOME: path.join(scratch, 'workflow-home'),
    WORKFLOW_CLAUDE_HOME: path.join(scratch, 'claude-home'),
    ...env,
  };
  const home = (IS_WINDOWS ? seeded.USERPROFILE : seeded.HOME) || os.homedir();
  for (const folder of [seeded.WORKFLOW_HOME || path.join(home, '.workkit'), seeded.WORKFLOW_CLAUDE_HOME || path.join(home, '.claude')]) {
    const own = MACHINE_FOLDERS.find((machine) => within(folder, machine));
    if (own) throw new Error(`a kit program this case starts would reach this machine's own ${own} (as ${folder}); give the case a folder of its own`);
  }
  return seeded;
};

/**
 * The heal as a person or a hook starts it: `node <engine> <args>`, under this
 * suite's node, so no PATH a case narrows hides it, its env seeded (seededEnv).
 * Every path in `env` is native, as a node reads it. `engine` is a copy's
 * standards.js, this checkout's by default.
 * @returns {{status: ?number, stdout: string, stderr: string, output: string}}
 */
const heal = (args, env, { engine = SCRIPT, cwd, preload } = {}) => run(process.execPath,
  [...(preload ? ['-r', preload] : []), engine, ...args], { env: seededEnv(env), cwd });

// `pathPrefix: null` runs with no gh on PATH (the offline machine). WORKFLOW_HOME
// and the claude home are always throwaway directories.
const runScript = (repoDir, {
  pathPrefix, args = [], workflowHome, claudeHome, hooksDir, env = {},
} = {}) => {
  // node is on the PATH of any machine running this standard (the engine lints
  // CHANGELOGs with it), so the default PATH carries it; a test proving a
  // missing tool builds its own PATH with pathWithout().
  const basePath = joinPath(SYSTEM_PATH, NODE_DIR);
  const res = heal([...args, repoDir], {
    ...process.env,
    PATH: pathPrefix ? joinPath(pathPrefix, basePath) : basePath,
    // Unset means the real hook layer beside the engine, which is what most
    // of this suite runs against; the self-check tests point at a fixture.
    ...(hooksDir ? { WORKFLOW_HOOKS_DIR: hooksDir } : {}),
    WORKFLOW_HOME: workflowHome || path.join(mkTmp('wf-std-'), 'workflow-home'),
    // Same rule as WORKFLOW_HOME for the engine's address symlink: the step
    // that maintains ~/.claude/workkit must never reach the real ~/.claude.
    WORKFLOW_CLAUDE_HOME: claudeHome || path.join(mkTmp('wf-std-'), 'claude-home'),
    // Last, so a case's own keys win over the environment this suite inherited.
    ...env,
  });
  // The engine keeps stdout for machine-readable answers (--state, --announce)
  // and sends every diagnostic to stderr. `output` is what a human sees in a
  // terminal: assert human-facing lines against it, and stdout only when the
  // test cares that something is machine-readable.
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { code: res.status, stdout, stderr, output: stdout + stderr };
};

// A scratch home holding a real `.claude`, so the heal makes the engine's
// address there; `claude` is the folder to pass as `claudeHome`.
const claudeHomeWith = () => {
  const home = mkTmp('wf-std-');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return { home, claude: path.join(home, '.claude') };
};

// The same, its `workkit` already linked at this checkout's workflow folder,
// as `~/.claude/workkit` stands on a machine.
const linkedClaudeHome = () => {
  const made = claudeHomeWith();
  const link = path.join(made.claude, 'workkit');
  fs.symlinkSync(path.resolve(WORKFLOW_DIR), link, 'junction');
  return { ...made, link };
};

// The kit folders a copied engine at <root>/workflow reads beside it, as a real
// kit has them: the defaults its settings come through, the hooks, and the
// runner library the hooks module loads.
const copyKitSiblings = (root) => {
  for (const folder of ['defaults', 'hooks', path.join('packages', 'core')]) {
    fs.cpSync(path.join(WORKFLOW_DIR, '..', folder), path.join(root, folder), { recursive: true });
  }
};

module.exports = {
  copyKitSiblings, WORKFLOW_DIR, SCRIPT, MANIFEST, IGNORE_GLOB, IGNORE_GLOB_ALL, IGNORE_NEGATION,
  desiredLabels, cleanup, rosterOf, winRosterKey, makeRepo, makeGhStub, readFile, ghCalls,
  pathWithout, seededEnv, heal, runScript, claudeHomeWith, linkedClaudeHome,
};
