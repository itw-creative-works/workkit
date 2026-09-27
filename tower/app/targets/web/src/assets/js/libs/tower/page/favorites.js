// The projects a viewer keeps at the top of the selector: one browser's habit
// in localStorage, never a scope, so it never reaches the URL. The runtime
// guards the access with github.js's `safeStorage`; the storage is an argument
// so the module runs under Node and sidebar.js stays pure markup from state.

/** Where this browser's favorites live. One key, holding a JSON array of slugs. */
export const FAVORITES_KEY = 'tower.favorites';

/**
 * The favorited slugs, or []. The key is hand-editable and read on every
 * page's first paint, so anything but an array of slugs reads as none.
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
 * Turn one project's star on or off, answering with what is stored: a browser
 * that refuses storage keeps its list, so the star never shows a favorite
 * nothing remembers.
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
