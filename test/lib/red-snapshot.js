// The red-proof snapshot as the tests see it: where a repo's snapshot lives,
// a hand-made one in its layout (`tree/`, `head`, `paths`, `issues`), and a
// tree walked into a comparable map. Consumers: the red-proof suite, which
// makes its snapshots here, and the workflow:snapshot suite, which reads them.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { BASH, NO_RC, shellPath } = require('./platform');
const { homeOf, cacheBase } = require('./workflow-home');

/**
 * The folder every snapshot lives under, `<home>/.cache/workkit/snapshot`.
 * @param {string} home - the HOME, native
 * @returns {string}
 */
const snapshotBase = (home) => path.join(cacheBase(home), 'snapshot');

/**
 * The name of the snapshot folder of the repo at `root`: the SHA-1 of the root
 * spelled as `pwd -P` prints it in the shell.
 * @param {string} root - the repo root, native
 * @returns {string}
 */
const snapshotKey = (root) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', 'cd -P "$1" && pwd -P', '_', shellPath(root)], {
    env: { PATH: process.env.PATH }, encoding: 'utf8',
  });
  if (res.status !== 0 || !res.stdout.trim()) throw new Error(`pwd -P failed: ${res.stderr}`);
  return crypto.createHash('sha1').update(res.stdout.replace(/\n$/, '')).digest('hex');
};

/**
 * The snapshot folder of the repo at `root` under the scratch HOME `home`.
 * @param {string} home - the case's own HOME, native
 * @param {string} root - the repo root, native
 * @returns {string} the folder, native
 */
const snapshotDir = (home, root) => path.join(snapshotBase(home), snapshotKey(root));

/**
 * The folders under `root` holding a package.json git sees (tracked, or
 * untracked and not ignored), none under a `node_modules`; `.` is the root.
 * Empty when `root` is in no git work tree, as a snapshot's `tree/` is.
 * @param {string} root - native
 * @returns {Set<string>} each folder, native and root-relative
 */
const packageDirs = (root) => {
  const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8',
  });
  if (res.status !== 0) return new Set();
  const rels = res.stdout.split('\0').filter(Boolean).map((rel) => rel.split('/'));
  return new Set(rels
    .filter((parts) => parts[parts.length - 1] === 'package.json' && !parts.includes('node_modules'))
    .map((parts) => path.dirname(path.join(...parts))));
};

/** The `node_modules` rule: a snapshot leaves out a package's `node_modules` only, on every platform. */
const isModules = (rel, pkgs) => path.basename(rel) === 'node_modules' && pkgs.has(path.dirname(rel));

/**
 * Every path under `root` but `.git` (and each package's `node_modules` when
 * `skipModules`), mapped to its link target, `dir`, or its content.
 * @param {string} root
 * @param {{skipModules?: boolean}} [opts]
 * @returns {object}
 */
const treeOf = (root, { skipModules = false } = {}) => {
  const seen = {};
  const pkgs = skipModules ? packageDirs(root) : new Set();
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const sub = path.join(rel, name);
      if (sub === '.git' || isModules(sub, pkgs)) continue;
      const st = fs.lstatSync(path.join(root, sub));
      if (st.isSymbolicLink()) seen[sub] = `link ${fs.readlinkSync(path.join(root, sub))}`;
      else if (st.isDirectory()) { seen[sub] = 'dir'; walk(sub); }
      else seen[sub] = `file ${fs.readFileSync(path.join(root, sub), 'utf8')}`;
    }
  };
  walk('');
  return seen;
};

/**
 * Take the snapshot of a `mkRepo` world by hand, as the claim would: the repo
 * folder without `.git` or any package's `node_modules` as `tree/`, HEAD's sha, the
 * working-change list (NUL-separated: the diff against HEAD, then the
 * untracked files) and the issue numbers, one a line; in the repo's snapshot
 * folder under the world's HOME.
 * @param {{repo: string, workflowHome: string, git: Function}} w
 * @param {{issues?: string[]}} [opts]
 * @returns {string} the snapshot folder
 */
const takeSnapshot = (w, { issues = ['5'] } = {}) => {
  const dir = snapshotDir(homeOf(w), w.repo);
  fs.mkdirSync(dir, { recursive: true });
  const pkgs = packageDirs(w.repo);
  fs.cpSync(w.repo, path.join(dir, 'tree'), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => src !== path.join(w.repo, '.git') && !isModules(path.relative(w.repo, src), pkgs),
  });
  fs.writeFileSync(path.join(dir, 'head'), `${w.git('rev-parse', 'HEAD').trim()}\n`);
  const paths = w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
    + w.git('ls-files', '--others', '--exclude-standard', '-z');
  fs.writeFileSync(path.join(dir, 'paths'), paths);
  fs.writeFileSync(path.join(dir, 'issues'), issues.map((n) => `${n}\n`).join(''));
  return dir;
};

module.exports = {
  snapshotBase, snapshotKey, snapshotDir, treeOf, takeSnapshot,
};
