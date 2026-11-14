//
// Tests for tower/api/server.js: intake, the filing write path.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const { describe, test, expect } = require('../../lib/harness');
const { execError } = require('../../lib/gh');
const {
  MAX_REQUEST_BYTES, cleanup, SLUG, mkWorld, start, postJson, raw, ghCalls,
} = require('./helpers');

describe('tower/api/server: intake, the filing write path', () => {
  test('a valid filing calls gh with exactly the expected ARGV and returns the url', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: '  Watch the tower  ', body: 'From the phone.' });
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'filed').toBe(true);
    expect(body.url, 'the url gh printed').toBe(`https://github.com/${SLUG}/issues/99`);
    const [call] = ghCalls(w, 'issue');
    expect(call.join(' '), 'ARGV, not a shell string - title trimmed, both labels present').toBe(`gh issue create --repo ${SLUG} --title Watch the tower --body From the phone. --label status:inbox --label type:idea`);
    cleanup(w.root);
  });

  test('an omitted body files the default text', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    await postJson(c, '/api/intake', { repo: SLUG, title: 'No body' });
    const [call] = ghCalls(w, 'issue');
    expect(call[call.indexOf('--body') + 1], 'the default body').toBe('Filed from Workkit.');
    cleanup(w.root);
  });

  test('a repo outside the roster is rejected without ever calling gh', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, '/api/intake', { repo: 'someone/else', title: 'Nope' });
    expect(status, 'rejected').toBe(400);
    expect(body.ok, 'not filed').toBe(false);
    expect(/unknown repo/.test(body.reason), 'the reason names it').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'gh never ran against an arbitrary string').toBe(0);
    cleanup(w.root);
  });

  test('a repo named in another case is accepted, and gh gets the roster’s spelling', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    // GitHub treats owner and repo names as case-insensitive, and the roster's
    // slug is whatever case the git remote carries - so a payload written in
    // GitHub's canonical casing names the same repository.
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG.toUpperCase(), title: 'Shouted' });
    expect(status, 'accepted').toBe(200);
    expect(body.ok, 'filed').toBe(true);
    const [call] = ghCalls(w, 'issue');
    expect(call[call.indexOf('--repo') + 1], 'gh receives the roster spelling, not the caller’s').toBe(SLUG);
    cleanup(w.root);
  });

  test('an empty title and an over-long one are both rejected, gh untouched', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const empty = await postJson(c, '/api/intake', { repo: SLUG, title: '   ' });
    expect(empty.body.ok, 'empty title out').toBe(false);
    expect(/title is required/.test(empty.body.reason), 'says why').toBeTruthy();
    const long = await postJson(c, '/api/intake', { repo: SLUG, title: 'x'.repeat(257) });
    expect(long.body.ok, '257 characters out').toBe(false);
    expect(/longer than 256/.test(long.body.reason), 'names the cap').toBeTruthy();
    const big = await postJson(c, '/api/intake', { repo: SLUG, title: 'fine', body: 'y'.repeat(4001) });
    expect(big.body.ok, 'an over-long body out').toBe(false);
    expect(/longer than 4000/.test(big.body.reason), 'names that cap too').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'no filing attempted').toBe(0);
    cleanup(w.root);
  });

  test('a gh failure is a soft-fail body, never a 500', async (t) => {
    const w = mkWorld();
    const err = execError('Command failed: gh issue create', { stderr: 'gh: To get started with GitHub CLI, please run: gh auth login\n' });
    w.createResult = err;
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Offline' });
    expect(status, 'the tower stays up').toBe(200);
    expect(body.ok, 'not filed').toBe(false);
    expect(/gh auth login/.test(body.reason), 'the underlying message survives').toBeTruthy();
    cleanup(w.root);
  });

  test('gh output carrying no url reads as a failure, not a success', async (t) => {
    const w = mkWorld();
    w.createResult = 'Creating issue in ...\n';
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await postJson(c, '/api/intake', { repo: SLUG, title: 'Silent' });
    expect(body.ok, 'no url, no claim of success').toBe(false);
    cleanup(w.root);
  });

  test('an over-cap body gets its answer before the connection closes', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const body = JSON.stringify({ repo: SLUG, title: 'huge', body: 'z'.repeat(MAX_REQUEST_BYTES + 1024) });
    const res = await raw(c, {
      method: 'POST',
      path: '/api/intake',
      headers: { host: `127.0.0.1:${c.port}`, 'content-type': 'application/json' },
      body,
    });
    expect(res.status, 'the client is TOLD, not just disconnected').toBe(413);
    expect(/larger than/.test(res.text), 'and told why').toBeTruthy();
    expect(ghCalls(w, 'issue').length, 'nothing was filed').toBe(0);
    cleanup(w.root);
  });
});
