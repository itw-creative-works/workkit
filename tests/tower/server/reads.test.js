//
// Tests for tower/api/server.js: the read endpoints.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const {
  cleanup, SLUG, mkWorld, BOARD_PAGES, pageTheBoard, limitDiscussions, start, getJson, ghCalls, tiles, scriptHead,
} = require('./helpers');

const run = async () => {
  group('tower/api/server: the read endpoints');

  await test('/api/repos serves the discovered roster', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/repos');
    assertEq(status, 200, 'ok');
    assertEq(body.length, 1, 'one repo in the fixture root');
    assertEq(body[0].slug, SLUG, 'with its origin slug');
    assertEq(body[0].path, gitPath(w.repo), 'and its path');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief assembles the morning from the same board and health', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/brief');
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the sweep behind it succeeded');
    // The fixture board is one specced issue and one blocked one.
    assertEq(body.counts.waiting, 1, 'the blocked issue is waiting on a human');
    assertEq(body.waiting[0].number, 18, 'and it is named');
    assertEq(body.counts.ready, 1, 'the specced issue is unclaimed, so it is ready');
    assert(/waiting on a decision/.test(body.headline), 'the headline leads with the decision');
    // The fixture repo has an unreleased CHANGELOG entry and no tag.
    assertEq(body.warnings.length, 1, 'the repo has work sitting on the table');
    assertEq(body.warnings[0].repo, SLUG, 'named by its slug');
    // The same board asked one question further - what this morning could move.
    assertEq(body.nextUp.length, 1, 'the one repo has actionable work');
    assertEq(body.nextUp[0].items.map((i) => i.number).join(','), '18,17',
      'the decision leads, then the accepted spec');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief never composes from half a board - it waits for the last page', async () => {
    // The board is drawn as it arrives; a MORNING is not. Composing the brief
    // from the pages that happen to have landed would count a repo's issues
    // wrong - an early answer that is simply a wrong one - so this endpoint
    // reads the last finished board, and drives the sweep to its end when none
    // has finished yet.
    // The pause is what makes the state deterministic: the brief's request is
    // sent while a round is running and is served the moment that round ends,
    // with a page still to fetch - the exact moment a brief must not compose in.
    const w = pageTheBoard(mkWorld(), { pause: 60 });
    const c = await start(w);

    const partial = await getJson(c, '/api/board');
    assertEq(partial.body.repos[0].loading, true, 'a sweep is in flight, and /api/board says so');
    assertEq(partial.body.issues.length, 1, 'with one page of three issues on it');

    const { body } = await getJson(c, '/api/brief');
    assertEq(body.ok, true, 'the morning is composed');
    assertEq(body.counts.open, 3, 'from every page, not the one that had landed');
    assertEq(body.counts.qa, 1, 'the issue that arrived on page two is counted');
    assertEq(body.counts.inbox, 1, 'and so is the one beside it');
    assertEq(body.repoCounts[0].open, 3, 'and the repo it publishes a series from is whole');
    assertEq(ghCalls(w, 'api').length, BOARD_PAGES.length, 'it asked for the pages itself rather than answering without them');

    // What it drove to the end is the board itself, not a copy of one.
    const after = await getJson(c, '/api/board');
    assertEq(after.body.issues.length, 3, 'the sweep the brief settled is what everyone else now reads');
    assertEq(after.body.repos[0].loading, undefined, 'finished, and saying so by saying nothing');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief carries the published summaries, read once per board minute', async () => {
    const w = mkWorld();
    // The machine's hand-edited settings, naming the home repo the summaries are
    // published on - without one there is no board of them to read.
    fs.writeFileSync(
      path.join(w.root, 'workflow-home', 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
    );
    w.discussions = [
      { title: 'brief: 2026-08-03', url: 'https://github.com/owner/private-home/discussions/3', createdAt: '2026-08-03T09:00:00Z' },
      { title: 'daily: 2026-08-02', url: 'https://github.com/owner/private-home/discussions/2', createdAt: '2026-08-02T09:00:00Z' },
    ];
    const c = await start(w);
    const { body } = await getJson(c, '/api/brief');
    assertEq(body.findings.title, 'daily: 2026-08-02', 'what yesterday produced');
    assertEq(body.findings.url, 'https://github.com/owner/private-home/discussions/2', 'linked to the post itself');
    // The week rides on Mondays only, which is a fact about the day this suite
    // runs on - the rule itself is summaries.test.js's.
    assertEq('week' in body, new Date().getDay() === 1, 'and the rollup only on a Monday');

    const asked = () => w.calls.filter((call) => call.join(' ').includes('discussions(first')).length;
    const first = asked();
    assert(first >= 1, 'the summaries were read');
    await getJson(c, '/api/brief');
    assertEq(asked(), first, 'a second poll inside the minute was served from memory');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief carries the board over time, read off the published briefs', async () => {
    // Issue #55: the history is the only thing on this payload that a live
    // sweep cannot answer - it is the mornings BEFORE this one, and each one
    // recorded itself in the brief it published.
    const w = mkWorld();
    fs.writeFileSync(
      path.join(w.root, 'workflow-home', 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
    );
    const mark = (date, open) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":${open},"waiting":1,"ready":0,"inFlight":0,"inbox":2,"backlog":0},"closedDay":3,"repos":{"owner/repo":{"open":${open}}}} -->`;
    w.discussions = [
      { title: 'brief: 2026-08-03', body: `HEADLINE: today.\n${mark('2026-08-03', 12)}\n` },
      { title: 'brief: 2026-08-02', body: 'HEADLINE: a morning before the block existed.\n' },
      { title: 'brief: 2026-08-01', body: `HEADLINE: two days ago.\n${mark('2026-08-01', 15)}\n` },
    ];
    const c = await start(w);
    const { body } = await getJson(c, '/api/brief');
    assertEq(body.history.length, 2, 'the two mornings that recorded themselves');
    assertEq(body.history.map((entry) => entry.date).join(','), '2026-08-01,2026-08-03', 'oldest first, the order a chart draws in');
    assertEq(body.history[1].totals.open, 12, 'and the numbers each one carried');
    assertEq(body.closedDay, 0, 'while today’s closed count comes from the sweep, not from the history');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief carries the mornings themselves, off that same read', async () => {
    // Issue #181: the Brief page is the briefs now, and a body is the one thing
    // on this payload nothing else could supply - the numbers above are what
    // the same posts COUNTED, and the texts are what they said. Both readings
    // come off the one Discussions read, so the archive costs no round trip.
    const w = mkWorld();
    fs.writeFileSync(
      path.join(w.root, 'workflow-home', 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
    );
    w.discussions = [
      {
        title: 'brief: 2026-08-03',
        url: 'https://github.com/owner/private-home/discussions/3',
        createdAt: '2026-08-03T09:00:00Z',
        body: 'HEADLINE: today.\n<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":12}} -->\n',
      },
      {
        title: 'daily: 2026-08-02', url: 'https://github.com/owner/private-home/discussions/2', createdAt: '2026-08-02T21:00:00Z', body: 'what yesterday produced',
      },
    ];
    const c = await start(w);
    const { body } = await getJson(c, '/api/brief');
    assertEq(body.documents.length, 2, 'the morning and the summary beside it');
    assertEq(body.documents[0].kind, 'brief', 'newest first, and each one says what it is');
    assertEq(body.documents[0].body, 'HEADLINE: today.', 'carrying the text, with the machine markers off it');
    assertEq(body.documents[0].url, 'https://github.com/owner/private-home/discussions/3', 'and the post it can be opened on');
    assertEq(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 2,
      'the summaries read and the one the series and the archive share - the archive adds no round trip');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief says how old the newest published brief is, off that same read', async () => {
    // Issue #172: the cloud brief failed for ten mornings and nothing on the
    // dashboard said so. The date was already in the history read, so the
    // freshness rides beside it and costs no second round trip.
    const w = mkWorld();
    fs.writeFileSync(
      path.join(w.root, 'workflow-home', 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
    );
    const mark = (date) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":9,"waiting":0,"ready":0,"inFlight":0,"inbox":0,"backlog":0},"closedDay":0,"repos":{}} -->`;
    w.discussions = [
      { title: 'brief: 2026-08-03', body: `HEADLINE: the last morning that ran.\n${mark('2026-08-03')}\n` },
    ];
    const c = await start(w);
    const { body } = await getJson(c, '/api/brief');
    assertEq(body.briefFreshness.state, 'stale', 'the newest morning is long past');
    assertEq(body.briefFreshness.date, '2026-08-03', 'and the payload names the day it was');
    assertEq(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 2,
      'the summaries read and the history read, as before - the freshness adds no round trip of its own');

    w.discussions = [];
    const empty = await start(w);
    assertEq((await getJson(empty, '/api/brief')).body.briefFreshness.state, 'never',
      'a home repo that has published no brief carrying a block has never published one');
    await empty.stop();
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/brief says WHY the mornings are missing, never only that they are (#215)', async () => {
    // Both Discussions reads refuse the same way, so the payload carries the
    // limit's own sentence twice over rather than two nulls with nothing to
    // explain them - which is what the Brief and the Overview draw.
    const w = mkWorld();
    fs.writeFileSync(
      path.join(w.root, 'workflow-home', 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
    );
    limitDiscussions(w);
    const c = await start(w);
    const { body } = await getJson(c, '/api/brief');
    assertEq(body.ok, true, 'the sweep itself answered, so the brief is a brief');
    assertEq(body.history, null, 'the series could not be read');
    assertEq(body.documents, null, 'and neither could the mornings themselves');
    assert(/^GitHub rate limit hit for this token; resets at /.test(body.historyReason),
      `the payload names the limit: ${body.historyReason}`);
    assert(/^GitHub rate limit hit for this token; resets at /.test(body.summariesReason),
      `and so does the summaries read beside it: ${body.summariesReason}`);
    assertEq(body.findings, null, 'with nothing to say about yesterday');
    assertEq(body.briefFreshness.state, 'unreadable', 'a read that failed judges no morning');
    await c.stop();
    cleanup(w.root);
  });

  await test('a machine with no home repo still serves a brief', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/brief');
    assertEq(status, 200, 'ok');
    assertEq(body.findings, null, 'there is nowhere to read a summary from');
    assertEq(body.history, null, 'and no history - a read that could not be made is null, never an empty series');
    assertEq(body.briefFreshness.state, 'unreadable', 'so the freshness is unreadable rather than stale or fine');
    assertEq(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 0,
      'and nothing was asked of GitHub');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/board serves the sweep, normalized', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/board');
    assertEq(status, 200, 'ok');
    assertEq(body.ok, true, 'the sweep succeeded');
    assertEq(body.issues.length, 2, 'both issues');
    assertEq(body.issues[0].status, 'specced', 'labels parsed');
    assertEq(body.issues[0].agentOk, true, 'the runway badge');
    assertEq(body.issues[1].priority, 'high', 'priority parsed');
    await c.stop();
    cleanup(w.root);
  });

  await test('a sweep still paging is SERVED as it stands, and the next read has the rest', async () => {
    // The board is drawn page by page on this machine too (issue #194): the
    // request that starts a sweep answers with the first pages rather than
    // holding the reader until the last one, marking what is still arriving.
    const w = pageTheBoard(mkWorld());
    const c = await start(w);

    const first = await getJson(c, '/api/board');
    assertEq(first.body.issues.length, 1, 'the page that had arrived is what the first read gets');
    assertEq(first.body.repos[0].loading, true, 'with the repo saying its issues are still coming');
    assertEq(first.body.repos[0].totalCount, 3, 'which is what the progress line counts against');
    // That body IS the proof the request did not wait for the last page:
    // a read held until the sweep ended could only have answered with all three.

    // The page's next poll, without the page. Bounded, so a sweep that never
    // finishes fails here instead of hanging the suite.
    let body = first.body;
    for (let i = 0; i < 100 && body.repos[0].loading; i += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      ({ body } = await getJson(c, '/api/board'));
    }
    assertEq(body.issues.length, 3, 'the finished board carries both pages');
    assertEq(body.repos[0].loading, undefined, 'and no progress at all - the line clears by being absent');
    assertEq(body.repos[0].truncated, false, 'the repo was swept to the end');
    assertEq(ghCalls(w, 'api').length, BOARD_PAGES.length, 'every page was asked for, behind the answer');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/sessions serves the live crew', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/sessions');
    assertEq(status, 200, 'ok');
    assertEq(body.length, 1, 'one marker');
    assertEq(body[0].claudePid, 5001, 'the pid from the marker name');
    assertEq(body[0].chatName, 'The tower build', 'the transcript title');
    assertEq(body[0].state, 'working', 'fresh transcript, live assertion');
    assertEq(body[0].model, 'claude-opus-5', 'from the statusline cache');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/health is keyed by repo path and carries the CHANGELOG count', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/health');
    assertEq(status, 200, 'ok');
    assertEq(tiles(body).length, 1, 'one tile');
    const health = body[gitPath(w.repo)];
    assertEq(health.unreleasedEntries, 1, 'one [Unreleased] bullet');
    assertEq(health.uncommitted, 0, 'a clean fixture');
    assertEq(health.unpushed, null, 'no upstream is null, not zero');
    await c.stop();
    cleanup(w.root);
  });

  await test('/api/health carries a meta block naming the process that is answering', async () => {
    const w = mkWorld();
    const c = await start(w);
    const { body } = await getJson(c, '/api/health');
    assert(body.meta && typeof body.meta === 'object', 'the payload carries a meta block');
    assert(/^[0-9a-f]{40}$/.test(body.meta.bootCommit), 'the commit the process booted from');
    assertEq(body.meta.currentHead, body.meta.bootCommit, 'and the checkout is at that same commit');
    assert(!Number.isNaN(new Date(body.meta.startedAt).getTime()), 'with a readable start time');
    assertEq(tiles(body).length, 1, 'beside the per-repo map, which is untouched');
    await c.stop();
    cleanup(w.root);
  });

  await test('a process older than its checkout shows the two commits differing', async () => {
    const w = mkWorld();
    // The #64 shape: the tower was started before the code on disk existed.
    scriptHead(w, ['a'.repeat(40), 'b'.repeat(40)]);
    const c = await start(w);
    const { body } = await getJson(c, '/api/health');
    assertEq(body.meta.bootCommit, 'a'.repeat(40), 'the boot capture is the OLD commit');
    assertEq(body.meta.currentHead, 'b'.repeat(40), 'and the live read is what is on disk now');
    assert(body.meta.bootCommit !== body.meta.currentHead, 'which is the staleness the page reads');
    await c.stop();
    cleanup(w.root);
  });

  await test('git failing answers two nulls - absence of proof is not staleness', async () => {
    const w = mkWorld();
    scriptHead(w, [new Error('spawnSync git ENOENT')]);
    const c = await start(w);
    const { status, body } = await getJson(c, '/api/health');
    assertEq(status, 200, 'the endpoint still answers');
    assertEq(body.meta.bootCommit, null, 'nothing was captured at boot');
    assertEq(body.meta.currentHead, null, 'and nothing can be read now');
    assertEq(tiles(body).length, 1, 'the readings are unaffected');
    await c.stop();
    cleanup(w.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
