// The suite marker read and written independently of workflow/lib/suite.sh: its
// path (and the package record's, the review marker's, the suite log's and the
// lock's) under a temp dir, the package record's lines, the working tree's hash
// by the temp-index recipe, and the suite and package records planted as a green
// `npm test` would leave them. Consumers: the suite-guard, commit-gate,
// script-shell, proof-guard and _lib suites.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkTmp } = require('./scratch');

const repoRoot = (dir) => spawnSync('git', ['rev-parse', '--show-toplevel'],
  { cwd: dir, encoding: 'utf8' }).stdout.trim();

// <tmp>/<name>/<sha1 of the repo root>, the shape of every per-repo temp file.
const perRepo = (tmp, name, dir) => path.join(tmp, name,
  crypto.createHash('sha1').update(repoRoot(dir)).digest('hex'));

/** The marker file for <dir>'s repo under <tmp>, keyed by the sha1 of its root. */
const suiteMarkerPath = (tmp, dir) => perRepo(tmp, 'claude-suite-marker', dir);

/** The package record for <dir>'s repo under <tmp>, keyed the same way. */
const pkgMarkerPath = (tmp, dir) => perRepo(tmp, 'claude-package-marker', dir);

/** The package record's lines (the tree id, then one folder each), or undefined. */
const pkgRecord = (tmp, dir) => {
  const marker = pkgMarkerPath(tmp, dir);
  if (!fs.existsSync(marker)) return undefined;
  return fs.readFileSync(marker, 'utf8').replace(/\n$/, '').split('\n');
};

/** The review marker file for <dir>'s repo under <tmp>, keyed the same way. */
const reviewMarkerPath = (tmp, dir) => perRepo(tmp, 'claude-review-marker', dir);

/** The suite log under <tmp>, its home when the repo does not ignore .workkit/. */
const suiteLogPath = (tmp, dir) => perRepo(tmp, 'claude-suite.log', dir);

/** The in-flight lock folder under <tmp>, holding the running suite's `pid`. */
const suiteLockPath = (tmp, dir) => perRepo(tmp, 'claude-suite-lock', dir);
const ciLockPath = (tmp, dir) => perRepo(tmp, 'claude-ci-watch-lock', dir);

/** The working tree's `git write-tree` id, built in a throwaway index. */
const treeHash = (dir) => {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(mkTmp('tree-index-'), 'index') };
  spawnSync('git', ['add', '-A'], { cwd: dir, env });
  return spawnSync('git', ['write-tree'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
};

/** Plant the record holding <tree>, the working tree's hash by default. */
const plantRecord = (tmp, dir, tree = treeHash(dir)) => {
  const marker = suiteMarkerPath(tmp, dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${tree}\n`);
  return marker;
};

/** Plant the package record holding <pkgs> on <tree>, the working tree's hash by default. */
const plantPkgRecord = (tmp, dir, pkgs, tree = treeHash(dir)) => {
  const marker = pkgMarkerPath(tmp, dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${[tree, ...pkgs].join('\n')}\n`);
  return marker;
};

module.exports = {
  suiteMarkerPath, pkgMarkerPath, pkgRecord, reviewMarkerPath, suiteLogPath, suiteLockPath, ciLockPath, treeHash, plantRecord,
  plantPkgRecord,
};
