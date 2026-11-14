//
// Tests for the tower dashboard's favorites.js: the projects pinned to the top.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkStorage } = require('./helpers');

describe('tower/app: favorites - the projects pinned to the top', () => {
  let favorites, github;
  before(async () => { ({ favorites, github } = await loadLibs()); });

  test('a favorite is stored under one key, as a list of slugs', () => {
    const storage = mkStorage();
    expect(favorites.FAVORITES_KEY, 'the one key, named where both halves read it').toBe('tower.favorites');
    expect(favorites.readFavorites(storage).length, 'a fresh browser has starred nothing').toBe(0);
    expect(favorites.toggleFavorite(storage, 'ITW/workkit').join(','), 'the toggle answers with the list as it now stands').toBe('ITW/workkit');
    expect(storage.held[favorites.FAVORITES_KEY], 'stored as JSON, so nothing else has to parse a format of its own').toBe('["ITW/workkit"]');
    expect(favorites.readFavorites(storage).join(','), 'and read back').toBe('ITW/workkit');
    expect(favorites.toggleFavorite(storage, 'Omega/omega').join(','), 'a second star joins the first, in the order they were kept').toBe('ITW/workkit,Omega/omega');
    expect(favorites.toggleFavorite(storage, 'ITW/workkit').join(','), 'and the same star again takes it off').toBe('Omega/omega');
    expect(storage.held[favorites.FAVORITES_KEY], 'which is what is left in storage').toBe('["Omega/omega"]');
  });

  test('anything that is not a list of slugs is read as no favorites at all', () => {
    // The key is hand-editable and outlives whatever version of the tower wrote
    // it, and it is read on the first paint of every page - so junk costs the
    // stars, never the page.
    for (const junk of ['{not json', '{"workkit":true}', '"workkit"', '42', 'null', '']) {
      expect(favorites.readFavorites(mkStorage({ [favorites.FAVORITES_KEY]: junk })).length, `${junk || '(empty)'} is no favorites`).toBe(0);
    }
    const mixed = mkStorage({ [favorites.FAVORITES_KEY]: '["workkit", 7, null, {"a":1}, "", "omega"]' });
    expect(favorites.readFavorites(mixed).join(','), 'a list with rubbish in it keeps the slugs and drops the rest').toBe('workkit,omega');
  });

  test('a browser that blocks site data has no favorites, and is never thrown at', () => {
    // The access itself is what throws (github/token.js), so the runtime hands over
    // null and this has to answer for it: a viewer who cannot store a star sees
    // none, and the menu keeps the order it had rather than pinning a project
    // until the next reload.
    const blocked = github.safeStorage((() => {
      const hostile = {};
      Object.defineProperty(hostile, 'localStorage', { get() { throw new Error('storage is disabled'); } });
      return hostile;
    })());
    expect(blocked, 'the guard answers null rather than a storage').toBe(null);
    expect(favorites.readFavorites(blocked).length, 'so the list is empty').toBe(0);
    expect(favorites.toggleFavorite(blocked, 'workkit').length, 'and the toggle is a no-op that says so').toBe(0);
    const refusing = mkStorage({}, true);
    expect(favorites.readFavorites(refusing).length, 'a storage that throws on the read is the same answer').toBe(0);
    expect(favorites.toggleFavorite(refusing, 'workkit').length, 'and one that throws on the write keeps the list it had').toBe(0);
  });
});
