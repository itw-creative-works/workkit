/**
 * workflow/lib/discussions.js: GitHub's Discussions GraphQL for the home repo:
 * its cached meta, the switch that turns them on, the category a post lands
 * in, and the list and the create of posts. The morning's marker
 * (jobs/morning/marker.js) holds one bounded read of its own. Best
 * effort: no `gh`, no network or a refusing token is a null or a failing code.
 * Categories cannot be created over the API.
 * Usage: const { ready, meta, enable, resolveCategory, list, create, CATEGORIES, BRIEF_CATEGORY } = require('../lib/discussions');
 */

const fs = require('fs');
const { isPlain, parseJson } = require('../../hooks/mods/settings.js');
const {
  dropLock, isFile, stateLockPath, takeLock,
} = require('./lock');
const { readJsonOrNull } = require('./read');
const { onPath, spawnSync } = require('./run');
const { spin } = require('./spin');
const { editJson } = require('./write');
const { userDir } = require('../user-dir');

// The category the morning's brief posts in.
const BRIEF_CATEGORY = 'Brief';

// The four setup checks for, one per summary cadence plus the brief's. A repo
// without them still gets its posts, in a fallback.
const CATEGORIES = ['Daily', 'Weekly', 'Monthly', BRIEF_CATEGORY];
const FALLBACKS = ['General', 'Announcements'];

// The most of one GraphQL answer kept, ample for 50 posts with their bodies.
const GRAPHQL_MAX_BUFFER = 64 * 1024 * 1024;

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

const CREATE_MUTATION = `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){
      createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){
        discussion { url }
      }
    }`;

// The API takes no date argument, so the list's window is applied here.
const LIST_QUERY = `query($owner:String!,$name:String!,$catId:ID!,$limit:Int!){
      repository(owner:$owner,name:$name){
        discussions(first:$limit, categoryId:$catId, orderBy:{field:CREATED_AT, direction:DESC}){
          nodes { title createdAt body }
        }
      }
    }`;

/** The disposable cache file in the machine folder (`WK_HOME_CACHE` of lib.sh). */
const cacheFile = () => `${userDir()}/.cache.json`;

/**
 * `gh api graphql` with <fields>, its stdout read, its stderr dropped. A
 * string field goes as an `-f` pair; an array goes as written (`['-F', 'limit=50']`).
 */
const graphql = (fields) => spawnSync('gh', ['api', 'graphql', ...fields.flatMap((field) => (Array.isArray(field) ? field : ['-f', field]))], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GRAPHQL_MAX_BUFFER, windowsHide: true,
});

/**
 * Whether the Discussions calls can run: `gh` is on PATH.
 * @returns {boolean}
 */
const ready = () => onPath('gh') !== null;

/**
 * The meta of an API answer, what the cache keeps: the node id, whether
 * Discussions are on, every category's id by its name.
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

/** The fetch: one GraphQL read of <slug>, spun with no one line, since gh's stderr is dropped; null when it could not answer. */
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
 * The home repo's meta, from the cache unless <refresh>, else fetched and
 * cached.
 * @param {string} slug `owner/name`
 * @param {{refresh?: boolean}} [opts] refresh: fetch past the cache
 * @returns {Promise<object|null>} the meta, null with no `gh` or when the API could not answer
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
 * Discussions turned on, after a fresh read, so a repo that
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

/** The id <found> holds for the category <name>, or '' with none. */
const idIn = (found, name) => {
  const id = isPlain(found.categories) ? found.categories[name] : undefined;
  return typeof id === 'string' ? id : '';
};

/**
 * The category a post lands in. A miss is refreshed once (a category made by
 * hand since), then falls back to `General`, `Announcements`, and last to the
 * first category the repo has, so a repo whose categories were renamed still
 * has somewhere to publish.
 * @param {string} slug `owner/name`
 * @param {string} name the category asked for
 * @returns {Promise<{id: string, name: string, fellBack: boolean}|null>} fellBack: the name is not the one asked for; null when the API could not answer or the repo has no category
 */
const resolveCategory = async (slug, name) => {
  let found = await meta(slug);
  if (found === null) return null;
  if (!idIn(found, name)) {
    found = await meta(slug, { refresh: true });
    if (found === null) return null;
  }
  const landed = [name, ...FALLBACKS].find((candidate) => idIn(found, candidate));
  if (landed !== undefined) return { id: idIn(found, landed), name: landed, fellBack: landed !== name };
  const [first] = Object.entries(isPlain(found.categories) ? found.categories : {});
  if (first === undefined || typeof first[1] !== 'string' || !first[1]) return null;
  return { id: first[1], name: first[0], fellBack: first[0] !== name };
};

/**
 * The posts in a category since a moment, newest first. The category resolves
 * as resolveCategory does, fallback included.
 * @param {string} slug `owner/name`
 * @param {string} category
 * @param {string} since an ISO 8601 moment; a post created at it is kept
 * @param {number} [limit] the most posts read
 * @returns {Promise<Array<{title: string, createdAt: string, body: string}>|null>} null when the API could not answer
 */
const list = async (slug, category, since, limit = 50) => {
  if (!ready()) return null;
  const resolved = await resolveCategory(slug, category);
  if (resolved === null) return null;
  const owner = slug.split('/')[0];
  const name = slug.split('/').pop();
  const res = spin(`reading what ${slug} already carries`, () => graphql([
    `owner=${owner}`, `name=${name}`, `catId=${resolved.id}`, ['-F', `limit=${limit}`], `query=${LIST_QUERY}`,
  ]), { line: false });
  const answer = res.status === 0 ? parseJson(res.stdout) : null;
  if (answer === null) return null;
  const nodes = answer.data?.repository?.discussions?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node) => isPlain(node) && typeof node.createdAt === 'string' && node.createdAt >= since);
};

/**
 * One summary or brief posted. The body is a file, sent verbatim by `gh`'s
 * `@file` form; the category is an id the caller resolved, so it can report a
 * fallback.
 * @param {string} slug `owner/name`
 * @param {string} categoryId
 * @param {string} title
 * @param {string} bodyFile
 * @returns {Promise<string|null>} the post's URL, '' when the answer holds none, null when the body file or the category id is missing or the API refused
 */
const create = async (slug, categoryId, title, bodyFile) => {
  if (!ready()) return null;
  if (!isFile(bodyFile) || !categoryId) return null;
  const repoId = (await meta(slug))?.repositoryId;
  if (typeof repoId !== 'string' || !repoId) return null;
  const res = spin(`posting ${title}`, () => graphql([
    `repoId=${repoId}`, `catId=${categoryId}`, `title=${title}`, ['-F', `body=@${bodyFile}`], `query=${CREATE_MUTATION}`,
  ]), { line: false });
  const answer = res.status === 0 ? parseJson(res.stdout) : null;
  if (answer === null) return null;
  const url = answer.data?.createDiscussion?.discussion?.url;
  return typeof url === 'string' ? url : '';
};

module.exports = {
  ready, meta, enable, resolveCategory, list, create, CATEGORIES, BRIEF_CATEGORY,
};
