//
// Tests for the tower dashboard's github.js: the one door every published read goes through.
// The shared prologue (the lib loader, the fetch stubs, the sweep fixture) is ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { resetIn, clockAt } = require('../../lib/gh');
const {
  loadLibs, mkFetch, jsonResponse, SWEEP, USER_URL, isRoster, mkSiteFetch,
} = require('./helpers');

describe('tower/app: github - the one door', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  /** Where the roster is read from: the home repo's default branch, through the API. */
  const ROSTER_URL = 'https://api.github.com/repos/owner/workkit/contents/data/repos.json';

  test('the roster feed is the private list, read from the home repo with the viewer’s token', async () => {
    // The site publishes only which repo is the home: the list is on that repo's
    // default branch, and reading it is an authenticated call.
    const fetchImpl = mkSiteFetch({ repos: ['owner/workkit'], home: 'owner/workkit' }, {});
    const answer = await github.readFeed('/api/repos', { token: 'fake-token-for-tests', fetch: fetchImpl });
    expect(answer.ok, 'answered').toBe(true);
    expect(answer.data[0].slug, 'the roster, in the shape every page reads').toBe('owner/workkit');
    expect(fetchImpl.calls.length, 'the pointer and the list, and no GraphQL at all').toBe(2);
    expect(fetchImpl.calls[0].url, 'the only file published beside the pages').toBe('data/home.json');
    expect(!fetchImpl.calls[0].options.headers.authorization, 'read unauthenticated - it says what the site’s own URL says').toBeTruthy();
    expect(fetchImpl.calls[1].url, 'and the list from the home repo’s default branch - a pointer naming no branch sends no ref, so GitHub picks it').toBe(ROSTER_URL);
    expect(fetchImpl.calls[1].options.headers.authorization, 'with the viewer’s token, because the list is private').toBe('Bearer fake-token-for-tests');
    expect(fetchImpl.calls[1].options.headers.accept, 'asked for raw, so the answer is the file itself').toBe('application/vnd.github.raw+json');
    expect(!fetchImpl.calls.some((call) => call.url === 'data/repos.json'), 'and never from the published site').toBeTruthy();
  });

  test('the roster is read from the branch the pointer names, never an assumed main', async () => {
    // The publish names the home clone's branch in data/home.json, so a home
    // whose default branch is not `main` still answers the roster read.
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit', branch: 'trunk' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, {});
    });
    const answer = await github.fetchSlugs({ token: 'fake-token-for-tests', fetch: fetchImpl });
    expect(answer.ok, 'the list is read').toBe(true);
    expect(fetchImpl.calls[1].url, 'from the branch the publish wrote it to').toBe('https://api.github.com/repos/owner/workkit/contents/data/repos.json?ref=trunk');
  });

  test('the board feed is a live sweep with the viewer’s token', async () => {
    const fetchImpl = mkSiteFetch({ repos: ['ITW-Creative-Works/workkit'], home: '' }, { data: SWEEP.data });
    const answer = await github.readFeed('/api/board', { token: 'fake-token-for-tests', fetch: fetchImpl });
    expect(answer.ok, 'answered').toBe(true);
    expect(answer.data.issues[0].number, 'with the issues GitHub just returned').toBe(81);
    expect(fetchImpl.calls[2].options.headers.authorization, 'unlocked by the token and nothing else').toBe('Bearer fake-token-for-tests');
  });

  test('a copy with no home pointer asks the token who it is, and draws that viewer’s board', async () => {
    const central = () => mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(404, {});
      if (url === USER_URL) return jsonResponse(200, { login: 'someone' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['ITW-Creative-Works/workkit'], home: '' });
      return jsonResponse(200, { data: SWEEP.data });
    });
    const fetchImpl = central();
    // A token of its own: the login is remembered per token across every suite.
    const answer = await github.readFeed('/api/board', { token: 'door-central', fetch: fetchImpl });
    expect(answer.ok, `the central copy draws a board, got: ${answer.reason}`).toBe(true);
    expect(answer.data.issues[0].number, 'with the issues GitHub just returned').toBe(81);
    expect(fetchImpl.calls.filter((call) => call.url === USER_URL).length, 'the login is asked exactly once').toBe(1);
    expect(fetchImpl.calls[1].url, 'straight after the missing pointer').toBe(USER_URL);
    expect(fetchImpl.calls[2].url, 'and the roster comes from <login>/workkit on its default branch, with no ref').toBe('https://api.github.com/repos/someone/workkit/contents/data/repos.json');
    const slugs = await github.fetchSlugs({ token: 'door-central', fetch: central() });
    expect(slugs.source, 'the roster read says where the home came from').toBe('login');
  });

  test('a copy with no home pointer and no token reaches GitHub not at all', async () => {
    const missing = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(404, {})
      : jsonResponse(200, { login: 'someone', repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.readFeed('/api/board', { token: '', fetch: missing });
    expect(answer.ok, 'there is no login to name a home from').toBe(false);
    expect(/token/.test(answer.reason || ''), `and the reason is the token the prompt asks for, got: ${answer.reason}`).toBeTruthy();
    expect(missing.calls.length, 'nothing was asked of GitHub').toBe(1);
  });

  test('the brief feed is that sweep plus the summaries', async () => {
    const fetchImpl = mkFetch((url, options) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['ITW-Creative-Works/workkit'], home: 'owner/workkit' });
      return jsonResponse(200, JSON.parse(options.body).query.includes('discussions')
        ? { data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'u', createdAt: '2026-07-28T09:00:00Z', category: null }] } } } }
        : { data: SWEEP.data });
    });
    const answer = await github.readFeed('/api/brief', { token: 't', fetch: fetchImpl, generatedAt: '2026-07-29T11:00:00Z' });
    expect(answer.ok, 'answered').toBe(true);
    expect(answer.data.counts.inFlight, 'the sections are built from the sweep').toBe(1);
    expect(answer.data.summaries.items[0].title, 'and the summaries ride with it').toBe('Tuesday');
    // A published copy draws the Brief page from this key and nothing else.
    expect(answer.data.documents[0].title, 'and the archive rides too').toBe('Tuesday');
  });

  test('a failed sweep is a failed feed, never an empty board', async () => {
    const fetchImpl = mkFetch((url) => {
      if (url === 'data/home.json') return jsonResponse(200, { home: 'owner/workkit' });
      if (isRoster(url)) return jsonResponse(200, { repos: ['owner/workkit'], home: '' });
      return jsonResponse(401, { message: 'Bad credentials' });
    });
    const answer = await github.readFeed('/api/board', { token: 'stale', fetch: fetchImpl });
    expect(answer.ok, 'the page shows the reason, not six confident zeros').toBe(false);
    expect(/refused the token/.test(answer.reason), `and the reason is the token, got: ${answer.reason}`).toBeTruthy();
  });

  test('a refused token survives the read as a refusal, not as a generic failure', async () => {
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
      expect(answer.status, `${feedPath} carries the status GitHub refused it with`).toBe(401);
      expect(github.isTokenRefusal(answer), `and ${feedPath} reads as a token refusal`).toBeTruthy();
    }
    expect(github.isTokenRefusal(await github.readFeed('/api/board', { token: 'narrow', fetch: refuse(403) })), 'a 403 is the same answer - the token does not cover these repos').toBeTruthy();
    const down = await github.readFeed('/api/board', { token: 't', fetch: refuse(500) });
    expect(!github.isTokenRefusal(down), 'a server failure is not the token’s fault and must not ask for a new one').toBeTruthy();
    expect(!github.isTokenRefusal({ ok: true, status: 200 }), 'and neither is a read that worked').toBeTruthy();

    // The roster read is the first thing the token is asked for, so a token
    // blind to the home repo reaches the prompt too, not a site with no list.
    const blindRoster = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(403, { message: 'Resource not accessible by personal access token' })));
    const unread = await github.readFeed('/api/board', { token: 'no-contents', fetch: blindRoster });
    expect(github.isTokenRefusal(unread), `a token that cannot read the roster is a token refusal, got: ${unread.reason}`).toBeTruthy();
  });

  test('a spent rate limit is not a token refusal - no token typed on Settings fixes it (#213)', async () => {
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
      expect(limited.status, `${feedPath} still carries the status GitHub refused it with`).toBe(403);
      expect(limited.rateLimited, `${feedPath} carries the mark up from the sweep`).toBe(true);
      expect(limited.reason, `${feedPath} carries the sentence the page will draw`).toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`);
      expect(!github.isTokenRefusal(limited), `${feedPath} is left to the page, never routed to Settings`).toBeTruthy();
    }

    const refused = await github.readFeed('/api/board', {
      token: 'narrow',
      fetch: answering({ message: 'Resource not accessible by personal access token' }, { 'x-ratelimit-remaining': '4931' }),
    });
    expect(github.isTokenRefusal(refused), 'while a 403 with budget left is the token, and still goes to Settings').toBeTruthy();
    expect(refused.rateLimited, 'and carries no mark at all - it is added only when it is true').toBe(undefined);
  });

  test('a limit on the ROSTER read is a limit too - the first call the token makes (#213)', async () => {
    // The roster is read over REST before the sweep goes out, so a spent budget
    // is met there first, and it has to carry the mark rather than send the
    // viewer to Settings for a token that is not the problem.
    const reset = resetIn(18);
    const sentence = `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`;
    const limitedRoster = () => mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(403, { message: 'API rate limit exceeded for user ID 7562803.' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      })));

    const answer = await github.readFeed('/api/board', { token: 't', fetch: limitedRoster() });
    expect(answer.status, 'the status survives the roster read').toBe(403);
    expect(answer.rateLimited, 'the mark rides up from the REST call through fetchSlugs').toBe(true);
    expect(answer.reason, 'and the sentence is the one the sweep would have said').toBe(sentence);
    expect(!github.isTokenRefusal(answer), 'so it is drawn on the page, never routed to Settings').toBeTruthy();

    // The two writes read that same roster, and a write refused for a limit must
    // not tell the viewer to make a token with more permission.
    const filed = await github.createIssue({ repo: 'owner/workkit', title: 'x' }, { token: 't', fetch: limitedRoster() });
    expect(filed.reason, 'the intake says the limit, not the write refusal').toBe(sentence);
    expect(filed.rateLimited, 'and carries the mark with it').toBe(true);
  });

  test('the refusal names the fix that exists - there is no form under it', async () => {
    const answer = await github.graphql('query {}', {
      token: 'expired',
      fetch: async () => jsonResponse(401, { message: 'Bad credentials' }),
    });
    expect(!/below/.test(answer.reason), `the sentence points at no control beneath it, got: ${answer.reason}`).toBeTruthy();
    expect(/Hand over one that does/.test(answer.reason), 'it asks for a token that covers the repositories').toBeTruthy();
  });

  test('a machine-bound feed asked of the published side is answered as one', async () => {
    const fetchImpl = mkSiteFetch({ repos: [], home: '' }, {});
    const answer = await github.readFeed('/api/telemetry', { token: 't', fetch: fetchImpl });
    expect(answer.ok, 'a published copy cannot read this machine').toBe(false);
    expect(/published copy can read/.test(answer.reason), `and says so, got: ${answer.reason}`).toBeTruthy();
  });
});
