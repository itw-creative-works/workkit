//
// The tower's repo roster — which repositories the workflow covers.
//
// The tri-state opt-in is unchanged and the COMMITTED `.workkit/settings.json`
// (anything but `enabled: false`) stays the SSOT of membership; what this
// module reads is the machine-local INDEX of it. The engine registers every repo it heals or enables
// under `repos` in `~/.workkit/settings.json` and prunes the entries that went
// away, so the list maintains itself and no filesystem root is ever walked. A
// repo this machine has never opened is not on the dashboard — correct by
// definition, since the tower reports on the machine it runs on.
//
// The same `repos` map holds this user's declines (`"declined"`), which are
// decisions rather than observations: they are skipped here, never listed.
//
// The one repo that is never on the roster is the HOME repo: the tower clone at
// `<workflowHome>/tower` carries no committed opt-in of its own (issue #79), so
// it is recognized by path and added after the roster, deduplicated against it.
//
// Usage:
//   const { discoverRepos } = require('./repos');
//   discoverRepos();                 // the live roster
//   discoverRepos({ workflowHome }); // a fixture roster, fully offline
//

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const WORKKIT_DIR = '.workkit';

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

/** Parse JSON from a file, or null when it is absent or unparseable. */
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * `owner/repo` from a git remote URL, in either form git writes.
 *   git@github.com:owner/repo.git      ssh shorthand
 *   ssh://git@github.com/owner/repo    ssh URL
 *   https://github.com/owner/repo.git  https
 * @param {string} url
 * @returns {string|null}
 */
const slugFromRemote = (url) => {
  if (!url) return null;
  const trimmed = url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m = trimmed.match(/[:/]([^:/]+)\/([^/]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
};

/**
 * The origin slug for a repo, or null when it has no origin remote. A repo
 * without one is still listed — health works on a local-only repo; only the
 * board, which needs a GitHub name to query, skips it.
 * @param {string} repoPath
 * @param {Function} exec
 * @returns {string|null}
 */
const originSlug = (repoPath, exec) => {
  try {
    return slugFromRemote(exec('git', ['-C', repoPath, 'remote', 'get-url', 'origin']));
  } catch {
    return null;
  }
};

/**
 * Does this directory carry a committed opt-in?
 *
 * The engine's `resolve_state` is the SSOT of what "enabled" means, and this
 * reads it the same way: a committed file that does not say `enabled: false` is
 * a yes, so a legacy `{ "version": 1 }` written before the key existed stays in.
 * An absent or unparseable file is not a member — the answer is missing, not
 * given.
 */
const isEnabled = (dir) => {
  const settings = readJson(path.join(dir, WORKKIT_DIR, 'settings.json'));
  return !!settings && settings.enabled !== false;
};

/**
 * Every registered repo that still carries its committed opt-in.
 *
 * A listed path whose opt-in is gone is dropped SILENTLY: pruning the index is
 * the engine's job, done the next time it touches that repo, and a reader that
 * rewrote it would be a second writer of a file the engine owns.
 *
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's workflow state (default ~/.workkit)
 * @param {string} [opts.home] overrides ~ for the default
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git seam
 * @returns {Array<{name: string, path: string, slug: string|null}>}
 */
const discoverRepos = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome || path.join(home, WORKKIT_DIR);
  const exec = opts.exec || defaultExec;

  const settings = readJson(path.join(workflowHome, 'settings.json'));
  const registered = settings && settings.repos;

  const found = [];
  if (registered && typeof registered === 'object') {
    for (const [dir, value] of Object.entries(registered)) {
      if (value === 'declined') continue;
      if (!isEnabled(dir)) continue;
      found.push({ name: path.basename(dir), path: dir, slug: originSlug(dir, exec) });
    }
  }

  // The home repo, which the roster never carries: the tower clone holds no
  // `.workkit/` of its own (issue #79), so the engine knows it BY PATH and so
  // does this. Its issues are the cross-project queue, which is exactly what the
  // board exists to show — and a machine whose roster somehow lists it too gets
  // one entry, not two.
  //
  // By-path discovery has to prove two things a committed opt-in would have
  // proved for it: that this user did not DECLINE that path, and that whatever
  // sits there is actually the home repo. The proof of the second is the origin
  // slug matching the `home` slug the engine recorded in the same settings file
  // — no origin, no recorded slug, or a mismatch means some other checkout is
  // parked at that name, and a foreign repo is never listed.
  const tower = path.join(workflowHome, 'tower');
  const towerDeclined = !!registered && typeof registered === 'object' && registered[tower] === 'declined';
  if (!towerDeclined && !found.some((r) => r.path === tower) && fs.existsSync(path.join(tower, '.git'))) {
    const homeSlug = settings && typeof settings.home === 'string' ? settings.home : null;
    const slug = originSlug(tower, exec);
    if (homeSlug && slug === homeSlug) {
      found.push({ name: path.basename(tower), path: tower, slug });
    }
  }

  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
};

module.exports = { discoverRepos, slugFromRemote };
