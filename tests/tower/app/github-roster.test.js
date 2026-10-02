//
// Tests for the tower dashboard's github.js: the roster, the brief and the summaries.
// The shared prologue (the lib loader, the fetch stub, the sweep fixture) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  loadLibs, libs, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW, USER_URL,
} = require('./helpers');
const { mkTmp } = require('../../lib/scratch');

const apiBrief = require(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'brief.js'));

const run = async () => {
  const { github } = await loadLibs();

  group('tower/app: github - the roster, the brief and the summaries');

  await test('the baked list is names only, and junk in it is dropped', () => {
    const parsed = github.parseSlugs({ repos: ['owner/workkit', 'nope', 42, null], home: 'owner/workkit' });
    assertEq(parsed.repos.map((repo) => repo.slug).join(','), 'owner/workkit', 'only what is shaped like a slug');
    assertEq(parsed.repos[0].name, 'workkit', 'named the way the roster names a repo');
    assertEq(parsed.repos[0].path, '', 'with no path - a published copy has no machine under it');
    assertEq(parsed.home, 'owner/workkit', 'and the home repo is named');
    assertEq(github.parseSlugs(null).home, '', 'nothing at all parses to nothing, never undefined');
  });

  await test('a home repo carrying no roster says so rather than showing an empty board', async () => {
    // A home that has never been published from carries no roster, so this is
    // the read that can come back empty.
    const answer = await github.fetchSlugs({
      token: 't',
      fetch: mkFetch((url) => (url === 'data/home.json'
        ? jsonResponse(200, { home: 'owner/workkit' })
        : { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })),
    });
    assertEq(answer.ok, false, 'a missing list is a failure to report');
    assert(/404/.test(answer.reason) && /Not Found/.test(answer.reason), `and GitHub’s own sentence survives, got: ${answer.reason}`);
  });

  await test('the roster is never read without a token - the list is private', async () => {
    const fetchImpl = mkFetch((url) => (url === 'data/home.json'
      ? jsonResponse(200, { home: 'owner/workkit' })
      : jsonResponse(200, { repos: ['owner/workkit'], home: 'owner/workkit' })));
    const answer = await github.fetchSlugs({ token: '', fetch: fetchImpl });
    assertEq(answer.ok, false, 'there is nothing to read it with');
    assert(/no GitHub token/.test(answer.reason), `the refusal is the one the prompt answers, got: ${answer.reason}`);
    assertEq(fetchImpl.calls.length, 1, 'and the unauthenticated read stopped at the public pointer');
  });

  // The login is remembered per token for the life of the module, and every
  // suite shares that module, so each test asking the login brings its own token.

  /** A site with or without its pointer, a viewer behind `user`, and a roster on any home. */
  const centralFetch = (pointer, user) => mkFetch((url) => {
    if (url === 'data/home.json') return pointer ? jsonResponse(200, pointer) : jsonResponse(404, { message: 'Not Found' });
    if (url === USER_URL) return user;
    return jsonResponse(200, { repos: ['owner/workkit'], home: '' });
  });

  await test('a login names its home: <login>/workkit on no named branch, and no login names nothing', () => {
    const home = github.homeFromLogin('ianwieds');
    assertEq(home.home, 'ianwieds/workkit', 'the viewer’s own workkit repo');
    assertEq(home.branch, null, 'with no branch named, so GitHub serves the repo’s default branch');
    // parseSlugs' convention for junk: nothing parses to nothing, never a throw
    // and never undefined, so no slug is invented from an empty login.
    assertEq(github.homeFromLogin('').home, '', 'an empty login names no home');
  });

  await test('a copy with no home pointer reads the roster from the viewer’s own workkit, on its default branch', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 'login-fallback', fetch: fetchImpl });
    assertEq(answer.ok, true, `the central copy draws a board, got: ${answer.reason}`);
    assertEq(answer.source, 'login', 'and says the home came from the login');
    const asked = fetchImpl.calls.find((call) => call.url === USER_URL);
    assert(asked, `the viewer was asked who they are, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`);
    assertEq(asked.options.headers.authorization, 'Bearer login-fallback', 'with the viewer’s token - the only thing that knows the login');
    assert(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/someone/workkit/contents/data/repos.json'),
      `the roster is read from <login>/workkit with no ref, so no branch is assumed, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`);
  });

  await test('a baked home pointer wins, and the login is never asked', async () => {
    const fetchImpl = centralFetch({ home: 'other/workkit' }, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 't', fetch: fetchImpl });
    assertEq(answer.ok, true, `the published copy draws its board, got: ${answer.reason}`);
    assertEq(answer.source, 'home.json', 'and says the home came from the file');
    assert(!fetchImpl.calls.some((call) => call.url === USER_URL), `the login read is never made, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`);
    assert(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/other/workkit/contents/data/repos.json'),
      `the roster is read from the repo the file names, with no ref when it names no branch, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`);
  });

  await test('a home pointer naming a branch reads the roster from that branch', async () => {
    const fetchImpl = centralFetch({ home: 'other/workkit', branch: 'trunk' }, jsonResponse(200, { login: 'someone' }));
    const answer = await github.fetchSlugs({ token: 't', fetch: fetchImpl });
    assertEq(answer.ok, true, `the published copy draws its board, got: ${answer.reason}`);
    assert(fetchImpl.calls.some((call) => call.url === 'https://api.github.com/repos/other/workkit/contents/data/repos.json?ref=trunk'),
      `the named branch rides the read as its ref, calls: ${fetchImpl.calls.map((call) => call.url).join(', ')}`);
  });

  await test('the roster feed carries where its home came from, for Settings to name', async () => {
    const answer = await github.readFeed('/api/repos', { token: 'repos-feed', fetch: centralFetch(null, jsonResponse(200, { login: 'someone' })) });
    assertEq(answer.ok, true, `answered, got: ${answer.reason}`);
    assertEq(answer.home, 'someone/workkit', 'the home the roster was read from');
    assertEq(answer.source, 'login', 'and the tier that named it');
  });

  await test('a refused login read is a failure that names the token', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(401, { message: 'Bad credentials' }));
    const answer = await github.fetchSlugs({ token: 'refused-login', fetch: fetchImpl });
    assertEq(answer.ok, false, 'with no login there is no home to read');
    assert(/token/.test(answer.reason || ''), `and the reason points at the token, got: ${answer.reason}`);
  });

  await test('only a missing pointer falls back to the login - a pointer that errored is a failure', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const down = mkFetch((url, options) => (url === 'data/home.json' ? jsonResponse(503, { message: 'Service Unavailable' }) : fetchImpl(url, options)));
    const answer = await github.fetchSlugs({ token: 'pointer-down', fetch: down });
    assertEq(answer.ok, false, 'a site that did not answer is not a site with no pointer');
    assert(/503/.test(answer.reason || ''), `the reason names the status, got: ${answer.reason}`);
    assert(!down.calls.some((call) => call.url === USER_URL), `and the login is never asked, calls: ${down.calls.map((call) => call.url).join(', ')}`);
  });

  await test('the login is asked once per token, and a new token asks again', async () => {
    const fetchImpl = centralFetch(null, jsonResponse(200, { login: 'someone' }));
    const logins = () => fetchImpl.calls.filter((call) => call.url === USER_URL).length;
    await github.fetchSlugs({ token: 'once-a', fetch: fetchImpl });
    const again = await github.fetchSlugs({ token: 'once-a', fetch: fetchImpl });
    assertEq(again.source, 'login', `the second read still names its home from the login, got: ${again.reason}`);
    assertEq(logins(), 1, 'two reads with one token ask the login once');
    await github.fetchSlugs({ token: 'once-b', fetch: fetchImpl });
    assertEq(logins(), 2, 'and a different token is a different viewer, asked afresh');
  });

  await test('the home repo name is the one setup creates', () => {
    const homeSh = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflow', 'home.sh'), 'utf8');
    const pinned = (homeSh.match(/WK_HOME_REPO_NAME='(.+)'/) || [])[1];
    assert(pinned, 'workflow/home.sh names the home repo');
    assertEq(github.HOME_NAME, pinned, 'and the central copy reads <login>/ that same name');
  });

  await test('the brief the browser builds is the brief the tower builds', () => {
    const board = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    const stamp = '2026-07-29T11:00:00Z';
    const mine = github.buildBrief(board, { generatedAt: stamp });
    const theirs = apiBrief.buildBrief(board, {}, [], stamp);
    // `summaries`, `history`, `documents`, `briefFreshness` and `historyReason`
    // are attached after the build on the tower's side (server/feeds.js) and
    // inside it here, so the comparison lifts those five out; everything
    // buildBrief itself decides is compared.
    assertEq(JSON.stringify({
      ...mine, summaries: undefined, history: undefined, documents: undefined, briefFreshness: undefined, historyReason: undefined,
    }), JSON.stringify(theirs), 'the same sections, the same order, the same headline');
    assertEq(mine.nextUp[0].items.map((i) => i.number).join(','), '83,82',
      'the blocked item would lead on status, so this order EXISTS only because demotion ran - on both sides');
    assertEq(mine.nextUp[0].items[1].waitsOn.join(','), 'ITW-Creative-Works/workkit#81',
      'the item waiting on an issue the sweep is carrying says so (#103)');
    assertEq(mine.nextUp[0].items[0].waitsOn.length, 0,
      'and an edge into a repo the sweep could not read claims nothing');
    assertEq(mine.closedDay, 2, 'the day’s closed count rides the payload, roster wide');
    assertEq(mine.repoCounts[0].open, 5, 'and each repo’s open count is its totalCount, cap or no cap');
    assertEq(mine.warnings.length, 0, 'the one section a browser cannot answer is empty rather than invented');
  });

  await test('the history the browser parses is the history the tower parses', async () => {
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
    assertEq(mine.map((entry) => entry.date).join(','), '2026-08-01,2026-08-03', 'ascending, and the block-less morning is skipped');
    assertEq(mine[1].totals.open, 12, 'the totals are read off the line');
    assertEq(mine[1].closedDay, 4, 'and what the day closed');

    const home = mkTmp('app-history-');
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiHistory.briefHistory({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    });
    fs.rmSync(home, { recursive: true, force: true });
    assertEq(JSON.stringify(mine), JSON.stringify(theirs), 'one series, whichever side read it');

    // The browser's read asks for the body the line lives in, which the
    // summaries query does not, and for each post's URL and day, which the
    // archive riding the same read links back to.
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchDiscussions('owner/private-home', { token: 't', fetch: fetchImpl });
    assert(JSON.parse(fetchImpl.calls[0].options.body).query.includes('nodes { title url createdAt body }'), 'the history read asks for the body');
    assertEq(answer.history.length, 2, 'and it comes back parsed');
    assertEq(fetchImpl.calls.length, 1, 'the archive rides that one read - it is not a second round trip');
  });

  await test('the archive the browser reads is the archive the tower reads', async () => {
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
    assertEq(mine.length, 2, 'a post with no title is no document');
    assertEq(mine.map((doc) => doc.kind).join(','), 'brief,summary', 'the title says which kind each one is, as it does on the other side');
    assertEq(mine[0].body, 'HEADLINE: today.', 'the machine markers come off - a renderer that escapes first would draw them as text');
    assertEq(mine[0].url, 'https://github.com/owner/private-home/discussions/9', 'and each one links back to the post');

    const home = mkTmp('app-documents-');
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiDocuments.documentsFrom(apiHistory.readDiscussions({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    }).nodes);
    fs.rmSync(home, { recursive: true, force: true });
    assertEq(JSON.stringify(mine), JSON.stringify(theirs), 'one archive, whichever side read it');
  });

  await test('a read that could not be made is null, never an empty series and never an empty archive', async () => {
    // Nothing published yet is a board with no history; a refused read is a
    // history nobody can see. Both halves of the one read answer it the same way.
    const nowhere = await github.fetchDiscussions('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    assertEq(nowhere.history, null, 'a site published without a home repo has nowhere to read from');
    assertEq(nowhere.documents, null, 'and no archive to read either');
    const tokenless = await github.fetchDiscussions('owner/workkit', { token: '', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    assertEq(tokenless.history, null, 'and a browser with no token cannot ask');
    assertEq(tokenless.documents, null, 'for either of them');
    const empty = await github.fetchDiscussions('owner/workkit', {
      token: 't',
      fetch: mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes: [] } } } })),
    });
    assertEq(empty.history.length, 0, 'a home repo with no published briefs yet is an empty series, not a failure');
    assertEq(empty.documents.length, 0, 'and an empty archive, which is a different sentence from an unreadable one');

    // Where the refusal has a sentence, it rides beside those nulls so the
    // pages can draw it.
    const refused = await github.fetchDiscussions('owner/workkit', {
      token: 't',
      fetch: mkFetch(jsonResponse(403, { message: 'Bad credentials' })),
    });
    assertEq(refused.history, null, 'a refused token reads no mornings');
    assert(/refused the token/.test(refused.reason), `and says which of the two problems it is: ${refused.reason}`);
    assertEq(nowhere.reason, null, 'while a copy with no home repo has nothing it failed to read');
    assertEq(empty.reason, null, 'and a board that answered has nothing to explain');
  });

  await test('the browser sorts the queues by the brief’s rule, to the letter', () => {
    const sectionsOf = (source) => (source.match(/const (?:ready|inFlight) = issues\.filter\(\(i\) => i\.status === '\w+'\)/g) || []).join(' | ');
    const briefSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tower', 'api', 'lib', 'brief.js'), 'utf8');
    const mine = fs.readFileSync(path.join(libs, 'github', 'brief.js'), 'utf8');
    assertEq(sectionsOf(briefSrc).split(' | ').length, 2, 'the brief sorts both queues by the status label');
    assertEq(sectionsOf(mine), sectionsOf(briefSrc), 'and the published brief reads the same two expressions');
    assert(!/claimed\(/.test(mine), `no claim predicate is called in the browser's copy either, got: ${(mine.match(/.*claimed\(.*/g) || []).join(' | ')}`);
  });

  await test('a site with no home repo has nowhere to read summaries from, and says so', async () => {
    const answer = await github.fetchSummaries('', { token: 't', fetch: mkFetch(() => { throw new Error('a request was made'); }) });
    assertEq(answer.ok, false, 'not a failure of the read - a fact about the publish');
    assert(/without a home repo/.test(answer.reason), `named as such, got: ${answer.reason}`);
    assertEq(answer.items.length, 0, 'and no items');
  });

  await test('the summaries are the home repo’s latest Discussions', async () => {
    const fetchImpl = mkFetch(jsonResponse(200, {
      data: { repository: { discussions: { nodes: [{ title: 'Tuesday', url: 'https://github.com/owner/workkit/discussions/4', createdAt: '2026-07-28T09:00:00Z', category: { name: 'Summaries' } }, null] } } },
    }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    assert(JSON.parse(fetchImpl.calls[0].options.body).query.includes('repository(owner: "owner", name: "workkit")'), 'it asks the home repo');
    assertEq(answer.items.length, 1, 'a null node is not a summary');
    assertEq(answer.items[0].category, 'Summaries', 'the category rides along');
  });

  await test('the morning briefs sharing the board are not summaries', async () => {
    // The 9am job publishes its digest as a `brief: <date>` Discussion on the
    // same repo, about one a day. Left in, they fill the card the summaries own.
    const node = (title, i) => ({ title, url: `https://github.com/owner/workkit/discussions/${i}`, createdAt: '2026-07-28T09:00:00Z', category: { name: 'General' } });
    const nodes = [];
    for (let i = 0; i < 7; i++) nodes.push(node(`brief: 2026-07-${20 + i}`, i * 2), node(`daily: 2026-07-${20 + i}`, i * 2 + 1));
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchSummaries('owner/workkit', { token: 't', fetch: fetchImpl });
    assertEq(answer.items.length, 5, 'the card still fills, five summaries deep');
    assert(answer.items.every((item) => /^daily: /.test(item.title)), `and every one of them is a summary: ${answer.items.map((i) => i.title).join(', ')}`);
    const asked = Number((JSON.parse(fetchImpl.calls[0].options.body).query.match(/discussions\(first: (\d+)/) || [])[1]);
    assert(asked > 5, `the read window is wide enough to filter from, got ${asked}`);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
