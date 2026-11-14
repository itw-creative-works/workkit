//
// Tests for the tower dashboard's github.js: the wire (the GraphQL request, its
// refusals, and the rate limit). Shared prologue: ./helpers.js.
//

const { describe, before, test, expect } = require('../../lib/harness');
const { resetIn, clockAt } = require('../../lib/gh');
const { loadLibs, mkFetch, jsonResponse } = require('./helpers');

describe('tower/app: github - the wire', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  test('with no token nothing is sent at all - the refusal comes before the request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const answer = await github.graphql('query {}', { token: '', fetch: fetchImpl });
    expect(answer.ok, 'refused').toBe(false);
    expect(fetchImpl.calls.length, 'and GitHub was never reached').toBe(0);
    expect(/no GitHub token/.test(answer.reason), `it says which of the failures it is, got: ${answer.reason}`).toBeTruthy();
  });

  test('the token rides as a bearer on a POST to the GraphQL endpoint', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, { data: { r0: null } }));
    await github.graphql('query { x }', { token: 'fake-token-for-tests', fetch: fetchImpl });
    const call = fetchImpl.calls[0];
    expect(call.url, 'the one URL this module writes').toBe('https://api.github.com/graphql');
    expect(call.options.method, 'GraphQL is a POST').toBe('POST');
    expect(call.options.headers.authorization, 'the token is the whole of the auth').toBe('Bearer fake-token-for-tests');
    expect(JSON.parse(call.options.body).query, 'and the document is the body').toBe('query { x }');
  });

  test('the four ways a request fails are told apart', async () => {
    const refused = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(401, { message: 'Bad credentials' })) });
    expect(refused.status, 'the status survives').toBe(401);
    expect(/refused the token/.test(refused.reason) && /Hand over one/.test(refused.reason), `it names the token and the fix, got: ${refused.reason}`).toBeTruthy();

    const forbidden = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(403, {})) });
    expect(/refused the token/.test(forbidden.reason), 'a 403 is the same story - the token does not cover these repos').toBeTruthy();

    const down = await github.graphql('q', { token: 't', fetch: mkFetch(() => { throw new Error('network down'); }) });
    expect(down.status, 'a transport failure has no status').toBe(null);
    expect(/did not answer/.test(down.reason), `and says so, got: ${down.reason}`).toBeTruthy();

    const empty = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(200, { errors: [{ message: 'Bad query' }] })) });
    expect(empty.ok, 'a 200 carrying only errors is not an answer').toBe(false);
    expect(empty.reason, 'and GitHub’s own sentence is the reason').toBe('Bad query');
  });

  test('a spent rate limit is not a bad token - it says when the budget lifts', async () => {
    const reset = resetIn(18);
    const limited = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'API rate limit exceeded for user ID 7562803.' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      })),
    });
    expect(limited.ok, 'the read still failed').toBe(false);
    expect(limited.status, 'the status survives').toBe(403);
    expect(limited.reason, 'and the sentence names the limit and when it lifts, not a token to replace').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`);

    const refused = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'Resource not accessible by personal access token' }, {
        'x-ratelimit-remaining': '4931',
        'x-ratelimit-reset': String(reset),
      })),
    });
    expect(/refused the token/.test(refused.reason), `a 403 with budget left is still the token, got: ${refused.reason}`).toBeTruthy();
  });

  test('the GraphQL limit comes as a 200, and retry-after is the wait it names', async () => {
    // GitHub answers a spent GraphQL budget 200: nothing in the status line says
    // a limit, and the error type is the whole tell.
    const reset = resetIn(9);
    const quiet = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      })),
    });
    expect(quiet.ok, 'a 200 with nothing in it is not an answer').toBe(false);
    expect(quiet.rateLimited, 'it is marked, so no page sends the viewer to Settings over it').toBe(true);
    expect(quiet.reason, 'and it says when it lifts, not "GitHub answered without data"').toBe(`GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`);

    // A secondary limit hands back the seconds this caller must wait, which is
    // not the hour the shared budget takes to refill.
    const secondary = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'You have exceeded a secondary rate limit' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetIn(60)),
        'retry-after': '120',
      })),
    });
    expect(/\(in 2 min\)\.$/.test(secondary.reason), `the seconds it was handed win, got: ${secondary.reason}`).toBeTruthy();
  });

  test('data AND errors together is a success - one bad repo does not blank the board', async () => {
    const answer = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { r0: {}, r1: null }, errors: [{ path: ['r1'], message: 'Could not resolve' }] })),
    });
    expect(answer.ok, 'the partial answer is kept').toBe(true);
    expect(answer.errors.length, 'with the error for the caller to hang on its repo').toBe(1);
  });
});
