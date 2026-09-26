//
// Tests for tower/api/server.js: intake, the filing write path.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  MAX_REQUEST_BYTES, cleanup, SLUG, mkWorld, start, postJson, raw, ghCalls,
} = require('./helpers');

const run = async () => {
  group('tower/api/server: intake, the filing write path');

  await test('a valid filing calls gh with exactly the expected ARGV and returns the url', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: '  Watch the tower  ', body: 'From the phone.' });
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'filed');
    assertEq(body.url, `https://github.com/${SLUG}/issues/99`, 'the url gh printed');
    const [call] = ghCalls(w, 'issue');
    assertEq(call.join(' '),
      `gh issue create --repo ${SLUG} --title Watch the tower --body From the phone. --label status:inbox --label type:idea`,
      'ARGV, not a shell string - title trimmed, both labels present');
    await c.stop();
    cleanup(w.root);
  });

  await test('an omitted body files the default text', async () => {
    const w = mkWorld();
    const c = await start(w);
    await postJson(c, '/api/intake', { repo: SLUG, title: 'No body' });
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--body') + 1], 'Filed from the tower.', 'the default body');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo outside the roster is rejected without ever calling gh', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: 'someone/else', title: 'Nope' });
    assertEq(status, 400, 'rejected');
    assertEq(body.ok, false, 'not filed');
    assert(/unknown repo/.test(body.reason), 'the reason names it');
    assertEq(ghCalls(w, 'issue').length, 0, 'gh never ran against an arbitrary string');
    await c.stop();
    cleanup(w.root);
  });

  await test('a repo named in another case is accepted, and gh gets the roster’s spelling', async () => {
    const w = mkWorld();
    const c = await start(w);
    // GitHub treats owner and repo names as case-insensitive, and the roster's
    // slug is whatever case the git remote carries - so a payload written in
    // GitHub's canonical casing names the same repository.
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG.toUpperCase(), title: 'Shouted' });
    assertEq(status, 200, 'accepted');
    assertEq(body.ok, true, 'filed');
    const [call] = ghCalls(w, 'issue');
    assertEq(call[call.indexOf('--repo') + 1], SLUG, 'gh receives the roster spelling, not the caller’s');
    await c.stop();
    cleanup(w.root);
  });

  await test('an empty title and an over-long one are both rejected, gh untouched', async () => {
    const w = mkWorld();
    const c = await start(w);
    const empty = await postJson(c, '/api/intake', { repo: SLUG, title: '   ' });
    assertEq(empty.body.ok, false, 'empty title out');
    assert(/title is required/.test(empty.body.reason), 'says why');
    const long = await postJson(c, '/api/intake', { repo: SLUG, title: 'x'.repeat(257) });
    assertEq(long.body.ok, false, '257 characters out');
    assert(/longer than 256/.test(long.body.reason), 'names the cap');
    const big = await postJson(c, '/api/intake', { repo: SLUG, title: 'fine', body: 'y'.repeat(4001) });
    assertEq(big.body.ok, false, 'an over-long body out');
    assert(/longer than 4000/.test(big.body.reason), 'names that cap too');
    assertEq(ghCalls(w, 'issue').length, 0, 'no filing attempted');
    await c.stop();
    cleanup(w.root);
  });

  await test('a gh failure is a soft-fail body, never a 500', async () => {
    const w = mkWorld();
    const err = execError('Command failed: gh issue create', { stderr: 'gh: To get started with GitHub CLI, please run: gh auth login\n' });
    w.createResult = err;
    const c = await start(w);
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Offline' });
    assertEq(status, 200, 'the tower stays up');
    assertEq(body.ok, false, 'not filed');
    assert(/gh auth login/.test(body.reason), 'the underlying message survives');
    await c.stop();
    cleanup(w.root);
  });

  await test('gh output carrying no url reads as a failure, not a success', async () => {
    const w = mkWorld();
    w.createResult = 'Creating issue in ...\n';
    const c = await start(w);
    const { body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Silent' });
    assertEq(body.ok, false, 'no url, no claim of success');
    await c.stop();
    cleanup(w.root);
  });

  await test('an over-cap body gets its answer before the connection closes', async () => {
    const w = mkWorld();
    const c = await start(w);
    const body = JSON.stringify({ repo: SLUG, title: 'huge', body: 'z'.repeat(MAX_REQUEST_BYTES + 1024) });
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body,
    });
    assertEq(res.status, 413, 'the client is TOLD, not just disconnected');
    assert(/larger than/.test(res.text), 'and told why');
    assertEq(ghCalls(w, 'issue').length, 0, 'nothing was filed');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
