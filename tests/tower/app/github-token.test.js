//
// Tests for the tower dashboard's github.js: the token this browser holds.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, mkStorage } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the token this browser holds');

  await test('the token is read, written and forgotten in one place - localStorage, and nowhere else', () => {
    const storage = mkStorage();
    assertEq(github.readToken(storage), '', 'a fresh browser holds none');
    github.writeToken(storage, '  fake-token-for-tests  ');
    assertEq(storage.held[github.TOKEN_KEY], 'fake-token-for-tests', 'stored trimmed, under the one key');
    assertEq(github.readToken(storage), 'fake-token-for-tests', 'and read back');
    github.clearToken(storage);
    assertEq(github.readToken(storage), '', 'forgetting it leaves nothing behind');
    assertEq(Object.keys(storage.held).length, 0, 'not even the key');
  });

  await test('a browser that refuses storage is a viewer with no token, never a broken page', () => {
    const storage = mkStorage({}, true);
    assertEq(github.readToken(storage), '', 'the read is answered, not thrown');
    assertEq(github.writeToken(storage, 'fake-token-for-tests'), 'fake-token-for-tests', 'and the write says what it tried to store');
    assertEq(github.readToken(undefined), '', 'no storage object at all is the same answer');
  });

  await test('a browser that throws on the storage property itself still loads the page', () => {
    // The documented failure is the ACCESS, not the read: a browser told to
    // block all site data throws on `window.localStorage`. api.js touches it at
    // module load and page.js at every Token click, so an unguarded access
    // takes the whole bundle down rather than costing a token.
    const hostile = {};
    Object.defineProperty(hostile, 'localStorage', {
      get() { throw new Error('storage is disabled'); },
    });
    assertEq(github.safeStorage(hostile), null, 'the access is answered, not thrown');
    assertEq(github.readToken(github.safeStorage(hostile)), '', 'and the viewer simply holds no token');
    assertEq(github.safeStorage({}), null, 'a global with no storage at all is the same answer');
    assertEq(github.safeStorage(undefined), null, 'and so is no global');
    for (const name of ['api.js', 'page.js', path.join('page', 'selector.js'), 'token.js']) {
      const src = fs.readFileSync(path.join(libs, name), 'utf8');
      assert(!/window\.localStorage/.test(src), `${name} reaches for storage only through the guard`);
    }
  });

  await test('an empty value is a clear, not a stored blank', () => {
    const storage = mkStorage({ [github.TOKEN_KEY]: 'fake-token-for-tests' });
    assertEq(github.writeToken(storage, '   '), '', 'whitespace is nothing');
    assertEq(github.readToken(storage), '', 'and the old one is gone rather than left in place');
  });

  // The page a handover lands on, as `takeTokenFromHash` sees it: the fragment,
  // the two parts the clean URL behind it is made of, and the rewrite it strips
  // with - every url `replaceState` was asked for is kept.
  const mkLanding = (hash, search = '', initial = {}, refuse = false) => {
    const rewrites = [];
    return {
      rewrites,
      location: { hash, pathname: '/settings', search },
      history: { replaceState: (state, title, url) => rewrites.push(url) },
      localStorage: mkStorage(initial, refuse),
    };
  };

  await test('the handover setup opens the page with is stored, and the fragment stripped behind it (#230)', () => {
    const landing = mkLanding('#token=gho_FAKE', '?repo=a,b');
    assertEq(github.takeTokenFromHash(landing), 'gho_FAKE', 'the fragment is where setup put the token');
    assertEq(landing.localStorage.held[github.TOKEN_KEY], 'gho_FAKE', 'stored under the one key a typed token goes under');
    assertEq(landing.rewrites.length, 1, 'and the address bar is rewritten exactly once');
    assertEq(landing.rewrites[0], '/settings?repo=a,b', 'to the path and the query alone - the fragment is gone, the selection survives');

    // Setup itself never sends one of these: `handover_token` REFUSES a token
    // outside `[A-Za-z0-9_-]` rather than escaping it (workflow/workkit/token.sh, and
    // `a token that would need escaping is refused, never escaped` proves it).
    // The decode is the guard on this side of that contract.
    const encoded = mkLanding('#token=gho_a%2Fb');
    assertEq(github.takeTokenFromHash(encoded), 'gho_a/b',
      'an encoded value is decoded on the way in: the shell refuses a token that would need escaping rather than sending one, so the decode is this side\'s own guard');
    assertEq(encoded.rewrites[0], '/settings', 'and a page with no query is stripped to its path');
  });

  await test('every other fragment is left exactly as it is', () => {
    for (const hash of ['', '#something-else', '#token=', '#token=%E0%A4%A']) {
      const landing = mkLanding(hash, '?repo=a', { [github.TOKEN_KEY]: 'fake-token-for-tests' });
      assertEq(github.takeTokenFromHash(landing), '', `${hash || '(no fragment)'} carries no handover`);
      assertEq(github.readToken(landing.localStorage), 'fake-token-for-tests', 'so what this browser already holds is untouched');
      assertEq(landing.rewrites.length, 0, 'and nothing is rewritten');
    }
    assertEq(github.takeTokenFromHash({}), '', 'a global with no location at all is the same answer');
    assertEq(github.takeTokenFromHash(undefined), '', 'and so is no global');

    // Nothing to strip WITH is nothing taken: a token stored off a fragment
    // that stays in the address bar is the leak the strip exists to close.
    const noHistory = { location: { hash: '#token=gho_FAKE', pathname: '/settings', search: '' }, localStorage: mkStorage() };
    assertEq(github.takeTokenFromHash(noHistory), '', 'a page with no history to rewrite takes nothing from the fragment');
    assertEq(Object.keys(noHistory.localStorage.held).length, 0, 'and stores nothing it could not strip');
  });

  await test('a browser that refuses storage reads the handover without breaking the boot', () => {
    const landing = mkLanding('#token=gho_FAKE', '', {}, true);
    assertEq(github.takeTokenFromHash(landing), 'gho_FAKE',
      'the return says what the fragment CARRIED, not what the storage kept: writeToken swallows the refusal, so such a copy stays locked while the boot goes on');
    assertEq(landing.rewrites.length, 1, 'and the fragment is stripped either way - a token has no business in an address bar');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
