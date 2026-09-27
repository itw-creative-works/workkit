// The tower's repo roster: the machine-local index the engine keeps under
// `repos` in `~/.workkit/.repos.json`, each entry still carrying its committed
// opt-in (the membership SSOT), declines skipped, plus the home clone found by
// path (tower/README.md § Endpoints).
//
// Usage:
//   discoverRepos();                 // the live roster
//   discoverRepos({ workflowHome }); // a fixture roster, fully offline

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// What a repo is called has one home, the engine's workflow/slug.js. The home
// runner seed keeps both trees at the same relative depth, so this resolves there too.
const { slugFromRemote } = require('../../../workflow/slug');

const WORKKIT_DIR = '.workkit';

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

/**
 * A path in git's spelling, the one every roster key is written under: on
 * Windows backslashes fold to `/`, elsewhere the path is the answer. Unlike
 * `wk_git_path` (workflow/lib/platform.sh) it leaves the MSYS `/c/` form alone.
 * `process.platform` is read at call time, the one seam a test off Windows has.
 * @param {string} p
 * @returns {string}
 */
const gitPath = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

/**
 * This machine's temp root, where the harness keeps its per-session files:
 * `TMPDIR`, else the Darwin per-user temp dir, else `os.tmpdir()`. On Windows a
 * POSIX answer (Git Bash exports `TMP=/tmp`) becomes `%LOCALAPPDATA%\Temp`,
 * which is what Git Bash's `/tmp` is. Platform read at call time, as `gitPath`.
 * @param {Function} [exec] (cmd, args) => stdout: the `getconf` seam
 * @returns {string}
 */
const tempRoot = (exec = defaultExec) => {
  let base = process.env.TMPDIR;
  if (!base && process.platform === 'darwin') {
    try {
      base = exec('getconf', ['DARWIN_USER_TEMP_DIR']).trim();
    } catch {
      base = '';
    }
  }
  base = base || os.tmpdir();
  if (process.platform === 'win32' && base.startsWith('/') && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Temp');
  }
  return base;
};

/** Parse JSON from a file, or null when it is absent or unparseable. */
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The roster file as three answers: `ok`, `missing` (nothing registered), or
 * `unreadable`. A reader treats the last two alike; a writer must not, or it
 * publishes an empty list over a roster that was good.
 * @param {string} workflowHome
 * @returns {{status: 'ok'|'missing'|'unreadable', roster: object|null}}
 */
const readRoster = (workflowHome) => {
  const file = path.join(workflowHome, '.repos.json');
  if (!fs.existsSync(file)) return { status: 'missing', roster: null };
  const roster = readJson(file);
  return roster ? { status: 'ok', roster } : { status: 'unreadable', roster: null };
};

/**
 * The origin slug for a repo, or null when it has no origin remote. A repo
 * without one is still listed: health works on a local-only repo; only the
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
 * Does this directory carry a committed opt-in? Read as the engine's
 * `resolve_state` reads it: a file saying anything but `enabled: false` is a yes.
 */
const isEnabled = (dir) => {
  const settings = readJson(path.join(dir, WORKKIT_DIR, 'settings.json'));
  return !!settings && settings.enabled !== false;
};

/**
 * Every registered repo that still carries its committed opt-in. A path whose
 * opt-in is gone is dropped silently: pruning the index is the engine's job.
 * @param {object} [opts]
 * @param {string} [opts.workflowHome] the user's workflow state (default ~/.workkit)
 * @param {string} [opts.home] overrides ~ for the default
 * @param {Function} [opts.exec] (cmd, args) => stdout: the git seam
 * @returns {Array<{name: string, path: string, slug: string|null}>}
 */
const discoverRepos = (opts = {}) => {
  const home = opts.home || os.homedir();
  const workflowHome = opts.workflowHome || path.join(home, WORKKIT_DIR);
  const exec = opts.exec || defaultExec;

  const { roster } = readRoster(workflowHome);
  const registered = roster && roster.repos;

  const found = [];
  if (registered && typeof registered === 'object') {
    for (const [dir, value] of Object.entries(registered)) {
      if (value === 'declined') continue;
      if (!isEnabled(dir)) continue;
      found.push({ name: path.basename(dir), path: dir, slug: originSlug(dir, exec) });
    }
  }

  // The home repo, which the roster never carries: known by path, and listed
  // only when not declined and its origin matches `site.repo`, never a foreign
  // checkout parked there. The path is in git's spelling, so both compares
  // below match the roster keys on Windows.
  const tower = gitPath(path.join(workflowHome, 'tower'));
  const towerDeclined = !!registered && typeof registered === 'object' && registered[tower] === 'declined';
  if (!towerDeclined && !found.some((r) => r.path === tower) && fs.existsSync(path.join(tower, '.git'))) {
    const settings = readJson(path.join(workflowHome, 'settings.json'));
    const site = (settings && settings.site) || null;
    const homeSlug = site && typeof site.repo === 'string' ? site.repo : null;
    const slug = originSlug(tower, exec);
    if (homeSlug && slug === homeSlug) {
      found.push({ name: path.basename(tower), path: tower, slug });
    }
  }

  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
};

module.exports = { discoverRepos, gitPath, readRoster, tempRoot };
