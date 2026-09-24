//
// The tower's repo roster: which repositories the workflow covers.
//
// The tri-state opt-in is unchanged and the COMMITTED `.workkit/settings.json`
// (anything but `enabled: false`) stays the SSOT of membership; what this
// module reads is the machine-local INDEX of it. The engine registers every repo it heals or enables
// under `repos` in `~/.workkit/.repos.json` (the machine-maintained file, which
// is why it is not the hand-edited `settings.json` beside it (issue #80)) and
// prunes the entries that went
// away, so the list maintains itself and no filesystem root is ever walked. A
// repo this machine has never opened is not on the dashboard, correct by
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

// What a repo is CALLED has one home for the whole kit, and it is the engine's
// (workflow/slug.js, the twin of workflow/slug.sh). The reach out of tower/ is
// the one workflow/site-repos.js already makes in the other direction, and the
// home runner seed keeps both trees at the same relative depth, so this
// resolves in the seeded clone exactly as it does here.
const { slugFromRemote } = require('../../../workflow/slug');

const WORKKIT_DIR = '.workkit';

const defaultExec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  ...opts,
});

/**
 * A path in GIT's spelling, the one every roster key is written under.
 *
 * Windows gives one directory two names: `path.join` spells `C:\Users\x` and
 * git prints the mixed form `C:/Users/x`, and the roster is keyed by what git
 * printed. A key looked up in the other spelling matches nothing. macOS and
 * Linux spell a path one way, so there the answer is the path.
 *
 * `wk_git_path` in workflow/platform.sh answers the same question for the
 * shell, and NOT with the same fold: it runs `cygpath -m`, which converts the
 * MSYS mount form (`/c/Users/x`) as well, while this folds backslashes and
 * nothing else. Each takes the spelling its own callers hand it (`path.join`
 * and the session marker give the native form, a shell can be handed the mount
 * form), so neither answers a `/c/` path for the other.
 *
 * `process.platform` is read at CALL time rather than folded into a constant:
 * `require('path')` binds to the native implementation, so that read is the one
 * seam a test off Windows has into this branch.
 *
 * @param {string} p
 * @returns {string}
 */
const gitPath = (p) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p);

/**
 * This machine's temp root: where the harness keeps its per-session files, and
 * the one place the platforms are asked about it. Two readers want the answer
 * (the keep-awake markers and the statusline cache) and both writers spell it
 * `${TMPDIR:-/tmp}` from a shell, so the branch is taken here once rather than
 * at either consumer.
 *
 * The rule:
 *   1. `TMPDIR` when it is set, which is what a hook or a shell was handed.
 *   2. else the Darwin per-user temp dir, which is what a shell has and a
 *      launchd job does not, and which is never `/tmp`.
 *   3. else this machine's own `os.tmpdir()`.
 * On Windows a POSIX answer is REFUSED. Git for Windows exports `TMP=/tmp` to
 * every login shell, so `os.tmpdir()` hands back that string and `path.join`
 * turns it into `C:\tmp`, a directory nothing ever writes to; Git Bash's
 * `/tmp` IS `%LOCALAPPDATA%\Temp`, so that is the answer there. A machine
 * without that variable keeps whatever it said, there being nothing better to
 * offer it.
 *
 * `process.platform` is read at CALL time, the same seam `gitPath` above needs.
 *
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
 * The roster file, read as three distinguishable answers: `ok` with what it
 * holds, `missing` when this machine has registered nothing, and `unreadable`
 * when the file is there and does not parse.
 *
 * A READER cannot tell the last two apart and does not need to. A roster it
 * cannot read is a board with no repos on it, and the board still renders. A
 * WRITER must (issue #116): composing the same empty list from a failure would
 * publish it over a roster that was good.
 *
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
 * Does this directory carry a committed opt-in?
 *
 * The engine's `resolve_state` is the SSOT of what "enabled" means, and this
 * reads it the same way: a committed file that does not say `enabled: false` is
 * a yes, so a legacy `{ "version": 1 }` written before the key existed stays in.
 * An absent or unparseable file is not a member. The answer is missing, not
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

  // The home repo, which the roster never carries: the tower clone holds no
  // `.workkit/` of its own (issue #79), so the engine knows it BY PATH and so
  // does this. Its issues are the cross-project queue, which is exactly what the
  // board exists to show, and a machine whose roster somehow lists it too gets
  // one entry, not two.
  //
  // By-path discovery has to prove two things a committed opt-in would have
  // proved for it: that this user did not DECLINE that path, and that whatever
  // sits there is actually the home repo. The proof of the second is the origin
  // slug matching `site.repo`: the slug the owner's settings.json names as the
  // repo the site publishes from. No origin, no configured slug, or a mismatch
  // means some other checkout is parked at that name, and a foreign repo is
  // never listed.
  //
  // The path is built in git's spelling, the one the roster keys it is compared
  // against are written in: `path.join` would spell backslashes on
  // Windows and neither compare below would ever match, so the clone would be
  // listed a second time or its decline ignored. The directory is addressed by
  // that same string, which Node and git both take.
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
