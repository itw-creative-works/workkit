/**
 * workflow/home/repo.js: the setup steps that make the home, and the transform
 * a copied manifest gets: the repo's one name, the login, the repo, the clone,
 * and the `file:` specs made absolute.
 * Usage: const { HOME_REPO_NAME, login, ensureRepo, clone, empty, repointFileSpecs } = require('./repo');
 */

const fs = require('fs');
const path = require('path');
const { isPlain } = require('../../hooks/mods/settings.js');
const { chomp } = require('../../hooks/mods/text.js');
const { spawnSync, onPath } = require('../lib/run');
const { gitIn } = require('../lib/git');
const { isDir, isFile } = require('../lib/lock');
const { physical } = require('../lib/link');
const { nativePath } = require('../lib/platform');
const { readJsonOrNull } = require('../lib/read');
const { editJson } = require('../lib/write');
const { ok, skip, warn } = require('../lib/voice');
const { userDir, towerDir } = require('../user-dir');
const { spin } = require('../lib/spin');
const { remoteUrl, matches, cloneSlug } = require('./options');

// One name, so a second machine running setup finds the repo that exists. The
// dashboard's HOME_NAME (tower/app's github/roster.js) is its browser copy.
const HOME_REPO_NAME = 'workkit';

/** A `gh` call whose output is read and whose stderr is dropped. */
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });

/**
 * The GitHub login, which names the repo. '' when gh cannot answer.
 * @returns {Promise<string>}
 */
const login = async () => {
  if (!onPath('gh')) return '';
  const res = await spin('reading the gh login', () => gh(['api', 'user', '-q', '.login']), { line: false });
  return res.status === 0 ? chomp(res.stdout) : '';
};

/**
 * The repo made private when it is not there. An existing repo is current,
 * never an error: a second machine finds the same home.
 * @param {string} slug
 * @returns {Promise<number>} 0 created, 2 already there, 1 could not
 */
const ensureRepo = async (slug) => {
  if (!onPath('gh')) return 1;
  if ((await spin(`looking for ${slug}`, () => gh(['repo', 'view', slug, '--json', 'name']), { line: false })).status === 0) return 2;
  return (await spin(`creating ${slug}`, () => gh(['repo', 'create', slug, '--private']), { line: false })).status === 0 ? 0 : 1;
};

/**
 * A plain `git clone` into a path that does not exist: anything already there
 * is somebody else's and is never adopted. The machine folder is only made.
 * @param {string} slug
 * @returns {Promise<number>} 0 cloned or already the clone, 1 could not clone, 3 something else is in the way
 */
const clone = async (slug) => {
  const url = remoteUrl(slug);
  const home = towerDir();
  if (fs.existsSync(home)) {
    if (matches(slug)) {
      skip(`home: ${nativePath(home)} is the clone of ${slug}`);
      return 0;
    }
    const existing = cloneSlug();
    if (existing) {
      warn(`home: ${nativePath(home)} is a git repo pointing at ${existing}; leaving it alone; move it aside if ${slug} should live there`);
    } else {
      warn(`home: ${nativePath(home)} already exists and is not a clone of ${slug}; leaving it alone; move it aside, then run \`workkit setup\` again`);
    }
    return 3;
  }
  try {
    fs.mkdirSync(userDir(), { recursive: true });
  } catch {
    warn(`home: could not create ${nativePath(userDir())}`);
    return 1;
  }
  // A fresh repo is empty and git warns about it: the expected first-setup
  // case, so only the exit status is read.
  const res = await spin(`cloning ${slug}`, () => spawnSync('git', ['clone', '-q', url, home], { stdio: 'ignore', windowsHide: true }), { line: false });
  if (res.status !== 0) {
    warn(`home: could not clone ${slug} into ${nativePath(home)}; \`git clone ${url} ${nativePath(home)}\` reports why`);
    return 1;
  }
  ok(`home: cloned ${slug} into ${nativePath(home)}`);
  return 0;
};

/**
 * A clone with no commit of its own, the only state the seed may write into.
 * `.git` is asked with an exists, since it is a file in a worktree.
 * @returns {boolean}
 */
const empty = () => {
  const home = towerDir();
  if (!fs.existsSync(path.join(home, '.git'))) return false;
  return gitIn(home, ['rev-parse', '--verify', '-q', 'HEAD'], { stdio: 'ignore' }).status !== 0;
};

/** A manifest's `file:` specs as [name, spec] pairs, devDependencies over dependencies; none when a value is no string, as jq's filter fails whole. */
const fileSpecs = (pkg) => {
  const value = readJsonOrNull(pkg);
  if (!isPlain(value)) return [];
  const part = (deps) => (deps === null || deps === undefined || deps === false ? {} : deps);
  const deps = part(value.dependencies);
  const dev = part(value.devDependencies);
  if (!isPlain(deps) || !isPlain(dev)) return [];
  const merged = Object.entries({ ...deps, ...dev });
  if (merged.some(([, spec]) => typeof spec !== 'string')) return [];
  return merged.filter(([, spec]) => spec.startsWith('file:'));
};

/**
 * Every `file:` spec in one package.json repointed at the absolute path it
 * resolves to from the manifest it was copied from, since a relative one means
 * nothing in the clone. Only a maintainer tree left in local mode carries one.
 * @param {string} pkg the seeded package.json
 * @param {string} srcdir the source package's folder
 */
const repointFileSpecs = (pkg, srcdir) => {
  if (!isFile(pkg)) return;
  for (const [name, spec] of fileSpecs(pkg)) {
    // Through the filesystem, since only it can resolve `../..` through links.
    const abs = physical(path.join(srcdir, spec.slice('file:'.length)));
    if (abs === null || !isDir(abs)) {
      warn(`home: the seeded ${name} still points at ${spec}; nothing resolves it from ${nativePath(srcdir)}, so the tower project cannot build until it does`);
      continue;
    }
    editJson(pkg, (value) => {
      for (const key of ['dependencies', 'devDependencies']) {
        if (isPlain(value[key]) && Object.hasOwn(value[key], name)) value[key][name] = `file:${abs}`;
      }
      return value;
    });
  }
};

module.exports = {
  HOME_REPO_NAME, login, ensureRepo, clone, empty, repointFileSpecs,
};
