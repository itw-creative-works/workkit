/**
 * workflow/lib/discussions.js: what home needs of GitHub's Discussions for the
 * home repo, the Node home of `wk_disc_ready`, `wk_disc_meta` (with its fetch),
 * `wk_disc_enable` and the category names of lib/discussions.sh. Best effort:
 * no `gh`, no network or a refusing token is a null or a failing code.
 * Usage: const { ready, meta, enable, CATEGORIES } = require('../lib/discussions');
 */

const fs = require('fs');
const { isPlain } = require('../../hooks/mods/settings.js');
const { dropLock, stateLockPath, takeLock } = require('./lock');
const { readJsonOrNull } = require('./read');
const { onPath, spawnSync } = require('./run');
const { spin } = require('./spin');
const { editJson } = require('./write');
const { userDir } = require('../user-dir');

// The four setup checks for, one per summary cadence plus the brief's.
const CATEGORIES = ['Daily', 'Weekly', 'Monthly', 'Brief'];

// Everything about the home repo worth caching, in one round trip.
const META_QUERY = `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        id
        hasDiscussionsEnabled
        discussionCategories(first:25){ nodes { id name } }
      }
    }`;

const ENABLE_MUTATION = `mutation($repoId:ID!){
    updateRepository(input:{repositoryId:$repoId, hasDiscussionsEnabled:true}){
      repository { hasDiscussionsEnabled }
    }
  }`;

/** The disposable cache file in the machine folder (`WK_HOME_CACHE` of lib.sh). */
const cacheFile = () => `${userDir()}/.cache.json`;

/** `gh api graphql` with <fields> as `-f` pairs, its stdout read, its stderr dropped. */
const graphql = (fields) => spawnSync('gh', ['api', 'graphql', ...fields.flatMap((field) => ['-f', field])], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
});

/**
 * Whether the Discussions calls can run: `gh` is on PATH.
 * @returns {boolean}
 */
const ready = () => onPath('gh') !== null;

/**
 * The meta of an API answer, as wk_disc_fetch_meta's filter makes it: the
 * node id, whether Discussions are on, every category's id by its name.
 * @param {string} text the answer's JSON
 * @returns {{repositoryId: string, discussionsEnabled: boolean, categories: object}|null}
 */
const metaOf = (text) => {
  let repo;
  try {
    repo = JSON.parse(text).data.repository;
  } catch {
    return null;
  }
  const nodes = repo?.discussionCategories?.nodes;
  if (!isPlain(repo) || !Array.isArray(nodes)) return null;
  return {
    repositoryId: repo.id,
    discussionsEnabled: repo.hasDiscussionsEnabled,
    categories: Object.fromEntries(nodes.map((node) => [node.name, node.id])),
  };
};

/** The fetch: one GraphQL read of <slug>, spun with no one line as the shell's sent its stderr away; null when it could not answer. */
const fetchMeta = (slug) => {
  const owner = slug.split('/')[0];
  const name = slug.split('/').pop();
  const res = spin(`reading ${slug} on GitHub`, () => graphql([`owner=${owner}`, `name=${name}`, `query=${META_QUERY}`]), { line: false });
  return res.status === 0 ? metaOf(res.stdout) : null;
};

/**
 * <fresh> cached for <slug>, under the state mutex, best effort: a cache that
 * cannot be read as an object is left as it is, and lost races are re-fetched.
 */
const cache = async (slug, fresh) => {
  const file = cacheFile();
  try {
    fs.mkdirSync(userDir(), { recursive: true });
  } catch {
    return;
  }
  if (fs.existsSync(file) && !isPlain(readJsonOrNull(file))) return;
  const locked = await takeLock(stateLockPath(userDir()));
  try {
    editJson(file, (value) => {
      const kept = value.homeCache ?? {};
      if (!isPlain(kept)) throw new TypeError('homeCache is not an object');
      return { ...value, homeCache: { ...kept, [slug]: fresh } };
    }, { create: true });
  } finally {
    if (locked) dropLock(stateLockPath(userDir()));
  }
};

/**
 * `wk_disc_meta`: the home repo's meta, from the cache unless <refresh>, else
 * fetched and cached.
 * @param {string} slug `owner/name`
 * @param {{refresh?: boolean}} [opts] refresh: fetch past the cache, as `--refresh`
 * @returns {Promise<object|null>} the meta, null where the shell function fails
 */
const meta = async (slug, { refresh = false } = {}) => {
  if (!ready()) return null;
  if (!refresh) {
    const cached = readJsonOrNull(cacheFile())?.homeCache?.[slug];
    if (isPlain(cached)) return cached;
  }
  const fresh = fetchMeta(slug);
  if (fresh === null) return null;
  await cache(slug, fresh);
  return fresh;
};

/**
 * `wk_disc_enable`: Discussions turned on, after a fresh read, so a repo that
 * has them is not written to; the cache refreshed after the write.
 * @param {string} slug
 * @returns {Promise<number>} 0 turned on, 2 already on, 1 could not
 */
const enable = async (slug) => {
  if (!ready()) return 1;
  const found = await meta(slug, { refresh: true });
  if (found === null) return 1;
  if (found.discussionsEnabled === true) return 2;
  if (!found.repositoryId) return 1;
  const res = spin('turning Discussions on', () => graphql([`repoId=${found.repositoryId}`, `query=${ENABLE_MUTATION}`]), { line: false });
  if (res.status !== 0) return 1;
  await meta(slug, { refresh: true });
  return 0;
};

module.exports = {
  ready, meta, enable, CATEGORIES,
};
