//
// Tests for the tower dashboard's github.js: the roster, the brief and the summaries.
// The shared prologue (the lib loader, the fetch stub, the sweep fixture) is ./helpers.js.
//

const path = require('path');
const { describe, before, test, expect, mkTmp } = require('../../lib/harness');
const {
  loadLibs, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW, USER_URL,
} = require('./helpers');

const apiBrief = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'brief.js'));

describe('tower/app: github - the roster, the brief and the summaries', () => {
  let github;
  before(async () => { ({ github } = await loadLibs()); });

  test('the baked list is names only, and junk in it is dropped', () => {
    const parsed = github.parseSlugs({ repos: ['owner/workkit', 'nope', 42, null], home: 'owner/workkit' });
    expect(parsed.repos.map((repo) => repo.slug).join(','), 'only what is shaped like a slug').toBe('owner/workkit');
    expect(parsed.repos[0].name, 'named the way the roster names a repo').toBe('workkit');
    expect(parsed.repos[0].path, 'with no path - a published copy has no machine under it').toBe('');
    expect(parsed.home, 'and the home repo is named').toBe('owner/workkit');
    expect(github.parseSlugs(null).home, 'nothing at all parses to nothing, never undefined').toBe('');
  });

  test('a home repo carrying no roster says so rather than showing an empty board', async () => {
    // A home that has never been published from carries no roster, so this is
    // the read that can come back empty.
    const answer = await github.fetchSlugs({
      token: 't',
      fetch: mkFetch((url) => (url === 'data/home.json'
        ? jsonResponse(200, { home: 'owner/workkit' })
        : { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })),
    });
    expect(answer.ok, 'a missing list is a failure to report').toBe(false);
    expect(/404/.test(answer.reason) && /Not Found/.test(answer.reason), `and GitHub’s own sentence survives, got: ${answer.reason}`).toBeTruthy();
  });

  test('the roster is never read without a token - the list is private', async () => {
    const fetchImpl = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.fetchSlugs({ token: '', fetch: fetchImpl });
    expect(answer.ok, 'there is nothing to read it with').toBe(false);
    expect(/no GitHub token/.test(answer.reason), `the refusal is the one the prompt answers, got: ${answer.reason}`).toBeTruthy();
    expect(fetchImpl.calls.length, 'and the unauthenticated read stopped at the public pointer').toBe(1);
  });

  // The login is remembered per token for the life of the module, and every
  // suite shares that module, so each test asking the login brings its own token.

  /** A site with or without its pointer, a viewer behind `user`, and a roster on any home. */
  const centralFetch = (pointer, user) => mkFetch((url) => {
    if (url === 'data/home.json') return pointer ? jsonResponse(200, pointer) : jsonResponse(404, { message: 'Not Found' });
    if (url === USER_URL) return user;
    return jsonResponse(200, { repos: ['owner/workkit'], home: '' });
  });

  test('a login names its home: <login>/workkit on no named branch, and no login names nothing', () => {
    const home = github.homeFromLogin('ianwieds');
    expect(home.home, 'the viewer’s own workkit repo').toBe('ianwieds/workkit');
    expect(home.branch, 'with no branch named, so GitHub serves the repo’s default branch').toBe(null);
    // parseSlugs' convention for junk: nothing parses to nothing, never a throw
    // and never undefined, so no slug is invented from an empty login.
    expect(github.homeFromLogin('').home, 'an empty login names no home').toBe('');
  });

  test('a copy with no home pointer reads the roster from the viewer’s own workkit, on its default branch', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 'login-fallback', fetch: fetchImpl });
    expect(answer.ok, `the central copy draws a board, got: ${answer.reason}`).toBe(true);
    expect(answer.source, 'and says the home came from the login').toBe('login');
    const asked = fetchImpl.calls.find((call) => call.url === USER_URL);
    expect(asked, `the viewer was asked who they are, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
    expect(asked.options.headers.authorization, 'with the viewer’s token - the only thing that knows the login').toBe('Bearer login-fallback');
    expect(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/someone/workkit/contents/data/repos.json'),
      `the roster is read from <login>/workkit with no ref, so no branch is assumed, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
  });

  test('a baked home pointer wins, and the login is never asked', async () => {
    const fetchImpl = centralFetch({ home: 'other/workkit' }, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 't', fetch: fetchImpl });
    expect(answer.ok, `the published copy draws its board, got: ${answer.reason}`).toBe(true);
    expect(answer.source, 'and says the home came from the file').toBe('home.json');
    expect(!fetchImpl.calls.some((call) => call.url === USER_URL), `the login read is never made, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
    expect(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/other/workkit/contents/data/repos.json'),
      `the roster is read from the repo the file names, with no ref when it names no branch, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
  });

  test('a home pointer naming a branch reads the roster from that branch', async () => {
    const fetchImpl = centralFetch({ home: 'other/workkit', branch: 'trunk' }, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 't', fetch: fetchImpl });
    expect(answer.ok, `the published copy draws its board, got: ${answer.reason}`).toBe(true);
    expect(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/other/workkit/contents/data/repos.json?ref=trunk'),
      `the named branch rides the read as its ref, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
  });

  test('the roster feed carries where its home came from, for Settings to name', async () => {
    const answer = await github.readFeed('/api/repos', { token: 'repos-feed', fetch: centralFetch(null, jsonResponse(200, { login: 'someone' })) });
    expect(answer.ok, `answered, got: ${answer.reason}`).toBe(true);
    expect(answer.home, 'the home the roster was read from').toBe('someone/workkit');
    expect(answer.source, 'and the tier that named it').toBe('login');
  });

  test('a refused login read is a failure that names the token', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(401, { message: 'Bad credentials' }));
    const answer = await github.fetchSlugs({ token: 'refused-login', fetch: fetchImpl });
    expect(answer.ok, 'with no login there is no home to read').toBe(false);
    expect(/token/.test(answer.reason || ''), `and the reason points at the token, got: ${answer.reason}`).toBeTruthy();
  });

  test('only a missing pointer falls back to the login - a pointer that errored is a failure', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const down = mkFetch((url, options) => (url === 'data/home.json' ? jsonResponse(503, { message: 'Service Unavailable' }) : fetchImpl(url, options)));
    const answer = await github.fetchSlugs({ token: 'pointer-down', fetch: down });
    expect(answer.ok, 'a site that did not answer is not a site with no pointer').toBe(false);
    expect(/503/.test(answer.reason || ''), `the reason names the status, got: ${answer.reason}`).toBeTruthy();
    expect(!down.calls.some((call) => call.url === USER_URL), `and the login is never asked, calls: ${down.calls.map((call) => call.url).join(', ')}`).toBeTruthy();
  });

  test('the login is asked once per token, and a new token asks again', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const logins = () => fetchImpl.calls.filter((call) => call.url === USER_URL).length;
    await github.fetchSlugs({ token: 'once-a', fetch: fetchImpl });
    const again = await github.fetchSlugs({ token: 'once-a', fetch: fetchImpl });
    expect(again.source, `the second read still names its home from the login, got: ${again.reason}`).toBe('login');
    expect(logins(), 'two reads with one token ask the login once').toBe(1);
    await github.fetchSlugs({ token: 'once-b', fetch: fetchImpl });
    expect(logins(), 'and a different token is a different viewer, asked afresh').toBe(2);
  });

  test('the brief the browser builds is the brief the tower builds', () => {
    const board = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    const stamp = '2026-07-29T11:00:00Z';
    const mine = github.buildBrief(board, { generatedAt: stamp });
    const theirs = apiBrief.buildBrief(board, {}, [], stamp);
    // `summaries`, `history`, `documents`, `briefFreshness` and `historyReason`
    // are attached after the build on the tower's side (server/feeds.js) and
    // inside it here, so the comparison lifts those five out; everything
    // buildBrief itself decides is compared.
    expect(JSON.stringify({
      ...mine, summaries: undefined, history: undefined, documents: undefined, briefFreshness: undefined, historyReason: undefined,
    }), 'the same sections, the same order, the same headline').toBe(JSON.stringify(theirs));
    expect(mine.nextUp[0].items.map((i) => i.number).join(','), 'the blocked item would lead on status, so this order EXISTS only because demotion ran - on both sides').toBe('83,82');
    expect(mine.nextUp[0].items[1].waitsOn.join(','), 'the item waiting on an issue the sweep is carrying says so (#103)').toBe('ITW-Creative-Works/workkit#81');
    expect(mine.nextUp[0].items[0].waitsOn.length, 'and an edge into a repo the sweep could not read claims nothing').toBe(0);
    expect(mine.closedDay, 'the day’s closed count rides the payload, roster wide').toBe(2);
    expect(mine.repoCounts[0].open, 'and each repo’s open count is its totalCount, cap or no cap').toBe(5);
    expect(mine.warnings.length, 'the one section a browser cannot answer is empty rather than invented').toBe(0);
  });

  test('the history the browser parses is the history the tower parses', async () => {
    // The same published briefs, read by both halves: the tower through `gh`,
    // the browser through GraphQL. A drift in either parse would leave one
    // surface drawing a chart the other cannot.
    const fs = require('fs');
    const apiHistory = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'history.js'));
    const mark = (date, open, closedDay) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":${open},"waiting":1,"ready":2,"inFlight":0,"inbox":3,"backlog":0},"closedDay":${closedDay},"repos":{"owner/repo":{"open":${open}}}} -->`;
    const nodes = [
      { title: 'brief: 2026-08-03', body: `HEADLINE: today.\n\n<!-- cc-news: 2.1.220 -->\n${mark('2026-08-03', 12, 4)}\n` },
      { title: 'daily: 2026-08-03', body: `a summary, not a brief\n${mark('2026-08-03', 99, 9)}\n` },
      { title: 'brief: 2026-08-02', body: 'HEADLINE: a morning before the block existed.\n' },
      { title: 'brief: 2026-08-01', body: `HEADLINE: two days ago.\n${mark('2026-08-01', 15, 0)}\n` },
    ];

    const mine = github.normalizeHistory({ repository: { discussions: { nodes } } });
    expect(mine.map((entry) => entry.date).join(','), 'ascending, and the block-less morning is skipped').toBe('2026-08-01,2026-08-03');
    expect(mine[1].totals.open, 'the totals are read off the line').toBe(12);
    expect(mine[1].closedDay, 'and what the day closed').toBe(4);

    const home = mkTmp('app-history-');
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiHistory.briefHistory({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    });
    fs.rmSync(home, { recursive: true, force: true });
    expect(JSON.stringify(mine), 'one series, whichever side read it').toBe(JSON.stringify(theirs));

    // The browser's read asks for the body the line lives in, which the
    // summaries query does not, and for each post's URL and day, which the
    // archive riding the same read links back to.
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchDiscussions('owner/private-home', { token: 't', fetch: fetchImpl });
    expect(JSON.parse(fetchImpl.calls[0].options.body).query.includes('nodes { title url createdAt body }'), 'the history read asks for the body').toBeTruthy();
    expect(answer.history.length, 'and it comes back parsed').toBe(2);
    expect(fetchImpl.calls.length, 'the archive rides that one read - it is not a second round trip').toBe(1);
  });

  test('the archive the browser reads is the archive the tower reads', async () => {
    // The same Discussions, asked what each morning said: a drift in either
    // parse leaves one copy of the Brief page showing a document the other cannot.
    const fs = require('fs');
    const apiDocuments = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'documents.js'));
    const apiHistory = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'history.js'));
    const nodes = [
      {
        title: 'brief: 2026-08-03',
        url: 'https://github.com/owner/private-home/discussions/9',
        createdAt: '2026-08-03T09:00:00Z',
        body: 'HEADLINE: today.\n\n<!-- cc-news: 2.1.220 -->\n<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":12}} -->\n',
      },
      {
        title: 'daily: 2026-08-02', url: 'https://github.com/owner/private-home/discussions/8', createdAt: '2026-08-02T21:00:00Z', body: 'what yesterday produced',
      },
      { title: '', url: 'https://github.com/owner/private-home/discussions/7', createdAt: null, body: 'a post with no title at all' },
    ];

    const mine = github.normalizeDocuments({ repository: { discussions: { nodes } } });
    expect(mine.length, 'a post with no title is no document').toBe(2);
    expect(mine.map((doc) => doc.kind).join(','), 'the title says which kind each one is, as it does on the other side').toBe('brief,summary');
    expect(mine[0].body, 'the machine markers come off - a renderer that escapes first would draw them as text').toBe('HEADLINE: today.');
    expect(mine[0].url, 'and each one links back to the post').toBe('https://github.com/owner/private-home/discussions/9');

    const home = mkTmp('app-documents-');
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiDocuments.documentsFrom(apiHistory.readDiscussions({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    }).nodes);
    fs.rmSync(home, { recursive: true, force: true });
    expect(JSON.stringify(mine), 'one archive, whichever side read it').toBe(JSON.stringify(theirs));
  });

  test('a read that could not be made is null, never an empty series and never an empty archive', async () => {
    // Nothing published yet is a board with no history; a refused read is a
    // history nobody can see. Both halves of the one read answer it the same way.
    const nowhere = await github.fetchDiscussions('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    expect(nowhere.history, 'a site published without a home repo has nowhere to read from').toBe(null);
    expect(nowhere.documents, 'and no archive to read either').toBe(null);
    const tokenless = await github.fetchDiscussions('owner/workkit', { token: '', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    expect(tokenless.history, 'and a browser with no token cannot ask').toBe(null);
    expect(tokenless.documents, 'for either of them').toBe(null);
    const empty = await github.fetchDiscussions('owner/workkit', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes: [] } } } })),
    });
    expect(empty.history.length, 'a home repo with no published briefs yet is an empty series, not a failure').toBe(0);
    expect(empty.documents.length, 'and an empty archive, which is a different sentence from an unreadable one').toBe(0);

    // Where the refusal has a sentence, it rides beside those nulls so the
    // pages can draw it.
    const refused = await github.fetchDiscussions('owner/workkit', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'Bad credentials' })),
    });
    expect(refused.history, 'a refused token reads no mornings').toBe(null);
    expect(/refused the token/.test(refused.reason), `and says which of the two problems it is: ${refused.reason}`).toBeTruthy();
    expect(nowhere.reason, 'while a copy with no home repo has nothing it failed to read').toBe(null);
    expect(empty.reason, 'and a board that answered has nothing to explain').toBe(null);
  });

  test('a site with no home repo has nowhere to read summaries from, and says so', async () => {
    const answer = await github.fetchSummaries('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    expect(answer.ok, 'not a failure of the read - a fact about the publish').toBe(false);
    expect(/without a home repo/.test(answer.reason), `named as such, got: ${answer.reason}`).toBeTruthy();
    expect(answer.items.length, 'and no items').toBe(0);
  });

  test('the summaries are the home repo’s latest Discussions', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, {
      data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'https://github.com/owner/workkit/discussions/4', createdAt: '2026-07-28T09:00:00Z', category: { name: 'Summaries' } }, null] } } },
    }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    expect(JSON.parse(fetchImpl.calls[0].options.body).query.includes('repository(owner: "owner", name: "workkit")'), 'it asks the home repo').toBeTruthy();
    expect(answer.items.length, 'a null node is not a summary').toBe(1);
    expect(answer.items[0].category, 'the category rides along').toBe('Summaries');
  });

  test('the morning briefs sharing the board are not summaries', async () => {
    // The 9am job publishes its digest as a `brief: <date>` Discussion on the
    // same repo, about one a day. Left in, they fill the card the summaries own.
    const node = (title, i) => ({ title, url: `https://github.com/owner/workkit/discussions/${i}`, createdAt: '2026-07-28T09:00:00Z', category: { name: 'General' } });
    const nodes = [];
    for (let i = 0; i < 7; i++) nodes.push(node(`brief: 2026-07-${20 + i}`, i * 2), node(`daily: 2026-07-${20 + i}`, i * 2 + 1));
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    expect(answer.items.length, 'the card still fills, five summaries deep').toBe(5);
    expect(answer.items.every((item) => /^daily: /.test(item.title)), `and every one of them is a summary: ${answer.items.map((i) => i.title).join(', ')}`).toBeTruthy();
    const asked = Number((JSON.parse(fetchImpl.calls[0].options.body).query.match(/discussions\(first: (\d+)/) || [])[1]);
    expect(asked > 5, `the read window is wide enough to filter from, got ${asked}`).toBeTruthy();
  });
});
