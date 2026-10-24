//
// Tests for the tower dashboard's favorites.js: the projects pinned to the top.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, mkStorage } = require('./helpers');

const run = async () => {
  const { favorites, github } = await loadLibs();

  group('tower/app: favorites - the projects pinned to the top');

  await test('a favorite is stored under one key, as a list of slugs', () => {
    const storage = mkStorage();
    assertEq(favorites.FAVORITES_KEY, 'tower.favorites', 'the one key, named where both halves read it');
    assertEq(favorites.readFavorites(storage).length, 0, 'a fresh browser has starred nothing');
    assertEq(favorites.toggleFavorite(storage, 'ITW/workkit').join(','), 'ITW/workkit', 'the toggle answers with the list as it now stands');
    assertEq(storage.held[favorites.FAVORITES_KEY], '["ITW/workkit"]', 'stored as JSON, so nothing else has to parse a format of its own');
    assertEq(favorites.readFavorites(storage).join(','), 'ITW/workkit', 'and read back');
    assertEq(favorites.toggleFavorite(storage, 'Omega/omega').join(','), 'ITW/workkit,Omega/omega', 'a second star joins the first, in the order they were kept');
    assertEq(favorites.toggleFavorite(storage, 'ITW/workkit').join(','), 'Omega/omega', 'and the same star again takes it off');
    assertEq(storage.held[favorites.FAVORITES_KEY], '["Omega/omega"]', 'which is what is left in storage');
  });

  await test('anything that is not a list of slugs is read as no favorites at all', () => {
    // The key is hand-editable and outlives whatever version of the tower wrote
    // it, and it is read on the first paint of every page - so junk costs the
    // stars, never the page.
    for (const junk of ['{not json', '{"workkit":true}', '"workkit"', '42', 'null', '']) {
      assertEq(favorites.readFavorites(mkStorage({ [favorites.FAVORITES_KEY]: junk })).length, 0, `${junk || '(empty)'} is no favorites`);
    }
    const mixed = mkStorage({ [favorites.FAVORITES_KEY]: '["workkit", 7, null, {"a":1}, "", "omega"]' });
    assertEq(favorites.readFavorites(mixed).join(','), 'workkit,omega', 'a list with rubbish in it keeps the slugs and drops the rest');
  });

  await test('a browser that blocks site data has no favorites, and is never thrown at', () => {
    // The access itself is what throws (github/token.js), so the runtime hands over
    // null and this has to answer for it: a viewer who cannot store a star sees
    // none, and the menu keeps the order it had rather than pinning a project
    // until the next reload.
    const blocked = github.safeStorage((() => {
      const hostile = {};
      Object.defineProperty(hostile, 'localStorage', { get() { throw new Error('storage is disabled'); } });
      return hostile;
    })());
    assertEq(blocked, null, 'the guard answers null rather than a storage');
    assertEq(favorites.readFavorites(blocked).length, 0, 'so the list is empty');
    assertEq(favorites.toggleFavorite(blocked, 'workkit').length, 0, 'and the toggle is a no-op that says so');
    const refusing = mkStorage({}, true);
    assertEq(favorites.readFavorites(refusing).length, 0, 'a storage that throws on the read is the same answer');
    assertEq(favorites.toggleFavorite(refusing, 'workkit').length, 0, 'and one that throws on the write keeps the list it had');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
