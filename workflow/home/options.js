/**
 * workflow/home/options.js: the home repo's constants, the site options and
 * the clone's state. The site options are the machine's: the kit's defaults
 * under the machine file, no repo layer.
 * Usage: const { PAGES_BRANCH, homeBranch, siteHost, homeState, homeReady } = require('./options');
 */

const fs = require('fs');
const path = require('path');
const { isPlain } = require('../../hooks/mods/settings.js');
const { settingsAt, homeSlug } = require('../lib/settings');
const { userDir, towerDir } = require('../user-dir');
const { gitIn } = require('../lib/git');
const { repoSlug } = require('../lib/repo');
const { slugFromRemote } = require('../slug');
const {
  isFile, takeLock, dropLock, stateLockPath,
} = require('../lib/lock');
const { editJson } = require('../lib/write');
const { physical } = require('../lib/link');

// Pages serves this branch's root, so no build output is committed as source.
// Its twin is WK_HOME_PAGES_BRANCH in workflow/home.sh, which later shell reads.
const PAGES_BRANCH = 'gh-pages';

// The kit root, resolved from this file, since the engine travels as a folder.
const KIT_ROOT = path.join(__dirname, '..', '..');

/**
 * The seed's source: this checkout's tower/app, physical, or '' when there is
 * none. WORKKIT_TOWER_APP is the suite's seam, taken as written.
 * @returns {string}
 */
const towerApp = () => process.env.WORKKIT_TOWER_APP || physical(path.join(KIT_ROOT, 'tower', 'app')) || '';

/**
 * The plugin checkout: the source of the cloud brief's runner, the heal and
 * the version stamp, read at HEAD. WORKKIT_KIT_DIR is the suite's seam.
 * @returns {string}
 */
const kitDir = () => process.env.WORKKIT_KIT_DIR || physical(KIT_ROOT) || '';

/** The machine's settings file, `<user dir>/settings.json`. */
const settingsFile = () => path.join(userDir(), 'settings.json');

/** A site option as the shell's setting read prints it: a string as it is, any other value as JSON, '' for none. */
const siteOption = (key) => {
  const value = settingsAt(null, settingsFile()).site?.[key];
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

/**
 * The clone's remote URL for a slug. WORKKIT_HOME_REMOTE is the suite's seam:
 * a local bare repo keeps every clone, fetch and push offline.
 * @param {string} slug
 * @returns {string}
 */
const remoteUrl = (slug) => process.env.WORKKIT_HOME_REMOTE || `https://github.com/${slug}.git`;

/**
 * The home slug this machine is configured for, or ''.
 * @returns {string}
 */
const slug = () => homeSlug(userDir()) ?? '';

/**
 * The site's host, or '' with no custom domain: `site.url` with any scheme and
 * one trailing slash taken off, since a CNAME carries a host and never a path.
 * @returns {string}
 */
const siteHost = () => {
  const url = siteOption('url');
  if (!url) return '';
  const at = url.indexOf('://');
  const host = at === -1 ? url : url.slice(at + 3);
  return host.endsWith('/') ? host.slice(0, -1) : host;
};

/**
 * The extra sidebar groups the publish build merges after the built-in ones,
 * as the JSON the settings hold, or ''.
 * @returns {string}
 */
const siteSidebar = () => siteOption('sidebar');

/**
 * The branch the clone is on, `main` with no clone to ask. symbolic-ref, not
 * rev-parse: on an unborn HEAD rev-parse answers `HEAD` and fails.
 * @returns {string}
 */
const homeBranch = () => {
  const res = gitIn(towerDir(), ['symbolic-ref', '--quiet', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? res.stdout.replace(/\n+$/, '') : 'main';
};

/** The settings' value with `site.repo` set, as jq's `.site = ((.site // {}) + { repo: $s })`. */
const withRepo = (value, repo) => {
  if (!isPlain(value)) throw new TypeError('settings: the file is not an object');
  const site = value.site === null || value.site === undefined || value.site === false ? {} : value.site;
  if (!isPlain(site)) throw new TypeError('settings: site is not an object');
  return { ...value, site: { ...site, repo } };
};

/**
 * The one key a machine writes in the hand-edited settings, under the state
 * lock. A missing file is seeded as the heal seeds it first.
 * @param {string} repo the slug
 * @returns {Promise<boolean>} whether it was written
 */
const setSlug = async (repo) => {
  const file = settingsFile();
  if (!isFile(file)) {
    try {
      fs.mkdirSync(userDir(), { recursive: true });
      fs.writeFileSync(file, '{\n  "version": 1\n}\n');
    } catch {
      return false;
    }
  }
  const lock = stateLockPath(userDir());
  const locked = await takeLock(lock);
  const written = editJson(file, (value) => withRepo(value, repo));
  if (locked) dropLock(lock);
  return written;
};

/**
 * The origin slug of the clone's folder, or '' when it is not a git repo.
 * @returns {string}
 */
const cloneSlug = () => repoSlug(towerDir());

/**
 * Whether the clone's origin is the given repo. The URL is asked too, since
 * only it can answer under the suite's local-remote seam.
 * @param {string} repo
 * @returns {boolean}
 */
const matches = (repo) => {
  const res = gitIn(towerDir(), ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const actual = res.status === 0 ? res.stdout.replace(/\n+$/, '') : '';
  if (!actual) return false;
  if (actual === remoteUrl(repo)) return true;
  return (slugFromRemote(actual) ?? '') === repo;
};

/**
 * What `~/.workkit/tower` is, in one word: unset (no slug), absent (setup
 * clones it), clone, or other (something else, never adopted).
 * @returns {'unset'|'absent'|'clone'|'other'}
 */
const homeState = () => {
  const repo = slug();
  if (!repo) return 'unset';
  if (!fs.existsSync(towerDir())) return 'absent';
  return matches(repo) ? 'clone' : 'other';
};

/**
 * The one guard the daily path takes before it touches the clone.
 * @returns {boolean}
 */
const homeReady = () => homeState() === 'clone';

module.exports = {
  PAGES_BRANCH, towerApp, kitDir, settingsFile, remoteUrl, slug, siteHost, siteSidebar, homeBranch, setSlug, cloneSlug, matches, homeState, homeReady,
};
