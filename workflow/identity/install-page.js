// workflow/identity/install-page.js: the App's install page for an owner,
// pre-selected on it, the page the client's not-installed refusal names.

const { INSTALL_URL } = require('./app');
const { apiUrl } = require('./login');

// The refusal waits on this read, and the bare page still installs the App.
const ID_TIMEOUT_MS = 5000;

/**
 * The owner's GitHub id from `GET /users/<owner>`, or null when GitHub cannot
 * say (unreachable, slow, a refusal, or no numeric id). The endpoint is public,
 * so no sign-in rides it: an expired one would turn a readable id into a 401.
 * @param {string} owner
 * @param {Function} fetch
 * @returns {Promise<number|null>}
 */
const ownerId = async (owner, fetch) => {
  try {
    const res = await fetch(`${apiUrl()}/users/${encodeURIComponent(owner)}`, {
      headers: { 'User-Agent': 'workkit', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(ID_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const { id } = await res.json();
    return Number.isInteger(id) ? id : null;
  } catch {
    // An expected external failure: the caller names the bare page instead.
    return null;
  }
};

/**
 * The page that installs the App on `owner`: `/installations/new/permissions`
 * with the owner suggested, or the bare `/installations/new` when its id cannot
 * be read. The repo list is not pre-selected: the App installs once per owner.
 * @param {string} owner
 * @param {object} [opts]
 * @param {Function} [opts.fetch] defaults to the global fetch
 * @returns {Promise<string>}
 */
const installPage = async (owner, { fetch = globalThis.fetch } = {}) => {
  const page = `${INSTALL_URL}/installations/new`;
  const id = await ownerId(owner, fetch);
  return id === null ? page : `${page}/permissions?suggested_target_id=${id}`;
};

module.exports = { installPage };
