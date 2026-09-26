//
// Tests for the tower dashboard's github.js: the roster, the brief and the summaries.
// The shared prologue (the lib loader, the fetch stub, the sweep fixture) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { loadLibs, libs, mkFetch, jsonResponse, SWEEP, SLUGS, CLOSED_NOW } = require('./helpers');

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
    // The list is on the home repo now (issue #110), so this is the read that
    // can come back empty: a home that has never been published from.
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

  await test('the brief the browser builds is the brief the tower builds', () => {
    const board = github.normalizeBoard(SLUGS, SWEEP.data, SWEEP.errors, CLOSED_NOW);
    const stamp = '2026-07-29T11:00:00Z';
    const mine = github.buildBrief(board, { generatedAt: stamp });
    const theirs = apiBrief.buildBrief(board, {}, [], stamp);
    // `summaries`, `history`, `documents`, the freshness read off that
    // history (#176) and the history read's reason (#215) are ATTACHED after
    // the build on the tower's side (server/feeds.js) and inside it here, so they are
    // the five keys the comparison lifts out - everything buildBrief itself
    // decides is compared.
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
    const os = require('os');
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

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-history-'));
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiHistory.briefHistory({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    });
    fs.rmSync(home, { recursive: true, force: true });
    assertEq(JSON.stringify(mine), JSON.stringify(theirs), 'one series, whichever side read it');

    // And the read the browser makes asks for the body the line lives in - the
    // summaries query does not, which is why this is a second document. It asks
    // for the post's URL and its day beside it (#181), because the archive that
    // rides the same read names each document and links it back.
    const fetchImpl = mkFetch(jsonResponse(200, { data: { repository: { discussions: { nodes } } } }));
    const answer = await github.fetchDiscussions('owner/private-home', { token: 't', fetch: fetchImpl });
    assert(JSON.parse(fetchImpl.calls[0].options.body).query.includes('nodes { title url createdAt body }'), 'the history read asks for the body');
    assertEq(answer.history.length, 2, 'and it comes back parsed');
    assertEq(fetchImpl.calls.length, 1, 'the archive rides that one read - it is not a second round trip');
  });

  await test('the archive the browser reads is the archive the tower reads', async () => {
    // Issue #181: the same Discussions again, asked the other question - not
    // what each morning counted but what it SAID. A drift in either parse would
    // leave one copy of the Brief page showing a document the other cannot.
    const fs = require('fs');
    const os = require('os');
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

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'app-documents-'));
    fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ version: 1, site: { repo: 'owner/private-home' } }));
    const theirs = apiDocuments.documentsFrom(apiHistory.readDiscussions({
      workflowHome: home,
      exec: () => JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
    }).nodes);
    fs.rmSync(home, { recursive: true, force: true });
    assertEq(JSON.stringify(mine), JSON.stringify(theirs), 'one archive, whichever side read it');
  });

  await test('a read that could not be made is null, never an empty series and never an empty archive', async () => {
    // The two say opposite things: nothing published yet is a board with no
    // history, and a refused read is a history nobody can see. Both halves of
    // the one read answer it the same way (#181) - an archive drawn empty where
    // the read failed would be the same lie the series refuses to tell.
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

    // And where the refusal has a SENTENCE, it rides beside those nulls (#215):
    // the pages draw it, and dropping it left them saying only that the
    // mornings were unreadable.
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
