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
  if (!registered || typeof registered !== 'object') return [];

  const found = [];
  for (const [dir, value] of Object.entries(registered)) {
    if (value === 'declined') continue;
    if (!isEnabled(dir)) continue;
    found.push({ name: path.basename(dir), path: dir, slug: originSlug(dir, exec) });
  }
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
};

module.exports = { discoverRepos, slugFromRemote };
