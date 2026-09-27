// libs/tower/github/token.js: the viewer's token: the key, the words Settings
// shows, the storage guard, read, write, clear and the fragment handover.
// github.js re-exports it whole; no piece imports github.js.

// ── The token ──────────────────────────────────────────────────────────────

/** Where the viewer's token lives. One key, one browser, never sent anywhere but GitHub. */
export const TOKEN_KEY = 'tower.github-token';

/** Where a viewer goes to make one. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * What that token needs to be able to do: write issues, since the site manages
 * them, plus Contents: Read on the home repo, where the roster lives.
 */
export const TOKEN_SCOPES = 'a fine-grained token: Repository permissions → Issues: Read and write, Metadata: Read, Discussions: Read, on the repositories this board covers - plus Contents: Read on the home repo, which is where the list of those repositories lives.';

/** Where a viewer goes to make the other kind. */
export const TOKEN_CLASSIC_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=workkit%20tower';

/**
 * The other token that works, and the only one for a board spanning two owners:
 * a fine-grained token belongs to a single resource owner, while a classic
 * `repo` token covers every repository its account can see.
 */
export const TOKEN_CLASSIC_WORDS = 'a classic token with the repo scope';
// The Settings card links those words; the sentence is built from them so a
// rewrite can never separate the link from what it names.
export const TOKEN_CLASSIC = `${TOKEN_CLASSIC_WORDS} works too - and it is the only one that does when this board spans two owners, since a fine-grained token belongs to a single resource owner.`;

/**
 * This browser's storage, or null when it has none to give. The guard is on
 * the property access itself: a browser blocking all site data throws on
 * `window.localStorage`, and that access runs at module load in api.js.
 *
 * @param {object} [scope] - the global carrying `localStorage`, if any
 * @returns {Storage|null}
 */
export const safeStorage = (scope) => {
  try {
    return (scope && scope.localStorage) || null;
  } catch {
    return null;
  }
};

/**
 * The stored token, or ''.
 *
 * The storage is an argument because this module is imported under Node by its
 * own suite, and because a browser with storage disabled throws on the read as
 * well as on the access `safeStorage` covers.
 *
 * @param {Storage} [storage] - localStorage, or anything with getItem
 * @returns {string}
 */
export const readToken = (storage) => {
  try {
    return (storage && storage.getItem(TOKEN_KEY)) || '';
  } catch {
    return '';
  }
};

/**
 * Store a token, or clear it when the value is empty.
 *
 * @param {Storage} storage
 * @param {string} value
 * @returns {string} what is stored afterwards
 */
export const writeToken = (storage, value) => {
  const token = String(value || '').trim();
  try {
    if (token) storage.setItem(TOKEN_KEY, token);
    else storage.removeItem(TOKEN_KEY);
  } catch {
    // A browser that refuses storage cannot be given a token. The page stays locked.
  }
  return token;
};

/** Forget the token this browser holds. */
export const clearToken = (storage) => writeToken(storage, '');

/** The fragment a handover arrives in, and the only hash this module reads. */
const TOKEN_HASH = '#token=';

/**
 * The token `workkit setup` handed over in the URL fragment: stored, and the
 * fragment stripped behind it, keeping the path and `?repo=`. It runs before
 * the mode is decided (api.js), so such a landing boots holding a token. Any
 * other fragment is left alone; the decode is a guard, since setup refuses a
 * token outside `[A-Za-z0-9_-]`.
 *
 * @param {object} [scope] - the global carrying `location`, `history` and `localStorage`
 * @returns {string} the token that was handed over, or ''
 */
export const takeTokenFromHash = (scope) => {
  const where = scope && scope.location;
  const nav = scope && scope.history;
  const hash = (where && where.hash) || '';
  if (!hash.startsWith(TOKEN_HASH) || !nav || typeof nav.replaceState !== 'function') return '';
  let token = '';
  try {
    token = decodeURIComponent(hash.slice(TOKEN_HASH.length)).trim();
  } catch {
    return ''; // a fragment that is not valid encoding never carried a token
  }
  if (!token) return '';
  writeToken(safeStorage(scope), token);
  try {
    nav.replaceState(null, '', `${where.pathname || ''}${where.search || ''}`);
  } catch {
    // A browser that refuses the rewrite keeps the fragment in its address bar.
    // The token is stored either way, which is the part the boot depends on.
  }
  return token;
};
