//
// The tower's repo roster — which repositories the workflow covers.
//
// There is no registry file to maintain, and there is deliberately none: the
// tri-state opt-in already records the answer in two places the workflow owns.
// A repo says yes by COMMITTING `.workkit/settings.json` with `enabled: true`;
// a user says no for their own machine in `~/.workkit/settings.json` under
// `repos`. Discovery is a walk of the Repositories root reading those two
// surfaces, so adding a repo to the tower is the same act as opting it in.
//
// The walk is bounded (four levels, matching the depth move-legacy.sh assumes
// for `<root>/<owner>/<repo>`) and prunes only `node_modules` and `.git`. Dot
// directories are NOT pruned: `.dotfiles` is a real, opted-in repo, and the
// depth bound is what keeps the walk cheap rather than a name filter that would
// have to know about it.
//
// Usage:
//   const { discoverRepos } = require('./repos');
//   discoverRepos();                       // the live roster
//   discoverRepos({ root, workflowHome }); // a fixture roster, fully offline
//

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// How deep below the root a repo may sit. `<root>/<owner>/<repo>` needs two;
// the extra headroom covers the nested groupings that exist today without
// turning the walk into a full-disk crawl.
const MAX_DEPTH = 4;

const PRUNE = new Set(['node_modules', '.git']);

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

/** The set of absolute paths this user declined, from ~/.workkit/settings.json. */
const declinedPaths = (workflowHome) => {
  const settings = readJson(path.join(workflowHome, 'settings.json'));
  const repos = settings && settings.repos;
  if (!repos || typeof repos !== 'object') return new Set();
  return new Set(Object.keys(repos).filter((k) => repos[k] === 'declined'));
};

/** Does this directory carry a committed opt-in? */
const isEnabled = (dir) => {
  const settings = readJson(path.join(dir, WORKKIT_DIR, 'settings.json'));
  return !!settings && settings.enabled === true;
};

/**
 * Every opted-in repo under the root, minus this user's declines.
 * @param {object} [opts]
 * @param {string} [opts.root] where to walk (default ~/Developer/Repositories)
 * @param {string} [opts.workflowHome] the user's workflow state (default ~/.workkit)
 * @param {string} [opts.home] overrides ~ for both defaults
 * @param {number} [opts.maxDepth] levels below the root to descend
 * @param {Function} [opts.exec] (cmd, args) => stdout — the git seam
 * @returns {Array<{name: string, path: string, slug: string|null}>}
 */
const discoverRepos = (opts = {}) => {
  const home = opts.home || os.homedir();
  const root = opts.root || path.join(home, 'Developer', 'Repositories');
  const workflowHome = opts.workflowHome || path.join(home, WORKKIT_DIR);
  const maxDepth = opts.maxDepth === undefined ? MAX_DEPTH : opts.maxDepth;
  const exec = opts.exec || defaultExec;

  const declined = declinedPaths(workflowHome);
  const found = [];

  const walk = (dir, depth) => {
    if (isEnabled(dir)) {
      // A repo is a leaf: nothing inside an opted-in repo is another repo, and
      // descending would find its vendored checkouts.
      let real = dir;
      try {
        real = fs.realpathSync(dir);
      } catch {
        // Unreadable path — the enabled read already succeeded, so keep going
        // with the path as given rather than dropping a real repo.
      }
      if (!declined.has(real) && !declined.has(dir)) {
        found.push({ name: path.basename(dir), path: dir, slug: originSlug(dir, exec) });
      }
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || PRUNE.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(root, 0);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
};

module.exports = { discoverRepos, slugFromRemote, MAX_DEPTH };
