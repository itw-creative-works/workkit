// libs/tower/github/token.js: the viewer's token: the key, the words Settings
// shows, the storage guard, read, write, clear and the fragment handover.
// github.js re-exports it whole; no piece imports github.js.

// ── The token ──────────────────────────────────────────────────────────────

/** Where the viewer's token lives. One key, one browser, never sent anywhere but GitHub. */
export const TOKEN_KEY = 'tower.github-token';

/** Where a viewer goes to make one. */
export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/**
 * What that token needs to be able to do. The site MANAGES the issues it shows
 * - a card is dragged between columns and the dialog files one - so writing
 * issues is part of the ask. Contents: Read is the one addition, and only on the
 * home repo: the roster of repositories to sweep lives on its default branch
 * rather than beside the public pages (issue #110), and the token is what reads
 * it.
 */
export const TOKEN_SCOPES = 'a fine-grained token: Repository permissions → Issues: Read and write, Metadata: Read, Discussions: Read, on the repositories this board covers - plus Contents: Read on the home repo, which is where the list of those repositories lives.';

/** Where a viewer goes to make the other kind. */
export const TOKEN_CLASSIC_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=workkit%20tower';

/**
 * The other token that works, and the one board it is REQUIRED for (issue #167).
 *
 * A fine-grained token belongs to a single resource owner, so one cannot reach
 * a board whose repositories are owned by two - a personal account and an
 * organisation, say. A classic token is scoped to the ACCOUNT rather than to an
 * owner: `repo` covers every repository that account can see, whoever owns it,
 * and it is read and written through exactly the same calls.
 */
export const TOKEN_CLASSIC_WORDS = 'a classic token with the repo scope';
// The Settings card links those words; the sentence is built from them so a
// rewrite can never separate the link from what it names (issue #241).
export const TOKEN_CLASSIC = `${TOKEN_CLASSIC_WORDS} works too - and it is the only one that does when this board spans two owners, since a fine-grained token belongs to a single resource owner.`;

/**
 * This browser's storage, or null when it has none to give.
 *
 * The GUARD is on the property access itself, not on the read through it: a
 * browser told to block all site data throws on `window.localStorage` rather
 * than answering null, and that access happens at module load in api.js and at
 * every Token click in page.js - an unguarded one takes the whole bundle down.
 * A locked-down browser is a viewer with no token, not a broken page.
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
 * fragment stripped off the address bar behind it (issue #230).
 *
 * Setup already holds a token that works - the `gh` login's - so a freshly
 * published copy is unlocked with nothing typed: it waits for Pages, then opens
 * the Settings page with `#token=<token>` on the end. The carrier is the
 * FRAGMENT because a fragment is never sent in the request, so the token
 * reaches this browser without reaching a server on the way. This runs BEFORE
 * the mode is decided (api.js), which is what makes such a landing boot as a
 * copy holding a token rather than a locked one.
 *
 * It reads the ONE hash it owns: any other fragment, and any page without the
 * two globals this needs, is left exactly as it is. The value is decoded as a
 * GUARD rather than a need: setup refuses a token outside `[A-Za-z0-9_-]`
 * rather than escaping it, so nothing it hands over arrives encoded. The strip
 * keeps `?repo=` intact - the path and the query are what the clean URL is
 * made of.
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
