//
// Tests for the tower dashboard's github.js: the token this browser holds.
// The shared prologue (the lib loader, the DOM double, the fixtures) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { loadLibs, mkStorage } = require('./helpers');

describe('tower/app: github - the token this browser holds', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  test('the token is read, written and forgotten in one place - localStorage, and nowhere else', () => {
    const storage = mkStorage();
    expect(github.readToken(storage), 'a fresh browser holds none').toBe('');
    github.writeToken(storage, '  fake-token-for-tests  ');
    expect(storage.held[github.TOKEN_KEY], 'stored trimmed, under the one key').toBe('fake-token-for-tests');
    expect(github.readToken(storage), 'and read back').toBe('fake-token-for-tests');
    github.clearToken(storage);
    expect(github.readToken(storage), 'forgetting it leaves nothing behind').toBe('');
    expect(Object.keys(storage.held).length, 'not even the key').toBe(0);
  });

  test('a browser that refuses storage is a viewer with no token, never a broken page', () => {
    const storage = mkStorage({}, true);
    expect(github.readToken(storage), 'the read is answered, not thrown').toBe('');
    expect(github.writeToken(storage, 'fake-token-for-tests'), 'and the write says what it tried to store').toBe('fake-token-for-tests');
    expect(github.readToken(undefined), 'no storage object at all is the same answer').toBe('');
  });

  test('a browser that throws on the storage property itself still loads the page', () => {
    // The access throws, not the read: a browser blocking all site data throws
    // on `window.localStorage`, and api.js touches it at module load, so an
    // unguarded access takes the whole bundle down rather than costing a token.
    const hostile = {};
    Object.defineProperty(hostile, 'localStorage', {
      get() { throw new Error('storage is disabled'); },
    });
    expect(github.safeStorage(hostile), 'the access is answered, not thrown').toBe(null);
    expect(github.readToken(github.safeStorage(hostile)), 'and the viewer simply holds no token').toBe('');
    expect(github.safeStorage({}), 'a global with no storage at all is the same answer').toBe(null);
    expect(github.safeStorage(undefined), 'and so is no global').toBe(null);
  });

  test('an empty value is a clear, not a stored blank', () => {
    const storage = mkStorage({ [github.TOKEN_KEY]: 'fake-token-for-tests' });
    expect(github.writeToken(storage, '   '), 'whitespace is nothing').toBe('');
    expect(github.readToken(storage), 'and the old one is gone rather than left in place').toBe('');
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

  test('the handover setup opens the page with is stored, and the fragment stripped behind it (#230)', () => {
    const landing = mkLanding('#token=gho_FAKE', '?repo=a,b');
    expect(github.takeTokenFromHash(landing), 'the fragment is where setup put the token').toBe('gho_FAKE');
    expect(landing.localStorage.held[github.TOKEN_KEY], 'stored under the one key a typed token goes under').toBe('gho_FAKE');
    expect(landing.rewrites.length, 'and the address bar is rewritten exactly once').toBe(1);
    expect(landing.rewrites[0], 'to the path and the query alone - the fragment is gone, the selection survives').toBe('/settings?repo=a,b');

    // Setup never sends one of these: `handover_token` refuses a token outside
    // `[A-Za-z0-9_-]` rather than escaping it (workflow/workkit/token.sh). The
    // decode is the guard on this side of that contract.
    const encoded = mkLanding('#token=gho_a%2Fb');
    expect(github.takeTokenFromHash(encoded), 'an encoded value is decoded on the way in: the shell refuses a token that would need escaping rather than sending one, so the decode is this side\'s own guard').toBe('gho_a/b');
    expect(encoded.rewrites[0], 'and a page with no query is stripped to its path').toBe('/settings');
  });

  test('every other fragment is left exactly as it is', () => {
    for (const hash of ['', '#something-else', '#token=', '#token=%E0%A4%A']) {
      const landing = mkLanding(hash, '?repo=a', { [github.TOKEN_KEY]: 'fake-token-for-tests' });
      expect(github.takeTokenFromHash(landing), `${hash || '(no fragment)'} carries no handover`).toBe('');
      expect(github.readToken(landing.localStorage), 'so what this browser already holds is untouched').toBe('fake-token-for-tests');
      expect(landing.rewrites.length, 'and nothing is rewritten').toBe(0);
    }
    expect(github.takeTokenFromHash({}), 'a global with no location at all is the same answer').toBe('');
    expect(github.takeTokenFromHash(undefined), 'and so is no global').toBe('');

    // Nothing to strip with is nothing taken: a token stored off a fragment that
    // stays in the address bar is the leak the strip exists to close.
    const noHistory = { location: { hash: '#token=gho_FAKE', pathname: '/settings', search: '' }, localStorage: mkStorage() };
    expect(github.takeTokenFromHash(noHistory), 'a page with no history to rewrite takes nothing from the fragment').toBe('');
    expect(Object.keys(noHistory.localStorage.held).length, 'and stores nothing it could not strip').toBe(0);
  });

  test('a browser that refuses storage reads the handover without breaking the boot', () => {
    const landing = mkLanding('#token=gho_FAKE', '', {}, true);
    expect(github.takeTokenFromHash(landing), 'the return says what the fragment CARRIED, not what the storage kept: writeToken swallows the refusal, so such a copy stays locked while the boot goes on').toBe('gho_FAKE');
    expect(landing.rewrites.length, 'and the fragment is stripped either way - a token has no business in an address bar').toBe(1);
  });
});
