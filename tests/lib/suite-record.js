// The suite marker read and written independently of workflow/lib/suite.sh: its
// path (and the review marker's, the suite log's and the lock's) under a temp
// dir, the working tree's hash by the temp-index recipe, and a record planted as
// a green root `npm test` would leave it. Consumers: the suite-guard, commit-gate,
// script-shell and _lib suites.

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

module.exports = {
  suiteMarkerPath, reviewMarkerPath, suiteLogPath, suiteLockPath, ciLockPath, treeHash, plantRecord,
};
