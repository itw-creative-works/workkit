// The throwaway git repo the script suites run against: a repo on `main` with
// its own identity and one commit of the files a suite seeds, beside a scratch
// home and TMPDIR, so no child reads the developer's gitconfig or leaves a
// file in the real temp dir. Consumers: the red-proof and review-covers suites.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { shellPath, homeEnv } = require('./platform');
const { mkTmp } = require('./scratch');

/**
 * A scratch world whose repo holds `files` in one commit.
 * @param {string} prefix - the scratch folder's name prefix
 * @param {object} files - root-relative path to content, all committed
 * @param {Date} [when] - the mtime every seeded file carries
 * @returns {{dir: string, repo: string, tmp: string, env: object, git: Function, write: Function}}
 *   `git(...args)` runs in the repo and throws on a non-zero exit;
 *   `write(rel, body, when)` writes a file, dated `when` when given
 */
const mkRepo = (prefix, files, when) => {
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
  for (const [rel, body] of Object.entries(files)) write(rel, body, when);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { dir, repo, tmp, env, git, write };
};

module.exports = { mkRepo };
