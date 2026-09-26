//
// Tests for the tower dashboard's github.js: the one door every published read goes through.
// The shared prologue (the lib loader, the fetch stubs, the sweep fixture) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { resetIn, clockAt } = require('../../lib/gh');
const { loadLibs, mkFetch, jsonResponse, SWEEP, isRoster, mkSiteFetch } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the one door');

  /** Where the roster is read from: the home repo's default branch, through the API. */
  const ROSTER_URL = 'https://api.github.com/repos/owner/workkit/contents/data/repos.json?ref=main';

  await test('the roster feed is the private list, read from the home repo with the viewer’s token', async () => {
    // Issue #110: the site publishes only which repo is the home. The list of
    // repositories is on that repo's default branch, and reading it is an
    // authenticated call - nothing about the board's coverage is public.
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' }, {});
    const answer = await github.readFeed('/api/repos', { token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data[0].slug, 'owner/workkit', 'the roster, in the shape every page reads');
    assertEq(fetchImpl.calls.length, 2, 'the pointer and the list, and no GraphQL at all');
    assertEq(fetchImpl.calls[0].url, 'data/home.json', 'the only file published beside the pages');
    assert(!fetchImpl.calls[0].options.headers.authorization, 'read unauthenticated - it says what the site’s own URL says');
    assertEq(fetchImpl.calls[1].url, ROSTER_URL,
      'and the list from the home repo’s default branch - `main` here, which is what a pointer naming no branch falls back to (issue #112)');
    assertEq(fetchImpl.calls[1].options.headers.authorization, 'Bearer fake-token-for-tests', 'with the viewer’s token, because the list is private');
    assertEq(fetchImpl.calls[1].options.headers.accept, 'application/vnd.github.raw+json', 'asked for raw, so the answer is the file itself');
    assert(!fetchImpl.calls.some((call) => call.url === 'data/repos.json'), 'and never from the published site');
  });

  await test('the roster is read from the branch the pointer names, never an assumed main', async () => {
    // Issue #112: the publish pushes whatever branch the home clone is on and
    // says so in data/home.json. A home repo whose default branch is not `main`
    // answered 404 to every roster read while this was hardcoded, and the board
    // degraded to nothing without a word about why.
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit', branch: 'trunk' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, {});
    });
    const answer = await github.fetchSlugs({ token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'the list is read');
    assertEq(fetchImpl.calls[1].url, 'https://api.github.com/repos/owner/workkit/contents/data/repos.json?ref=trunk',
      'from the branch the publish wrote it to');
  });

  await test('the board feed is a live sweep with the viewer’s token', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['ITW-Creative-Works/workkit'], home: '' }, { data: SWEEP.data });
    const answer = await github.readFeed('/api/board', { token: 'fake-token-for-tests', fetch: fetchImpl });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.issues[0].number, 81, 'with the issues GitHub just returned');
    assertEq(fetchImpl.calls[2].options.headers.authorization, 'Bearer fake-token-for-tests', 'unlocked by the token and nothing else');
  });

  await test('a site published without its home pointer says so, and reaches GitHub not at all', async () => {
    const missing = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(404, {})
      : jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.readFeed('/api/board', { token: 't', fetch: missing });
    assertEq(answer.ok, false, 'there is nowhere to read the roster from');
    assert(/without its home repo/.test(answer.reason), `and it says which half is missing, got: ${answer.reason}`);
    assertEq(missing.calls.length, 1, 'nothing was asked of GitHub');
  });

  await test('the brief feed is that sweep plus the summaries', async () => {
    const fetchImpl = mkFetch((url, options) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['ITW-Creative-Works/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, JSON.parse(options.body).query.includes('discussions')
        ? { data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'u', createdAt: '2026-07-28T09:00:00Z', category: null }] } } } }
        : { data: SWEEP.data });
    });
    const answer = await github.readFeed('/api/brief', { token: 't', fetch: fetchImpl, generatedAt: '2026-07-29T11:00:00Z' });
    assertEq(answer.ok, true, 'answered');
    assertEq(answer.data.counts.inFlight, 1, 'the sections are built from the sweep');
    assertEq(answer.data.summaries.items[0].title, 'Tuesday', 'and the summaries ride with it');
    // And the documents the Brief page IS (#181), off the same board - a
    // published copy draws that page from this key and nothing else.
    assertEq(answer.data.documents[0].title, 'Tuesday', 'and the archive rides too');
  });

  await test('a failed sweep is a failed feed, never an empty board', async () => {
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: '' });
      return jsonResponse(401, { message: 'Bad credentials' });
    });
    const answer = await github.readFeed('/api/board', { token: 'stale', fetch: fetchImpl });
    assertEq(answer.ok, false, 'the page shows the reason, not six confident zeros');
    assert(/refused the token/.test(answer.reason), `and the reason is the token, got: ${answer.reason}`);
  });

  await test('a refused token survives the read as a refusal, not as a generic failure', async () => {
    // The status is what the runtime acts on: a token GitHub refused is the one
    // failure a new token fixes, so the page answers it with the prompt. It has
    // to reach the feed result to be acted on at all.
    const refuse = (status) => mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(status, { message: 'Bad credentials' });
    });
    for (const feedPath of ['/api/board', '/api/brief']) {
      const answer = await github.readFeed(feedPath, { token: 'expired', fetch: refuse(401) });
      assertEq(answer.status, 401, `${feedPath} carries the status GitHub refused it with`);
      assert(github.isTokenRefusal(answer), `and ${feedPath} reads as a token refusal`);
    }
    assert(github.isTokenRefusal(await github.readFeed('/api/board', { token: 'narrow', fetch: refuse(403) })), 'a 403 is the same answer - the token does not cover these repos');
    const down = await github.readFeed('/api/board', { token: 't', fetch: refuse(500) });
    assert(!github.isTokenRefusal(down), 'a server failure is not the token’s fault and must not ask for a new one');
    assert(!github.isTokenRefusal({ ok: true, status: 200 }), 'and neither is a read that worked');

    // The roster read is the FIRST thing the token is asked for (issue #110), so
    // a token that cannot see the home repo has to reach the prompt too - not
    // read as a site published without a list.
    const blindRoster = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unread = await github.readFeed('/api/board', { token: 'no-contents', fetch: blindRoster });
    assert(github.isTokenRefusal(unread), `a token that cannot read the roster is a token refusal, got: ${unread.reason}`);
  });

  await test('a spent rate limit is not a token refusal - no token typed on Settings fixes it (#213)', async () => {
    // The mark, not the status, is what tells them apart by the time the runtime
    // reads it: both wear a 403, and only one of them is answered by handing
    // over a new token. It has to survive graphql -> fetchBoard -> readFeed.
    const answering = (body, headers) => mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(403, body, headers);
    });
    const reset = resetIn(18);
    const limitHeaders = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) };

    for (const feedPath of ['/api/board', '/api/brief']) {
      const limited = await github.readFeed(feedPath, {
        token: 't',
        fetch: answering({ message: 'API rate limit exceeded for user ID 7562803.' }, limitHeaders),
      });
      assertEq(limited.status, 403, `${feedPath} still carries the status GitHub refused it with`);
      assertEq(limited.rateLimited, true, `${feedPath} carries the mark up from the sweep`);
      assertEq(limited.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`,
        `${feedPath} carries the sentence the page will draw`);
      assert(!github.isTokenRefusal(limited), `${feedPath} is left to the page, never routed to Settings`);
    }

    const refused = await github.readFeed('/api/board', {
      token: 'narrow',
      fetch: answering({ message: 'Resource not accessible by personal access token' }, { 'x-ratelimit-remaining': '4931' }),
    });
    assert(github.isTokenRefusal(refused), 'while a 403 with budget left is the token, and still goes to Settings');
    assertEq(refused.rateLimited, undefined, 'and carries no mark at all - it is added only when it is true');
  });

  await test('a limit on the ROSTER read is a limit too - the first call the token makes (#213)', async () => {
    // The roster is read over REST before the sweep goes out (issue #110), so a
    // spent budget is met THERE first. That path had its own refusal wording and
    // no mark, which sent a rate-limited viewer to Settings to type a token that
    // was never the problem.
    const reset = resetIn(18);
    const sentence = `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`;
    const limitedRoster = () => mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(403, { message: 'API rate limit exceeded for user ID 7562803.' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      })));

    const answer = await github.readFeed('/api/board', { token: 't', fetch: limitedRoster() });
    assertEq(answer.status, 403, 'the status survives the roster read');
    assertEq(answer.rateLimited, true, 'the mark rides up from the REST call through fetchSlugs');
    assertEq(answer.reason, sentence, 'and the sentence is the one the sweep would have said');
    assert(!github.isTokenRefusal(answer), 'so it is drawn on the page, never routed to Settings');

    // The two writes read that same roster, and a write refused for a limit must
    // not tell the viewer to make a token with more permission.
    const filed = await github.createIssue({ repo: 'owner/workkit', title: 'x' }, { token: 't', fetch: limitedRoster() });
    assertEq(filed.reason, sentence, 'the intake says the limit, not the write refusal');
    assertEq(filed.rateLimited, true, 'and carries the mark with it');
  });

  await test('the refusal names the fix that exists - there is no form under it', async () => {
    const answer = await github.graphql('query {}', {
      token: 'expired',
      fetch: async () => jsonResponse(401, { message: 'Bad credentials' }),
    });
    assert(!/below/.test(answer.reason), `the sentence points at no control beneath it, got: ${answer.reason}`);
    assert(/Hand over one that does/.test(answer.reason), 'it asks for a token that covers the repositories');
  });

  await test('a machine-bound feed asked of the published side is answered as one', async () => {
    const fetchImpl = mkSiteFetch({ repos: [], home: '' }, {});
    const answer = await github.readFeed('/api/telemetry', { token: 't', fetch: fetchImpl });
    assertEq(answer.ok, false, 'a published copy cannot read this machine');
    assert(/published copy can read/.test(answer.reason), `and says so, got: ${answer.reason}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
