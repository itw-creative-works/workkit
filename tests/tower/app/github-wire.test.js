//
// Tests for the tower dashboard's github.js: the wire (the GraphQL request,
// its refusals, and the rate limit).
// The shared prologue (the lib loader, the fetch stub, the fixtures) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { resetIn, clockAt } = require('../../lib/gh');
const { loadLibs, mkFetch, jsonResponse } = require('./helpers');

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the wire');

  await test('with no token nothing is sent at all - the refusal comes before the request', async () => {
    const fetchImpl = mkFetch(() => { throw new Error('a request was made'); });
    const answer = await github.graphql('query {}', { token: '', fetch: fetchImpl });
    assertEq(answer.ok, false, 'refused');
    assertEq(fetchImpl.calls.length, 0, 'and GitHub was never reached');
    assert(/no GitHub token/.test(answer.reason), `it says which of the failures it is, got: ${answer.reason}`);
  });

  await test('the token rides as a bearer on a POST to the GraphQL endpoint', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, { data: { r0: null } }));
    await github.graphql('query { x }', { token: 'fake-token-for-tests', fetch: fetchImpl });
    const call = fetchImpl.calls[0];
    assertEq(call.url, 'https://api.github.com/graphql', 'the one URL this module writes');
    assertEq(call.options.method, 'POST', 'GraphQL is a POST');
    assertEq(call.options.headers.authorization, 'Bearer fake-token-for-tests', 'the token is the whole of the auth');
    assertEq(JSON.parse(call.options.body).query, 'query { x }', 'and the document is the body');
  });

  await test('the four ways a request fails are told apart', async () => {
    const refused = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(401, { message: 'Bad credentials' })) });
    assertEq(refused.status, 401, 'the status survives');
    assert(/refused the token/.test(refused.reason) && /Hand over one/.test(refused.reason), `it names the token and the fix, got: ${refused.reason}`);

    const forbidden = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(403, {})) });
    assert(/refused the token/.test(forbidden.reason), 'a 403 is the same story - the token does not cover these repos');

    const down = await github.graphql('q', { token: 't', fetch: mkFetch(() => { throw new Error('network down'); }) });
    assertEq(down.status, null, 'a transport failure has no status');
    assert(/did not answer/.test(down.reason), `and says so, got: ${down.reason}`);

    const empty = await github.graphql('q', { token: 't', fetch: mkFetch(jsonResponse(200, { errors: [{ message: 'Bad query' }] })) });
    assertEq(empty.ok, false, 'a 200 carrying only errors is not an answer');
    assertEq(empty.reason, 'Bad query', 'and GitHub’s own sentence is the reason');
  });

  await test('a spent rate limit is not a bad token - it says when the budget lifts', async () => {
    const reset = resetIn(18);
    const limited = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'API rate limit exceeded for user ID 7562803.' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(reset),
      })),
    });
    assertEq(limited.ok, false, 'the read still failed');
    assertEq(limited.status, 403, 'the status survives');
    assertEq(limited.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 18 min).`,
      'and the sentence names the limit and when it lifts, not a token to replace');

    const refused = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'Resource not accessible by personal access token' }, {
        'x-ratelimit-remaining': '4931',
        'x-ratelimit-reset': String(reset),
      })),
    });
    assert(/refused the token/.test(refused.reason), `a 403 with budget left is still the token, got: ${refused.reason}`);
  });

  await test('the GraphQL limit comes as a 200, and retry-after is the wait it names', async () => {
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
    assertEq(quiet.ok, false, 'a 200 with nothing in it is not an answer');
    assertEq(quiet.rateLimited, true, 'it is marked, so no page sends the viewer to Settings over it');
    assertEq(quiet.reason, `GitHub rate limit hit for this token; resets at ${clockAt(reset)} (in 9 min).`,
      'and it says when it lifts, not "GitHub answered without data"');

    // A SECONDARY limit hands back the seconds this caller must wait, which is
    // not the hour the shared budget takes to refill.
    const secondary = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'You have exceeded a secondary rate limit' }, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetIn(60)),
        'retry-after': '120',
      })),
    });
    assert(/\(in 2 min\)\.$/.test(secondary.reason), `the seconds it was handed win, got: ${secondary.reason}`);
  });

  await test('data AND errors together is a success - one bad repo does not blank the board', async () => {
    const answer = await github.graphql('q', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { r0: {}, r1: null }, errors: [{ path: ['r1'], message: 'Could not resolve' }] })),
    });
    assertEq(answer.ok, true, 'the partial answer is kept');
    assertEq(answer.errors.length, 1, 'with the error for the caller to hang on its repo');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
