// A throwaway git repo on `main` for every suite that needs a real one: its own
// identity, one commit of the seeded files, the unfetched FIXTURE_ORIGIN, a
// scratch home and TMPDIR so no child reads the real gitconfig, and opted in to
// workkit, since the hooks module stands down in a repo that is not.
// `mkOriginRepo` is the minimal form: an init and an origin, nothing committed.
// `commitGh` is the `gh` the commit hooks, `workkit ship cut` and the CI release
// scan ask: `issue view`, `release view`, `release create`, `run list` and
// `workflow run` answered from fixtures.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { homeEnv, nodeHomeEnv, nodeTempEnv } = require('./platform');
const { mkTmp, WORKKIT_DIR } = require('./harness');
const { readArgv } = require('./argv-log');
const { ghJq } = require('./gh-jq');
const { writeGh } = require('./gh-stub');
const { OPT_IN_SHAPES } = require('./mod-fixtures.mjs');

// The origin every fixture repo carries, never fetched: a repo without one is a
// throwaway the commit hooks skip.
const FIXTURE_ORIGIN = 'https://example.invalid/owner/repo.git';

// The opt-in committed with the seeded files unless `files` names its own.
const OPT_IN_FILE = `${WORKKIT_DIR}/settings.json`;

// What the fake gh's refused `workflow run` prints, as an Actions token without write gets.
const DISPATCH_REFUSAL = 'could not create workflow dispatch event: HTTP 403: Resource not accessible by integration';

/**
 * A scratch world whose repo holds `files` in one commit.
 * @param {string} prefix - the scratch folder's name prefix
 * @param {object} files - root-relative path to content, all committed
 * @param {Date} [when] - the mtime every seeded file carries
 * @param {{optIn?: boolean, forNode?: boolean}} [opts] - `optIn` false seeds no
 *   `.workkit/settings.json`; `forNode` makes `env` a node's, the home native and
 *   `tmp` its temp folder under every name (nodeTempEnv), for a case reading back what a run left there
 * @returns {{dir: string, repo: string, tmp: string, workflowHome: string, env: object, git: Function, write: Function}}
 *   `workflowHome` is the home's `.workkit`, where the markers live; `git(...args)` runs in
 *   the repo under the shell's env and throws on a non-zero exit; `write(rel, body, when)` writes a file
 */
const mkRepo = (prefix, files, when, { optIn = true, forNode = false } = {}) => {
  const dir = mkTmp(prefix);
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  for (const d of [repo, home, tmp]) fs.mkdirSync(d, { recursive: true });
  const workflowHome = path.join(home, '.workkit');
  const vars = { PATH: process.env.PATH, TMPDIR: tmp, WORKFLOW_HOME: workflowHome };
  const env = homeEnv(home, vars);
  const git = (...args) => {
    const res = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return res.stdout;
  };
  const write = (rel, body, at) => {
    const file = path.join(repo, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    if (at) fs.utimesSync(file, at, at);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  // Git for Windows' system config turns autocrlf on and the scratch home hides CI's global off,
  // so a file git writes back holds HEAD's bytes on every platform.
  git('config', 'core.autocrlf', 'false');
  const seeded = optIn ? { [OPT_IN_FILE]: OPT_IN_SHAPES.current, ...files } : files;
  for (const [rel, body] of Object.entries(seeded)) write(rel, body, when);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', FIXTURE_ORIGIN);
  return {
    dir, repo, tmp, workflowHome, env: forNode ? nodeTempEnv(tmp, nodeHomeEnv(home, vars)) : env, git, write,
  };
};

/**
 * A plain `git init` in `dir` with `origin` as its one remote, no commit: what a
 * slug or kit-checkout read needs and nothing more.
 * @param {string} dir - an existing folder
 * @param {string} origin - the origin URL
 * @returns {string} `dir`
 */
const mkOriginRepo = (dir, origin) => {
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', origin]]) {
    const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
  }
  return dir;
};

/**
 * A recording `gh` on its own bin folder, every answer from `opts`: `issue view <N>`
 * prints `issues[N]` as JSON (unknown: exit 1); `release view <tag>` runs `onView`
 * (JavaScript, given `argv`, the call's arguments, and `require`), then prints the tag when `tags` holds it
 * or `late` (tag to its "not found" misses) has spent them, else "release not found",
 * exit 1; `release create` runs `onCreate` (JavaScript, as `onView`), prints
 * `createSays` on stderr, exits `createExit`; `run list` prints `runs` as JSON, through
 * ghJq for `--jq`/`-q`; `workflow run <file>` exits 1 with a refusal on stderr when
 * `dispatchFails` names the file, else 0; with `fails` every call exits 1 the way a signed-out gh does.
 * @param {object} [opts]
 * @returns {{binDir: string, calls: Function}} `calls()` is every argv, in order
 */
const commitGh = ({
  issues = {}, tags = [], late = {}, fails = false, createExit = 0, createSays = '', onCreate = '', onView = '', runs = [], dispatchFails = [],
} = {}) => {
  const dir = mkTmp('commit-gh-');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  // The misses left per tag, which each view spends.
  const lateFile = path.join(dir, 'late.json');
  fs.writeFileSync(lateFile, JSON.stringify(late));
  const log = path.join(dir, 'gh.log');
  writeGh(binDir, {
    log,
    answer: { module: __filename, name: 'answerCommitGh' },
    config: {
      issues, tags, lateFile, fails, createExit, createSays, onCreate, onView, runs, dispatchFails,
    },
  });
  return { binDir, calls: () => readArgv(log) };
};

/** The value after the last `-q`/`--jq` in `argv`, or '' when none is given. */
const jqOf = (argv) => argv.reduce((q, arg, i) => (argv[i - 1] === '-q' || argv[i - 1] === '--jq' ? arg : q), '');

/**
 * commitGh's answer to one call, its options as `config`; what it prints, and its exit code.
 * @returns {number}
 */
const answerCommitGh = ({
  issues, tags, lateFile, fails, createExit, createSays, onCreate, onView, runs, dispatchFails,
}, argv) => {
  const say = (text) => process.stdout.write(text);
  const complain = (text) => process.stderr.write(text);
  // A Function body sees only globals, so the call's argv and `require` are handed in.
  const runHook = (source) => new Function('argv', 'require', source)(argv, require);
  if (fails) {
    complain('gh: To get started with GitHub CLI, please run: gh auth login\n');
    return 1;
  }
  const command = `${argv[0]} ${argv[1]}`;
  const tag = argv[2];
  if (command === 'issue view') {
    if (!Object.hasOwn(issues, String(tag))) return 1;
    say(JSON.stringify(issues[tag]));
    return 0;
  }
  if (command === 'release view') {
    runHook(onView);
    if (tags.includes(tag)) { say(`${tag}\n`); return 0; }
    const late = JSON.parse(fs.readFileSync(lateFile, 'utf8'));
    if (Object.hasOwn(late, String(tag))) {
      if (late[tag] <= 0) { say(`${tag}\n`); return 0; }
      late[tag] -= 1;
      fs.writeFileSync(lateFile, JSON.stringify(late));
    }
    complain('release not found\n');
    return 1;
  }
  if (command === 'release create') {
    runHook(onCreate);
    if (createSays) complain(`${createSays}\n`);
    return createExit;
  }
  if (command === 'run list') {
    const q = jqOf(argv);
    say(q ? ghJq(q, runs) : JSON.stringify(runs));
    return 0;
  }
  if (command === 'workflow run' && dispatchFails.includes(tag)) {
    complain(`${DISPATCH_REFUSAL}\n`);
    return 1;
  }
  return 0;
};

module.exports = {
  mkRepo, mkOriginRepo, commitGh, answerCommitGh, FIXTURE_ORIGIN, OPT_IN_SHAPES,
};
