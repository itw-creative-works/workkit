//
// Tests for tower/api/server.js: who may reach the tower, and CORS for the dashboard origin.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const {
  cleanup, SLUG, mkWorld, start, raw, ghCalls,
} = require('./helpers');

describe('tower/api/server: who may reach the tower', () => {
  test('a Host the tower does not answer to is 403, on a plain read', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, { path: '/api/repos', headers: { host: 'evil.example.com' } });
    expect(res.status, 'a page that resolved its own name here gets nothing').toBe(403);
    expect(/host not allowed/.test(res.text), 'the reason names it').toBeTruthy();
    const ok = await raw(c, { path: '/api/repos', headers: { host: `localhost:${c.port}` } });
    expect(ok.status, 'localhost is on the list, port and all').toBe(200);
    // The IPv6 loopback arrives bracketed - the allowlist must survive its own
    // URL-parse normalization (a bare ::1 in the constant silently drops out).
    const six = await raw(c, { path: '/api/repos', headers: { host: `[::1]:${c.port}` } });
    expect(six.status, 'the IPv6 loopback is local too').toBe(200);
    cleanup(w.root);
  });

  test('a Host or Origin carrying userinfo is refused, not parsed down to its tail', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    // URL parsing reads everything before an `@` as userinfo and drops it, so
    // `evil.com@localhost` would answer `localhost` and pass an allowlist that
    // has never heard of evil.com. Neither header has a userinfo component.
    const host = await raw(c, { path: '/api/repos', headers: { host: 'evil.com@localhost' } });
    expect(host.status, 'the Host gate is not walked through').toBe(403);
    expect(!/"slug"/.test(host.text), 'and no roster leaked').toBeTruthy();

    const origin = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'http://evil.com@localhost' },
    });
    expect(origin.status, 'the Origin gate is not either').toBe(403);
    expect(origin.headers['access-control-allow-origin'], 'and nothing is echoed back').toBe(undefined);
    cleanup(w.root);
  });

  test('a preflight carrying no Origin is not a browser asking, and is refused', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}` },
    });
    expect(res.status, 'it falls through to the method check like any other verb').toBe(405);
    expect(res.headers['access-control-allow-methods'], 'no preflight answer').toBe(undefined);
    cleanup(w.root);
  });

  test('a tailnet hostname passes once it is in the allowlist, by opt or by env', async (t) => {
    const w = mkWorld();
    const c = await start(w, { allowHosts: ['tower.tailnet.ts.net'] });
    t.after(() => c.stop());
    const res = await raw(c, { path: '/api/repos', headers: { host: 'tower.tailnet.ts.net' } });
    expect(res.status, 'tailscale serve fronts the tower under its own name').toBe(200);

    const before = process.env.TOWER_ALLOW_HOST;
    try {
      process.env.TOWER_ALLOW_HOST = 'mac.tailnet.ts.net, other.example';
      const env = await start(w);
      t.after(() => env.stop());
      const viaEnv = await raw(env, { path: '/api/repos', headers: { host: 'mac.tailnet.ts.net' } });
      expect(viaEnv.status, 'TOWER_ALLOW_HOST is the deployment knob').toBe(200);
      const off = await raw(env, { path: '/api/repos', headers: { host: 'nope.example' } });
      expect(off.status, 'and it extends the list rather than opening it').toBe(403);
    } finally {
      if (before === undefined) delete process.env.TOWER_ALLOW_HOST;
      else process.env.TOWER_ALLOW_HOST = before;
    }
    cleanup(w.root);
  });

  test('the write path rejects an off-list Origin without calling gh', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'Cross-site' }),
    });
    expect(res.status, 'refused').toBe(403);
    expect(/origin not allowed/.test(res.text), 'the reason names it').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'gh never ran').toBe(0);
    cleanup(w.root);
  });

  test('the page’s own Origin passes, and an absent Origin passes too', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const same = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: `http://127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From the page' }),
    });
    expect(same.status, 'a browser sends Origin on a same-origin POST').toBe(200);
    expect(/"ok":true/.test(same.text), 'filed').toBeTruthy();

    const curl = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From curl' }),
    });
    expect(curl.status, 'no Origin at all is a non-browser client').toBe(200);
    expect(ghCalls(w, 'issue').length, 'both filings went through').toBe(2);
    cleanup(w.root);
  });
});

describe('tower/api/server: CORS for the dashboard origin', () => {
  test('an allowed origin gets the header echoed back, never a star', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300' },
    });
    expect(res.status, 'the dashboard reads the board').toBe(200);
    expect(res.headers['access-control-allow-origin'], 'echoed, so the browser keeps the body').toBe('https://localhost:4300');
    expect(res.headers.vary, 'and a shared cache cannot mix two origins up').toBe('Origin');
    expect(/"slug"/.test(res.text), 'the body is the real answer').toBeTruthy();
    cleanup(w.root);
  });

  test('an off-list origin gets neither the header nor the data', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com' },
    });
    expect(res.status, 'refused outright').toBe(403);
    expect(res.headers['access-control-allow-origin'], 'no header').toBe(undefined);
    expect(!/"slug"/.test(res.text), 'and no board in the body').toBeTruthy();
    cleanup(w.root);
  });

  test('the intake preflight answers with the methods, headers and a max-age', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status, 'answered, not 405').toBe(204);
    expect(res.headers['access-control-allow-origin'], 'for this origin').toBe('https://localhost:4300');
    expect(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed').toBeTruthy();
    expect(/content-type/.test(res.headers['access-control-allow-headers']), 'and the JSON content type').toBeTruthy();
    expect(Number(res.headers['access-control-max-age']) > 0, 'cached, so every filing is not two round trips').toBeTruthy();
    cleanup(w.root);
  });

  test('a preflight from an off-list origin is refused', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    expect(res.status, 'the preflight is judged by the same allowlist').toBe(403);
    expect(res.headers['access-control-allow-origin'], 'and says nothing else').toBe(undefined);
    cleanup(w.root);
  });

  test('the cross-origin POST that follows the preflight files the issue', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: {
        host: `127.0.0.1:${c.port}`,
        origin: 'https://localhost:4300',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ repo: SLUG, title: 'From the dashboard' }),
    });
    expect(res.status, 'filed').toBe(200);
    expect(res.headers['access-control-allow-origin'], 'and the answer is readable to the page').toBe('https://localhost:4300');
    expect(ghCalls(w, 'issue').length, 'gh ran once').toBe(1);
    cleanup(w.root);
  });
});
