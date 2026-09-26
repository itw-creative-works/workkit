//
// The shared prologue of the standards heal suites, the `*.test.js` files
// beside this one, which test workflow/: the label vocabulary manifest
// (labels.json) and the repo standards script (standards.sh). A plain module,
// never a suite: the runner only loads files ending in `.test.js`.
//
// The script's label step talks to GitHub through `gh`; every test here runs
// against a PATH shim that records its arguments and answers from a fixture, so
// nothing in these suites touches the network or a real repository.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { WORKKIT_DIR: W } = require('../../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_PATH, NODE_DIR, NO_RC, shellPath, gitPath, stubTool, basePathWithout,
  joinPath,
} = require('../../lib/platform');
const { recordArgv, readArgv } = require('../../lib/argv-log');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '..', 'workflow');
const SCRIPT = path.join(WORKFLOW_DIR, 'standards.sh');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, 'labels.json'), 'utf8'));

// The two .gitignore lines the engine writes, built from the harness constant
// so the directory's name is spelled out in exactly one place here too.
const W_RE = W.replace(/\./g, '\\.');
const IGNORE_GLOB = new RegExp(`^${W_RE}/\\*$`, 'm');
const IGNORE_GLOB_ALL = new RegExp(`^${W_RE}/\\*$`, 'gm');
const IGNORE_NEGATION = new RegExp(`^!${W_RE}/settings\\.json$`, 'm');

// The hooks' copy of the name, checked against the harness by the drift test.
const HOOK_LIB = path.join(__dirname, '..', '..', '..', 'hooks', '_lib.sh');

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

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wf-std-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// The roster and the declines, out of the machine-maintained `.repos.json`:
// absent until the engine has something to record there (issue #80).
const rosterOf = (home) => {
  const file = path.join(home, '.repos.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).repos || {}) : {};
};

// The roster key a repo takes on the WINDOWS branch: git's spelling of its
// root. On Windows this machine's own cygpath answers; off it, the seam's stub
// does, prefixing the drive letter the MSYS root maps to (tests/lib/platform.js).
const winRosterKey = (repo) => (IS_WINDOWS
  ? gitPath(fs.realpathSync(repo))
  : `C:${fs.realpathSync(repo)}`);

// A git repo with an origin remote: the shape the script expects. No commits
// are made and the remote is never contacted (gh is stubbed).
// Participation: the committed .workkit/settings.json is the repo's yes, so
// every fixture carries one unless a test is exercising another state.
const makeRepo = ({ remote = true, settings = '{ "version": 1, "enabled": true }\n' } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (remote) {
    spawnSync('git', ['remote', 'add', 'origin', 'https://example.invalid/alice/repo.git'], { cwd: dir });
  }
  if (settings !== null) {
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), settings);
  }
  return dir;
};

// PATH shim: records each `gh` invocation, answers `label list` and
// `issue list` from fixtures. The recording keeps argument boundaries (see
// tests/lib/argv-log.js): a label description is a phrase with spaces, and
// losing the boundary would make an unquoted expansion in the script
// indistinguishable from a correct call.
const makeGhStub = ({
  labels = [], issues = [], authed = true, createFails = false, editFails = false,
  // `labeled` maps a label name to the issues carrying it, so
  // `gh issue list --label <name>` answers per label instead of handing back
  // the whole fixture. `labelQueryFails` makes that query fail.
  labeled = {}, labelQueryFails = false,
  // Branch-protection knobs. `protection`: 'absent' (404s, PUT accepted),
  // 'present' (GET succeeds), or 'denied' (404s, PUT rejected: the free-plan
  // private repo). `repoView`: answer `gh repo view` with a real owner/branch;
  // off by default so every older test exercises the "cannot resolve" bail-out.
  protection = 'absent', repoView = false,
} = {}) => {
  const dir = mkTmp();
  const logFile = path.join(dir, 'gh.log');
  const labelsFile = path.join(dir, 'labels.json');
  const issuesFile = path.join(dir, 'issues.json');
  fs.writeFileSync(labelsFile, JSON.stringify(labels));
  fs.writeFileSync(issuesFile, JSON.stringify(issues));
  // An entry is a bare number when the caller only cares which issues carry the
  // label, or a whole object when the fields matter (the stale-claim sweep
  // reads updatedAt and assignees).
  // A label name is never a file name: the colon in `agent:working` opens an
  // NTFS alternate data stream on Windows instead of creating a file, and the
  // shell cannot see one at all, so every label query would answer the empty
  // list there. The fixtures are numbered and the stub LOOKS ITS LABEL UP, so
  // the name lives in the case pattern and the path is spelled once, here.
  const labelFixtures = Object.entries(labeled).map(([label, numbers], i) => {
    const file = path.join(dir, `issues-${i}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(numbers.map((n) => (typeof n === 'object' ? n : { number: n }))),
    );
    return { label, file };
  });
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(logFile),
    'if [[ "$1 $2" == "auth status" ]]; then',
    `  exit ${authed ? 0 : 1}`,
    'fi',
    'if [[ "$1 $2" == "label list" ]]; then',
    `  cat "${labelsFile}"`,
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "issue list" ]]; then',
    // A --label query asks who carries one label; without it this is the
    // whole-repo report, which gets the full fixture.
    '  want=""; prev=""',
    '  for a in "$@"; do [[ "$prev" == "--label" ]] && want="$a"; prev="$a"; done',
    '  if [[ -z "$want" ]]; then',
    `    cat "${issuesFile}"`,
    '    exit 0',
    '  fi',
    ...(labelQueryFails ? ['  exit 1'] : []),
    '  case "$want" in',
    ...labelFixtures.map(({ label, file }) => `    '${label}') cat "${shellPath(file)}" ;;`),
    '    *) echo "[]" ;;',
    '  esac',
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "issue edit" ]]; then',
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "label create" ]]; then',
    `  exit ${createFails ? 1 : 0}`,
    'fi',
    'if [[ "$1 $2" == "label edit" ]]; then',
    `  exit ${editFails ? 1 : 0}`,
    'fi',
    'if [[ "$1" == "repo" && "$2" == "view" ]]; then',
    ...(repoView ? [
      '  if [[ "$*" == *nameWithOwner* ]]; then echo "stub/repo"; fi',
      '  if [[ "$*" == *defaultBranchRef* ]]; then echo "main"; fi',
      '  exit 0',
    ] : ['  exit 0']),
    'fi',
    'if [[ "$1" == "api" ]]; then',
    '  if [[ "$*" == *"-X PUT"* ]]; then',
    `    cat > "${path.join(dir, 'put-body.json')}"`,
    `    exit ${protection === 'denied' ? 1 : 0}`,
    '  fi',
    // A real 404 answers with this text; the heal must see it to distinguish
    // "unprotected" from a transient failure it must not write over.
    ...(protection === 'present' ? ['  exit 0'] : ['  echo "gh: Branch not protected (HTTP 404)" >&2', '  exit 1']),
    'fi',
    'exit 0',
  ]);
  return { binDir, logFile, dir };
};

const readFile = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
// One argv array per recorded `gh` invocation.
const ghCalls = (stub) => readArgv(stub.logFile);

// `pathPrefix: null` means run with no gh on PATH at all (the offline machine).
// WORKFLOW_HOME always points at a throwaway directory: the user-level
// settings file this script writes must never be the real ~/.workkit.
// A PATH holding every tool the script needs EXCEPT one. `command -v <tool>`
// searches every PATH entry, so the only way to prove the missing-tool branch
// is to build the PATH: where a tool lives varies by machine (a CI runner keeps
// gh in /usr/bin, Homebrew does not), and a test that assumed a layout was
// testing the host instead of the script. The seam builds and checks it.
const binDirWithout = (excluded) => basePathWithout(mkTmp(), excluded);

const runScript = (repoDir, {
  pathPrefix, args = [], workflowHome, claudeHome, hooksDir, env = {},
} = {}) => {
  // node is on the PATH of any machine running this standard (the engine lints
  // CHANGELOGs with it, and so does the hook layer), so the default PATH
  // carries it. A test proving what happens WITHOUT a tool builds its own PATH
  // with binDirWithout(): the suite's idiom for exactly that.
  const basePath = joinPath(SYSTEM_PATH, NODE_DIR);
  const res = spawnSync(BASH, [...NO_RC, shellPath(SCRIPT), ...args, shellPath(repoDir)], {
    env: {
      ...process.env,
      PATH: pathPrefix ? joinPath(pathPrefix, basePath) : basePath,
      // Unset means the real hook layer beside the engine, which is what most
      // of this suite runs against; the self-check tests point at a fixture.
      ...(hooksDir ? { WORKFLOW_HOOKS_DIR: shellPath(hooksDir) } : {}),
      WORKFLOW_HOME: shellPath(workflowHome || path.join(mkTmp(), 'workflow-home')),
      // Same rule as WORKFLOW_HOME for the engine's address symlink: the step
      // that maintains ~/.claude/workkit must never reach the real ~/.claude.
      WORKFLOW_CLAUDE_HOME: shellPath(claudeHome || path.join(mkTmp(), 'claude-home')),
      // Last, so a case driving another platform's branch (OSTYPE) wins over
      // the environment this suite inherited.
      ...env,
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  // The engine keeps stdout for machine-readable answers (--state, --announce)
  // and sends every diagnostic to stderr. `output` is what a human sees in a
  // terminal: assert human-facing lines against it, and stdout only when the
  // test cares that something IS machine-readable.
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { code: res.status, stdout, stderr, output: stdout + stderr };
};

// The standard version the engine stamps, and the one a repo carries.
const STANDARD_VERSION = Number(
  /^STANDARD_VERSION=(\d+)/m.exec(fs.readFileSync(SCRIPT, 'utf8'))[1],
);
const repoVersion = (dir) => JSON.parse(readFile(path.join(dir, W, 'settings.json'))).version;

module.exports = {
  WORKFLOW_DIR, SCRIPT, MANIFEST, IGNORE_GLOB, IGNORE_GLOB_ALL, IGNORE_NEGATION, HOOK_LIB,
  desiredLabels, mkTmp, cleanup, rosterOf, winRosterKey, makeRepo, makeGhStub, readFile, ghCalls,
  binDirWithout, runScript, STANDARD_VERSION, repoVersion,
};
