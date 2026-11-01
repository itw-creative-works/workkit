// The suite marker read and written independently of workflow/lib/suite.sh: its
// path (and the package record's, the review marker's, the suite log's and the
// lock's) under a workflow home's markers folder, the package record's lines, the working tree's hash
// by the temp-index recipe, and the suite and package records planted as a green
// `npm test` would leave them. `kitIndexTree` is the one read through the kit, the
// index's id as tree-hash.sh -i takes it. Consumers: the script-shell wrapper's suites
// (script-shell, suite-hold), prove, githooks, and the commit-gate, proof-guard and _lib suites.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { mkTmp, SPAWN_DEADLINE } = require('./harness');
const { BASH, NO_RC, shellPath } = require('./platform');

const TREE_HASH = path.join(__dirname, '..', '..', 'workflow', 'lib', 'tree-hash.sh');

const repoRoot = (dir) => spawnSync('git', ['rev-parse', '--show-toplevel'],
  { cwd: dir, encoding: 'utf8' }).stdout.trim();

// <workflow home>/markers/<name>/<sha1 of the repo root>, every per-repo marker's shape.
const perRepo = (home, name, dir) => path.join(home, 'markers', name,
  crypto.createHash('sha1').update(repoRoot(dir)).digest('hex'));

/** The marker file for <dir>'s repo under the workflow <home>, keyed by the sha1 of its root. */
const suiteMarkerPath = (home, dir) => perRepo(home, 'claude-suite-marker', dir);

/** The package record for <dir>'s repo under <home>, keyed the same way. */
const pkgMarkerPath = (home, dir) => perRepo(home, 'claude-package-marker', dir);

/** The package record's lines (one `<tree> <folder>` per package), or undefined. */
const pkgRecord = (home, dir) => {
  const marker = pkgMarkerPath(home, dir);
  if (!fs.existsSync(marker)) return undefined;
  return fs.readFileSync(marker, 'utf8').replace(/\n$/, '').split('\n');
};

/** The review marker file for <dir>'s repo under <home>, keyed the same way. */
const reviewMarkerPath = (home, dir) => perRepo(home, 'claude-review-marker', dir);

/** The suite log under <home>, where it goes when the repo does not ignore .workkit/. */
const suiteLogPath = (home, dir) => perRepo(home, 'claude-suite.log', dir);

/** The in-flight lock folder under <home>, holding the running suite's `pid`. */
const suiteLockPath = (home, dir) => perRepo(home, 'claude-suite-lock', dir);
const ciLockPath = (home, dir) => perRepo(home, 'claude-ci-watch-lock', dir);

/** The working tree's `git write-tree` id, built in a throwaway index, `.workkit` and each <excluded> folder dropped from it. */
const treeHash = (dir, excluded = []) => {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(mkTmp('tree-index-'), 'index') };
  spawnSync('git', ['add', '-A'], { cwd: dir, env });
  for (const rel of ['.workkit', ...excluded]) spawnSync('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', rel], { cwd: dir, env });
  return spawnSync('git', ['write-tree'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
};

/** The index's tree id as the kit takes it, `bash tree-hash.sh <dir> -i`, under <env> over this process's (a GIT_INDEX_FILE names another index). */
const kitIndexTree = (dir, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(TREE_HASH), shellPath(dir), '-i'],
    { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  const id = (res.stdout || '').trim();
  if (!/^[0-9a-f]{40,64}$/.test(id)) throw new Error(`tree-hash.sh -i gave no tree id: ${res.stdout}|${res.stderr}`);
  return id;
};

/** Plant the record holding <tree>, the working tree's hash by default. */
const plantRecord = (home, dir, tree = treeHash(dir)) => {
  const marker = suiteMarkerPath(home, dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${tree}\n`);
  return marker;
};

/** Plant the package record holding each of <pkgs> on <tree>, the working tree's hash by default. */
const plantPkgRecord = (home, dir, pkgs, tree = treeHash(dir)) => {
  const marker = pkgMarkerPath(home, dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, pkgs.map((pkg) => `${tree} ${pkg}\n`).join(''));
  return marker;
};

module.exports = {
  suiteMarkerPath, pkgMarkerPath, pkgRecord, reviewMarkerPath, suiteLogPath, suiteLockPath, ciLockPath, treeHash, kitIndexTree,
  plantRecord, plantPkgRecord,
};
