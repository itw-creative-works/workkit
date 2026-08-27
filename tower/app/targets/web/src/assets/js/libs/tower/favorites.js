//
// The projects a viewer keeps at the top of the selector.
//
// A roster ranks every repo equally, and the handful worked on daily are the
// ones the switch is always reaching for (issue #186). A favorite says so, and
// says nothing else: the star on a row lifts that project above the others in
// the menu, and the board underneath is untouched - it is not a scope, not a
// subset and not a selection, so it never reaches the URL the way `?repo=` does.
//
// It belongs to the BROWSER rather than to the machine or the repo - one
// viewer's habit, held in localStorage beside the token github.js keeps there
// and read with the same care: a browser told to block all site data throws on
// the property itself, and a viewer who cannot store a favorite is a viewer with
// none rather than a page that will not load. The access guard is that module's
// `safeStorage`, called once by the runtime; what is here is the read and the
// write behind it.
//
// The storage is an ARGUMENT, github.js's pattern exactly, so the whole module
// imports and answers under Node - and so sidebar.js can stay pure markup from
// state, with the list riding the state object the menu is drawn from.
//

/** Where this browser's favorites live. One key, holding a JSON array of slugs. */
export const FAVORITES_KEY = 'tower.favorites';

/**
 * The favorited slugs, or [].
 *
 * Junk-tolerant on purpose: the key is hand-editable, shared with whatever a
 * future tower writes there, and read on the first paint of every page - so
 * anything that is not an array of slugs is read as no favorites at all rather
 * than thrown over the runtime that asked.
 *
 * @param {Storage} [storage] - localStorage, or anything with getItem
 * @returns {string[]}
 */
export const readFavorites = (storage) => {
  let raw = '';
  try {
    raw = (storage && storage.getItem(FAVORITES_KEY)) || '';
  } catch {
    return [];
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((slug) => typeof slug === 'string' && slug);
};

/**
 * Turn one project's star on or off, and answer with the list as it now stands.
 *
 * The answer is what is STORED, not what was asked for: a browser that refuses
 * storage keeps the list it had, so the star the runtime redraws from this can
 * never show a favorite that nothing remembers.
 *
 * @param {Storage} storage
 * @param {string} slug - the repo the star belongs to
 * @returns {string[]} the favorites after the toggle
 */
export const toggleFavorite = (storage, slug) => {
  const held = readFavorites(storage);
  const next = held.includes(slug) ? held.filter((one) => one !== slug) : [...held, slug];
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // A browser that refuses storage cannot hold a favorite. The menu keeps the
    // order it had rather than pinning a project until the next reload.
    return held;
  }
  return next;
};
