//
// Tests for tower/api/server.js: caching.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  createServer, cleanup, mkWorld, listen, worldOpts, start, getJson, ghCalls,
} = require('./helpers');

const run = async () => {
  group('tower/api/server: caching');

  await test('two board reads inside the TTL make ONE graphql call', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 1, 'the second read was served from memory');
    await c.stop();
    cleanup(w.root);
  });

  await test('the roster cache means the board and health share one disk walk', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/repos');
    await getJson(c, '/api/board');
    await getJson(c, '/api/health');
    const remotes = w.calls.filter((c2) => c2[0] === 'git' && c2.includes('get-url'));
    assertEq(remotes.length, 1, 'discovery ran once for all three endpoints');
    await c.stop();
    cleanup(w.root);
  });

  await test('a failed sweep is NOT cached - the next read inside the TTL tries again', async () => {
    const w = mkWorld();
    w.ghMissing = true;
    const c = await start(w);
    const first = await getJson(c, '/api/board');
    assertEq(first.body.ok, false, 'the failure is served');
    w.ghMissing = false;
    const second = await getJson(c, '/api/board');
    assertEq(second.body.ok, true, 'the recovery is immediate, not a minute away');
    assertEq(second.body.issues.length, 2, 'and it carries the real data');
    await c.stop();
    cleanup(w.root);
  });

  await test('a failed roster read is not cached either, and still serves [] meanwhile', async () => {
    const w = mkWorld();
    // A workflow home that is not a path makes the read throw - the "read
    // failed" case, which must not take the cache slot the way a genuinely
    // empty roster does.
    const opts = worldOpts(w, { workflowHome: 42 });
    const c = await listen(createServer(opts));
    const broken = await getJson(c, '/api/repos');
    assertEq(broken.status, 200, 'the client is never handed an error page');
    assertEq(broken.body.length, 0, 'an empty roster is what it sees');
    opts.workflowHome = path.join(w.root, 'workflow-home');
    const fixed = await getJson(c, '/api/repos');
    assertEq(fixed.body.length, 1, 'the repaired roster is read at once');
    await c.stop();
    cleanup(w.root);
  });

  await test('an empty roster IS cached - nothing found is an answer', async () => {
    const w = mkWorld();
    const c = await start(w, { workflowHome: path.join(w.root, 'empty') });
    fs.mkdirSync(path.join(w.root, 'empty'), { recursive: true });
    await getJson(c, '/api/repos');
    const before = w.calls.length;
    await getJson(c, '/api/repos');
    assertEq(w.calls.length, before, 'the second read asked git nothing');
    await c.stop();
    cleanup(w.root);
  });

  await test('?fresh=1 bypasses and repopulates the cache - the refresh button works', async () => {
    const w = mkWorld();
    const c = await start(w);
    await getJson(c, '/api/board');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 1, 'cached so far');
    await getJson(c, '/api/board?fresh=1');
    assertEq(ghCalls(w, 'api').length, 2, 'the forced read went out');
    await getJson(c, '/api/board');
    assertEq(ghCalls(w, 'api').length, 2, 'and it repopulated the slot');

    const walks = () => w.calls.filter((call) => call[0] === 'git' && call.includes('get-url')).length;
    const before = walks();
    await getJson(c, '/api/repos?fresh=1');
    assertEq(walks(), before + 1, 'the roster takes the same flag');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
