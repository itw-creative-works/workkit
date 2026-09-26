//
// Tests for tower/api/server.js: who may reach the tower, and CORS for the dashboard origin.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  cleanup, SLUG, mkWorld, start, raw, ghCalls,
} = require('./helpers');

const run = async () => {
  group('tower/api/server: who may reach the tower');

  await test('a Host the tower does not answer to is 403, on a plain read', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, { path: '/api/repos', headers: { host: 'evil.example.com' } });
    assertEq(res.status, 403, 'a page that resolved its own name here gets nothing');
    assert(/host not allowed/.test(res.text), 'the reason names it');
    const ok = await raw(c, { path: '/api/repos', headers: { host: `localhost:${c.port}` } });
    assertEq(ok.status, 200, 'localhost is on the list, port and all');
    // The IPv6 loopback arrives bracketed - the allowlist must survive its own
    // URL-parse normalization (a bare ::1 in the constant silently drops out).
    const six = await raw(c, { path: '/api/repos', headers: { host: `[::1]:${c.port}` } });
    assertEq(six.status, 200, 'the IPv6 loopback is local too');
    await c.stop();
    cleanup(w.root);
  });

  await test('a Host or Origin carrying userinfo is refused, not parsed down to its tail', async () => {
    const w = mkWorld();
    const c = await start(w);
    // URL parsing reads everything before an `@` as userinfo and drops it, so
    // `evil.com@localhost` would answer `localhost` and pass an allowlist that
    // has never heard of evil.com. Neither header has a userinfo component.
    const host = await raw(c, { path: '/api/repos', headers: { host: 'evil.com@localhost' } });
    assertEq(host.status, 403, 'the Host gate is not walked through');
    assert(!/"slug"/.test(host.text), 'and no roster leaked');

    const origin = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'http://evil.com@localhost' },
    });
    assertEq(origin.status, 403, 'the Origin gate is not either');
    assertEq(origin.headers['access-control-allow-origin'], undefined, 'and nothing is echoed back');
    await c.stop();
    cleanup(w.root);
  });

  await test('a preflight carrying no Origin is not a browser asking, and is refused', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}` },
    });
    assertEq(res.status, 405, 'it falls through to the method check like any other verb');
    assertEq(res.headers['access-control-allow-methods'], undefined, 'no preflight answer');
    await c.stop();
    cleanup(w.root);
  });

  await test('a tailnet hostname passes once it is in the allowlist, by opt or by env', async () => {
    const w = mkWorld();
    const c = await start(w, { allowHosts: ['tower.tailnet.ts.net'] });
    const res = await raw(c, { path: '/api/repos', headers: { host: 'tower.tailnet.ts.net' } });
    assertEq(res.status, 200, 'tailscale serve fronts the tower under its own name');
    await c.stop();

    const before = process.env.TOWER_ALLOW_HOST;
    try {
      process.env.TOWER_ALLOW_HOST = 'mac.tailnet.ts.net, other.example';
      const env = await start(w);
      const viaEnv = await raw(env, { path: '/api/repos', headers: { host: 'mac.tailnet.ts.net' } });
      assertEq(viaEnv.status, 200, 'TOWER_ALLOW_HOST is the deployment knob');
      const off = await raw(env, { path: '/api/repos', headers: { host: 'nope.example' } });
      assertEq(off.status, 403, 'and it extends the list rather than opening it');
      await env.stop();
    } finally {
      if (before === undefined) delete process.env.TOWER_ALLOW_HOST;
      else process.env.TOWER_ALLOW_HOST = before;
    }
    cleanup(w.root);
  });

  await test('the write path rejects an off-list Origin without calling gh', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'Cross-site' }),
    });
    assertEq(res.status, 403, 'refused');
    assert(/origin not allowed/.test(res.text), 'the reason names it');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran');
    await c.stop();
    cleanup(w.root);
  });

  await test('the page’s own Origin passes, and an absent Origin passes too', async () => {
    const w = mkWorld();
    const c = await start(w);
    const same = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: `http://127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From the page' }),
    });
    assertEq(same.status, 200, 'a browser sends Origin on a same-origin POST');
    assert(/"ok":true/.test(same.text), 'filed');

    const curl = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: SLUG, title: 'From curl' }),
    });
    assertEq(curl.status, 200, 'no Origin at all is a non-browser client');
    assertEq(ghCalls(w, 'issue').length, 2, 'both filings went through');
    await c.stop();
    cleanup(w.root);
  });

  group('tower/api/server: CORS for the dashboard origin');

  await test('an allowed origin gets the header echoed back, never a star', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://localhost:4300' },
    });
    assertEq(res.status, 200, 'the dashboard reads the board');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'echoed, so the browser keeps the body');
    assertEq(res.headers.vary, 'Origin', 'and a shared cache cannot mix two origins up');
    assert(/"slug"/.test(res.text), 'the body is the real answer');
    await c.stop();
    cleanup(w.root);
  });

  await test('an off-list origin gets neither the header nor the data', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      path: '/api/repos',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com' },
    });
    assertEq(res.status, 403, 'refused outright');
    assertEq(res.headers['access-control-allow-origin'], undefined, 'no header');
    assert(!/"slug"/.test(res.text), 'and no board in the body');
    await c.stop();
    cleanup(w.root);
  });

  await test('the intake preflight answers with the methods, headers and a max-age', async () => {
    const w = mkWorld();
    const c = await start(w);
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
    assertEq(res.status, 204, 'answered, not 405');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'for this origin');
    assert(/POST/.test(res.headers['access-control-allow-methods']), 'the write method is allowed');
    assert(/content-type/.test(res.headers['access-control-allow-headers']), 'and the JSON content type');
    assert(Number(res.headers['access-control-max-age']) > 0, 'cached, so every filing is not two round trips');
    await c.stop();
    cleanup(w.root);
  });

  await test('a preflight from an off-list origin is refused', async () => {
    const w = mkWorld();
    const c = await start(w);
    const res = await raw(c, {
      method: 'OPTIONS',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    assertEq(res.status, 403, 'the preflight is judged by the same allowlist');
    assertEq(res.headers['access-control-allow-origin'], undefined, 'and says nothing else');
    await c.stop();
    cleanup(w.root);
  });

  await test('the cross-origin POST that follows the preflight files the issue', async () => {
    const w = mkWorld();
    const c = await start(w);
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
    assertEq(res.status, 200, 'filed');
    assertEq(res.headers['access-control-allow-origin'], 'https://localhost:4300', 'and the answer is readable to the page');
    assertEq(ghCalls(w, 'issue').length, 1, 'gh ran once');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
