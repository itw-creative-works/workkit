// The red-proof snapshot as the tests see it: where a repo's snapshot lives,
// a hand-made one in its layout (`tree/`, `head`, `paths`, `issues`), and a
// tree walked into a comparable map. Consumers: the red-proof suite, which
// makes its snapshots here, and the workflow:snapshot suite, which reads them.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { IS_WINDOWS, BASH, NO_RC, shellPath } = require('./platform');

const PLATFORM = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));

/**
 * The snapshot folder of the repo at `root`, under the scratch `tmp`:
 * `wk_marker_path claude-red-snapshot <root>` with TMPDIR at `tmp` and the
 * root spelled as `pwd -P` prints it there.
 * @param {string} tmp - the case's own TMPDIR, native
 * @param {string} root - the repo root, native
 * @returns {string} the folder, native
 */
const snapshotDir = (tmp, root) => {
  const res = spawnSync(BASH, [...NO_RC, '-c',
    'cd "$1" && . "$2" && wk_marker_path claude-red-snapshot "$(pwd -P)"', '_', shellPath(root), PLATFORM], {
    env: { PATH: process.env.PATH, TMPDIR: shellPath(tmp) }, encoding: 'utf8',
  });
  if (res.status !== 0 || !res.stdout.trim()) throw new Error(`wk_marker_path failed: ${res.stderr}`);
  return path.join(tmp, 'claude-red-snapshot', path.basename(res.stdout.trim()));
};

/** The `node_modules` rule: Windows leaves every such folder out of a snapshot. */
const isModules = (name) => name === 'node_modules';

/**
 * Every path under `root` but `.git` (and each `node_modules` when
 * `skipModules`), mapped to its link target, `dir`, or its content.
 * @param {string} root
 * @param {{skipModules?: boolean}} [opts]
 * @returns {object}
 */
const treeOf = (root, { skipModules = false } = {}) => {
  const seen = {};
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
      const sub = path.join(rel, name);
      if (sub === '.git' || (skipModules && isModules(name))) continue;
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
 * folder without `.git` as `tree/`, HEAD's sha, the working-change list
 * (NUL-separated: the diff against HEAD, then the untracked files) and the
 * issue numbers, one a line.
 * @param {{repo: string, tmp: string, git: Function}} w
 * @param {{issues?: string[], skipModules?: boolean}} [opts] - `skipModules`
 *   leaves out every `node_modules` folder, as the Windows copy does
 * @returns {string} the snapshot folder
 */
const takeSnapshot = (w, { issues = ['5'], skipModules = IS_WINDOWS } = {}) => {
  const dir = snapshotDir(w.tmp, w.repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(w.repo, path.join(dir, 'tree'), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (src) => src !== path.join(w.repo, '.git') && !(skipModules && isModules(path.basename(src))),
  });
  fs.writeFileSync(path.join(dir, 'head'), `${w.git('rev-parse', 'HEAD').trim()}\n`);
  const paths = w.git('diff', 'HEAD', '--name-only', '--no-renames', '-z')
    + w.git('ls-files', '--others', '--exclude-standard', '-z');
  fs.writeFileSync(path.join(dir, 'paths'), paths);
  fs.writeFileSync(path.join(dir, 'issues'), issues.map((n) => `${n}\n`).join(''));
  return dir;
};

module.exports = { snapshotDir, treeOf, takeSnapshot };
