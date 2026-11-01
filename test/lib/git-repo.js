// A throwaway git repo on `main`: its own identity, one commit of the seeded
// files, the unfetched FIXTURE_ORIGIN every fixture repo carries, and a scratch
// home and TMPDIR so no child reads the real gitconfig. It is opted in to
// workkit, since the hooks module stands down in a repo that is not. Consumers:
// every suite that needs a real repo (red-proof, review-covers, prove, slug, the
// identity and workkit-cli suites, the snapshot and command logic suites).
// `mkOriginRepo` is the minimal form: an init and an origin, nothing committed.
// `commitGh` is the `gh` a commit's own hooks ask (the githooks and release-taken
// suites): `issue view` and `release view` answered from fixtures.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { shellPath, homeEnv, stubTool } = require('./platform');
const { mkTmp, WORKKIT_DIR } = require('./harness');
const { recordArgv, readArgv } = require('./argv-log');
const { OPT_IN_SHAPES } = require('./mod-fixtures.mjs');

// The origin every fixture repo carries, never fetched: a repo without one is a
// throwaway the commit hooks skip.
const FIXTURE_ORIGIN = 'https://example.invalid/owner/repo.git';

// The opt-in committed with the seeded files unless `files` names its own.
const OPT_IN_FILE = `${WORKKIT_DIR}/settings.json`;

/**
 * A scratch world whose repo holds `files` in one commit.
 * @param {string} prefix - the scratch folder's name prefix
 * @param {object} files - root-relative path to content, all committed
 * @param {Date} [when] - the mtime every seeded file carries
 * @param {object} [opts]
 * @param {boolean} [opts.optIn=true] - false seeds no `.workkit/settings.json`
 * @returns {{dir: string, repo: string, tmp: string, workflowHome: string, env: object, git: Function, write: Function}}
 *   `workflowHome` is the home's `.workkit`, where the markers live;
 *   `git(...args)` runs in the repo and throws on a non-zero exit;
 *   `write(rel, body, when)` writes a file, dated `when` when given
 */
const mkRepo = (prefix, files, when, { optIn = true } = {}) => {
  const dir = mkTmp(prefix);
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  for (const d of [repo, home, tmp]) fs.mkdirSync(d, { recursive: true });
  const workflowHome = path.join(home, '.workkit');
  const env = homeEnv(home, { PATH: process.env.PATH, TMPDIR: shellPath(tmp), WORKFLOW_HOME: shellPath(workflowHome) });
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
  const seeded = optIn ? { [OPT_IN_FILE]: OPT_IN_SHAPES.current, ...files } : files;
  for (const [rel, body] of Object.entries(seeded)) write(rel, body, when);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', FIXTURE_ORIGIN);
  return { dir, repo, tmp, workflowHome, env, git, write };
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
 * A `gh` on its own bin folder, recording every call: `issue view <N>` prints
 * `issues[N]` whole as JSON (an unknown number exits 1), `release view <tag>`
 * prints the tag when `tags` holds it and "release not found" (exit 1) when not;
 * with `fails` every call exits 1 the way a signed-out gh does.
 * @param {object} [opts]
 * @param {object} [opts.issues] - issue number to its `--json` answer
 * @param {string[]} [opts.tags] - the release tags the repo carries
 * @param {boolean} [opts.fails]
 * @returns {{binDir: string, calls: Function}} `calls()` is every argv, in order
 */
const commitGh = ({ issues = {}, tags = [], fails = false } = {}) => {
  const dir = mkTmp('commit-gh-');
  const binDir = path.join(dir, 'bin');
  const issuesDir = path.join(dir, 'issues');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(issuesDir, { recursive: true });
  for (const [n, answer] of Object.entries(issues)) fs.writeFileSync(path.join(issuesDir, `${n}.json`), JSON.stringify(answer));
  const log = path.join(dir, 'gh.log');
  stubTool(binDir, 'gh', [
    '#!/usr/bin/env bash',
    recordArgv(log),
    ...(fails ? ["echo 'gh: To get started with GitHub CLI, please run: gh auth login' >&2", 'exit 1'] : []),
    'if [[ "$1 $2" == "issue view" ]]; then',
    `  cat "${shellPath(issuesDir)}/$3.json" 2>/dev/null || exit 1`,
    '  exit 0',
    'fi',
    'if [[ "$1 $2" == "release view" ]]; then',
    `  case " ${tags.join(' ')} " in *" $3 "*) echo "$3"; exit 0 ;; esac`,
    "  echo 'release not found' >&2",
    '  exit 1',
    'fi',
    'exit 0',
  ]);
  return { binDir, calls: () => readArgv(log) };
};

module.exports = { mkRepo, mkOriginRepo, commitGh, FIXTURE_ORIGIN, OPT_IN_SHAPES };
