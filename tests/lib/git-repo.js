// A throwaway git repo on `main`: its own identity, one commit of the seeded
// files, the unfetched FIXTURE_ORIGIN every fixture repo carries, and a scratch
// home and TMPDIR so no child reads the real gitconfig. It is opted in to
// workkit, since the hook loader steps aside in a repo that is not. Consumers:
// red-proof, review-covers, commit-language, the loader; the commit-gate and
// script-shell fixtures. `mkOriginRepo` is the minimal form: an init and an
// origin, nothing committed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { shellPath, homeEnv } = require('./platform');
const { mkTmp } = require('./scratch');
const { WORKKIT_DIR } = require('./harness');

// The origin every fixture repo carries, never fetched: a repo without one is a
// throwaway the commit hooks skip.
const FIXTURE_ORIGIN = 'https://example.invalid/owner/repo.git';

// A repo's opt-in, committed with the seeded files unless `files` names its own.
const OPT_IN_FILE = `${WORKKIT_DIR}/settings.json`;
const OPT_IN = '{ "version": 1, "enabled": true }\n';

/**
 * A scratch world whose repo holds `files` in one commit.
 * @param {string} prefix - the scratch folder's name prefix
 * @param {object} files - root-relative path to content, all committed
 * @param {Date} [when] - the mtime every seeded file carries
 * @param {object} [opts]
 * @param {boolean} [opts.optIn=true] - false seeds no `.workkit/settings.json`
 * @returns {{dir: string, repo: string, tmp: string, env: object, git: Function, write: Function}}
 *   `git(...args)` runs in the repo and throws on a non-zero exit;
 *   `write(rel, body, when)` writes a file, dated `when` when given
 */
const mkRepo = (prefix, files, when, { optIn = true } = {}) => {
  const dir = mkTmp(prefix);
  const repo = path.join(dir, 'repo');
  const home = path.join(dir, 'home');
  const tmp = path.join(dir, 'tmp');
  for (const d of [repo, home, tmp]) fs.mkdirSync(d, { recursive: true });
  const env = homeEnv(home, { PATH: process.env.PATH, TMPDIR: shellPath(tmp) });
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
  const seeded = optIn ? { [OPT_IN_FILE]: OPT_IN, ...files } : files;
  for (const [rel, body] of Object.entries(seeded)) write(rel, body, when);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('remote', 'add', 'origin', FIXTURE_ORIGIN);
  return { dir, repo, tmp, env, git, write };
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

module.exports = { mkRepo, mkOriginRepo, FIXTURE_ORIGIN };
