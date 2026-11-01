// workflow/identity/install-page.js: the repo's canonical owner, read through
// the one endpoint that follows a rename, the owner's public id, and the App's
// install page pre-selected on that owner, the page the not-installed refusal names.

const { INSTALL_URL } = require('./app');
const { apiUrl } = require('./login');
const { splitRepo } = require('../slug');

// The ask and the refusal wait on these reads.
const OWNER_TIMEOUT_MS = 5000;

/**
 * The parsed body of one bounded GitHub API read, or null when GitHub cannot
 * answer (unreachable, past the bound, not ok, not JSON).
 * @param {string} url
 * @param {Function} fetch
 * @param {object} [auth] extra headers, the bearer when the read carries one
 * @returns {Promise<object|null>}
 */
const readJson = async (url, fetch, auth = {}) => {
  try {
    const res = await fetch(url, {
      headers: { ...auth, 'User-Agent': 'workkit', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(OWNER_TIMEOUT_MS),
    });
    return res.ok ? await res.json() : null;
  } catch {
    // An expected external failure: the caller says the id was unreadable.
    return null;
  }
};

/**
 * The repo's owner as GitHub knows it now, from `GET /repos/<owner>/<repo>`
 * (which follows an owner rename, where `GET /users/<old login>` answers 404),
 * or null when the read yields no login and integer id.
 * @param {string} repo owner/name as the remote spells it
 * @param {object} opts
 * @param {Function} [opts.fetch] defaults to the global fetch
 * @param {string} opts.token the user's sign-in, the read's bearer
 * @returns {Promise<{login: string, id: number}|null>}
 */
const repoOwner = async (repo, { fetch = globalThis.fetch, token }) => {
  const { owner, name } = splitRepo(repo);
  const body = await readJson(`${apiUrl()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, fetch, {
    Authorization: `Bearer ${token}`,
  });
  const login = body?.owner?.login;
  return typeof login === 'string' && login && Number.isInteger(body.owner.id) ? { login, id: body.owner.id } : null;
};

/**
 * The owner's GitHub id from the public `GET /users/<owner>` (no bearer), or
 * null when the read yields no integer id. The sign-in cannot see a private
 * repo whose owner lacks the App, so the refusal's page falls back to this.
 * @param {string} owner
 * @param {object} [opts]
 * @param {Function} [opts.fetch] defaults to the global fetch
 * @returns {Promise<number|null>}
 */
const ownerId = async (owner, { fetch = globalThis.fetch } = {}) => {
  const user = await readJson(`${apiUrl()}/users/${encodeURIComponent(owner)}`, fetch);
  return Number.isInteger(user?.id) ? user.id : null;
};

/**
 * The page that installs the App on the owner with this GitHub id, the owner
 * suggested. The repo list is not pre-selected: the App installs once per owner.
 * @param {number} id
 * @returns {string}
 */
const installPage = (id) => `${INSTALL_URL}/installations/new/permissions?suggested_target_id=${id}`;

module.exports = { repoOwner, ownerId, installPage };
