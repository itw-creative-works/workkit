#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/tree-hash.js: the one home of the tree ids the suite and package
// records hold: the working tree's, a package's own (less the workspace members
// it cannot see, lib/workspaces.js), and the real index's, each less `.workkit`.
// Run by the hooks (treeHash in hooks/mods/suite.js); npm's script shell
// (script-shell.js) and workflow/prove.js require it.
// Usage: node tree-hash.js <root> [<pkg>] | <root> -i

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('./run');

/** git in the root, under `index` when given; the trimmed stdout, or null when it fails. */
const git = (root, args, index) => {
  const env = index ? { ...process.env, GIT_INDEX_FILE: index } : process.env;
  const res = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? String(res.stdout).trim() : null;
};

/** `fn(dir)` in a new scratch folder under the temp folder, removed after. */
const inScratch = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-index.'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * `from` copied to `to` with its times kept, which git's racy check reads: a
 * file edited in the index's own second is never trusted by its stat.
 */
const copyKept = (from, to) => {
  fs.copyFileSync(from, to);
  const { atimeMs, mtimeMs } = fs.statSync(from);
  fs.utimesSync(to, atimeMs / 1000, mtimeMs / 1000);
};

/**
 * The tree of a scratch index less `.workkit` and each folder in `drop`. `-f`,
 * since a copy of the real index may stage a file that differs from disk too.
 * @param {string} root the repo root
 * @param {string} index the scratch index, rewritten
 * @param {string[]} [drop] more folders to leave out
 * @returns {string|null} the id, null when it cannot be taken
 */
const writeTree = (root, index, drop = []) => {
  if (git(root, ['rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', '.workkit', ...drop], index) === null) return null;
  return git(root, ['write-tree'], index) || null;
};

/**
 * A copy of the REAL index, the one a plain commit carries (GIT_INDEX_FILE in
 * a commit hook, absolute or from the root), at `<dir>/index`, so a write-tree
 * there never writes the real one. No index is no copy, the path still given.
 * @param {string} root the repo root
 * @param {string} dir the folder the copy goes in
 * @returns {string|null} the copy's path, null when the real one cannot be read
 */
const copyIndex = (root, dir) => {
  let real = process.env.GIT_INDEX_FILE || '';
  if (!real) {
    const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
    if (!gitDir) return null;
    real = path.join(gitDir, 'index');
  } else if (!path.isAbsolute(real) && !/^.:/.test(real)) {
    real = path.join(root, real);
  }
  const index = path.join(dir, 'index');
  if (fs.existsSync(real)) {
    try {
      copyKept(real, index);
    } catch {
      return null;
    }
  }
  return index;
};

/**
 * The WORKING tree's id, from a scratch index seeded from `<git dir>/index`,
 * never GIT_INDEX_FILE (the disk is hashed): untracked files in, ignored ones and
 * `.workkit` out. A package's id also leaves out the members it cannot see.
 * @param {string} root the repo root
 * @param {string} [pkg] a package folder relative to the root; none or `.` the whole tree
 * @returns {string|null} the id, null when it cannot be taken
 */
const treeId = (root, pkg) => {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return null;
  // Loaded only for a package: the whole tree's id reaches nothing past lib/.
  const drop = pkg && pkg !== '.' ? require('./workspaces').excludedFor(root, pkg) : [];
  return inScratch((dir) => {
    const index = path.join(dir, 'index');
    const real = path.join(gitDir, 'index');
    // A failed seed only costs speed: `git add -A` hashes every file instead.
    if (fs.existsSync(real)) {
      try { copyKept(real, index); } catch { fs.rmSync(index, { force: true }); }
    }
    if (git(root, ['add', '-A'], index) === null) return null;
    return writeTree(root, index, drop);
  });
};

/**
 * The real index's tree less `.workkit`, taken from its scratch copy (copyIndex).
 * @param {string} root the repo root
 * @returns {string|null} the id, null when it cannot be taken
 */
const indexTreeId = (root) => inScratch((dir) => {
  const index = copyIndex(root, dir);
  return index ? writeTree(root, index) : null;
});

/**
 * The CLI: the id on stdout; 1 with nothing there when it cannot be taken or
 * the call is refused.
 * @param {string[]} argv `<root> [<pkg> | -i]`
 * @returns {number} the exit code
 */
const main = (argv) => {
  const [root, ...rest] = argv;
  if (!root) {
    console.error('tree-hash: a repo root is required');
    return 1;
  }
  let out;
  if (rest[0] === '-i' && rest.length === 1) out = indexTreeId(root);
  else if (rest.includes('-i')) {
    console.error('tree-hash: -i takes no other flag or package');
    return 1;
  } else out = treeId(root, rest[0]);
  if (!out) return 1;
  console.log(out);
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  treeId, indexTreeId, copyIndex, writeTree,
};
