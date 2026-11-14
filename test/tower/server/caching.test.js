//
// Tests for tower/api/server.js: caching.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const {
  createServer, cleanup, mkWorld, listen, worldOpts, start, getJson, ghCalls,
} = require('./helpers');

describe('tower/api/server: caching', () => {
  test('two board reads inside the TTL make ONE graphql call', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    expect(ghCalls(w, 'api').length, 'the second read was served from memory').toBe(1);
    cleanup(w.root);
  });

  test('the roster cache means the board and health share one disk walk', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    await getJson(c, '/api/repos');
    await getJson(c, '/api/board');
    await getJson(c, '/api/health');
    const remotes = w.calls.filter((c2) => c2[0] === 'git' && c2.includes('get-url'));
    expect(remotes.length, 'discovery ran once for all three endpoints').toBe(1);
    cleanup(w.root);
  });

  test('a failed sweep is NOT cached - the next read inside the TTL tries again', async (t) => {
    const w = mkWorld();
    w.ghMissing = true;
    const c = await start(w);
    t.after(() => c.stop());
    const first = await getJson(c, '/api/board');
    expect(first.body.ok, 'the failure is served').toBe(false);
    w.ghMissing = false;
    const second = await getJson(c, '/api/board');
    expect(second.body.ok, 'the recovery is immediate, not a minute away').toBe(true);
    expect(second.body.issues.length, 'and it carries the real data').toBe(2);
    cleanup(w.root);
  });

  test('a failed roster read is not cached either, and still serves [] meanwhile', async (t) => {
    const w = mkWorld();
    // A workflow home that is not a path makes the read throw - the "read
    // failed" case, which must not take the cache slot the way a genuinely
    // empty roster does.
    const opts = worldOpts(w, { workflowHome: 42 });
    const c = await listen(createServer(opts));
    t.after(() => c.stop());
    const broken = await getJson(c, '/api/repos');
    expect(broken.status, 'the client is never handed an error page').toBe(200);
    expect(broken.body.length, 'an empty roster is what it sees').toBe(0);
    opts.workflowHome = path.join(w.root, 'workflow-home');
    const fixed = await getJson(c, '/api/repos');
    expect(fixed.body.length, 'the repaired roster is read at once').toBe(1);
    cleanup(w.root);
  });

  test('an empty roster IS cached - nothing found is an answer', async (t) => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'empty') });
    t.after(() => c.stop());
    fs.mkdirSync(path.join(w.root, 'empty'), { recursive: true });
    await getJson(c, '/api/repos');
    const before = w.calls.length;
    await getJson(c, '/api/repos');
    expect(w.calls.length, 'the second read asked git nothing').toBe(before);
    cleanup(w.root);
  });

  test('?fresh=1 bypasses and repopulates the cache - the refresh button works', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    expect(ghCalls(w, 'api').length, 'cached so far').toBe(1);
    await getJson(c, '/api/board?fresh=1');
    expect(ghCalls(w, 'api').length, 'the forced read went out').toBe(2);
    await getJson(c, '/api/board');
    expect(ghCalls(w, 'api').length, 'and it repopulated the slot').toBe(2);

    const walks = () => w.calls.filter((call) => call[0] === 'git' && call.includes('get-url')).length;
    const before = walks();
    await getJson(c, '/api/repos?fresh=1');
    expect(walks(), 'the roster takes the same flag').toBe(before + 1);
    cleanup(w.root);
  });
});
