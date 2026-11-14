//
// Tests for tower/api/server.js: the read endpoints.
// The shared prologue (the world factory, the server start, the request helpers) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect } = require('../../lib/harness');
const { gitPath } = require('../../lib/platform');
const {
  cleanup, SLUG, mkWorld, BOARD_PAGES, pageTheBoard, limitDiscussions, start, getJson, sweptBoard, ghCalls, tiles, scriptHead,
} = require('./helpers');

describe('tower/api/server: the read endpoints', () => {
  test('/api/repos serves the discovered roster', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/repos');
    expect(status, 'ok').toBe(200);
    expect(body.length, 'one repo in the fixture root').toBe(1);
    expect(body[0].slug, 'with its origin slug').toBe(SLUG);
    expect(body[0].path, 'and its path').toBe(gitPath(w.repo));
    cleanup(w.root);
  });

  test('/api/brief assembles the morning from the same board and health', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/brief');
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'the sweep behind it succeeded').toBe(true);
    // The fixture board is one specced issue and one blocked one.
    expect(body.counts.waiting, 'the blocked issue is waiting on a human').toBe(1);
    expect(body.waiting[0].number, 'and it is named').toBe(18);
    expect(body.counts.ready, 'the specced issue is unclaimed, so it is ready').toBe(1);
    expect(/waiting on a decision/.test(body.headline), 'the headline leads with the decision').toBeTruthy();
    // The fixture repo has an unreleased CHANGELOG entry and no tag.
    expect(body.warnings.length, 'the repo has work sitting on the table').toBe(1);
    expect(body.warnings[0].repo, 'named by its slug').toBe(SLUG);
    // The same board asked one question further - what this morning could move.
    expect(body.nextUp.length, 'the one repo has actionable work').toBe(1);
    expect(body.nextUp[0].items.map((i) => i.number).join(','), 'the decision leads, then the accepted spec').toBe('18,17');
    cleanup(w.root);
  });

  test('/api/brief never composes from half a board - it waits for the last page', async (t) => {
    // The board is drawn as it arrives; a morning is not: a brief composed from
    // whatever pages landed counts a repo's issues wrong, so it reads the last
    // finished board. The pause pins the state: the request lands mid-round and
    // is served as that round ends, with a page still to fetch.
    const w = pageTheBoard(mkWorld(), { pause: 60 });
    const c = await start(w);
    t.after(() => c.stop());

    const partial = await getJson(c, '/api/board');
    expect(partial.body.repos[0].loading, 'a sweep is in flight, and /api/board says so').toBe(true);
    expect(partial.body.issues.length, 'with one page of three issues on it').toBe(1);

    const { body } = await getJson(c, '/api/brief');
    expect(body.ok, 'the morning is composed').toBe(true);
    expect(body.counts.open, 'from every page, not the one that had landed').toBe(3);
    expect(body.counts.qa, 'the issue that arrived on page two is counted').toBe(1);
    expect(body.counts.inbox, 'and so is the one beside it').toBe(1);
    expect(body.repoCounts[0].open, 'and the repo it publishes a series from is whole').toBe(3);
    expect(ghCalls(w, 'api').length, 'it asked for the pages itself rather than answering without them').toBe(BOARD_PAGES.length);

    // What it drove to the end is the board itself, not a copy of one.
    const after = await getJson(c, '/api/board');
    expect(after.body.issues.length, 'the sweep the brief settled is what everyone else now reads').toBe(3);
    expect(after.body.repos[0].loading, 'finished, and saying so by saying nothing').toBe(undefined);
    cleanup(w.root);
  });

  test('/api/brief carries the published summaries, read once per board minute', async (t) => {
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
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/brief');
    expect(body.findings.title, 'what yesterday produced').toBe('daily: 2026-08-02');
    expect(body.findings.url, 'linked to the post itself').toBe('https://github.com/owner/private-home/discussions/2');
    // The week rides on Mondays only, which is a fact about the day this suite
    // runs on - the rule itself is summaries.test.js's.
    expect('week' in body, 'and the rollup only on a Monday').toBe(new Date().getDay() === 1);

    const asked = () => w.calls.filter((call) => call.join(' ').includes('discussions(first')).length;
    const first = asked();
    expect(first >= 1, 'the summaries were read').toBeTruthy();
    await getJson(c, '/api/brief');
    expect(asked(), 'a second poll inside the minute was served from memory').toBe(first);
    cleanup(w.root);
  });

  test('/api/brief carries the board over time, read off the published briefs', async (t) => {
    // The history is the one thing on this payload a live sweep cannot answer:
    // the mornings before this one, each recorded in the brief it published.
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
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/brief');
    expect(body.history.length, 'the two mornings that recorded themselves').toBe(2);
    expect(body.history.map((entry) => entry.date).join(','), 'oldest first, the order a chart draws in').toBe('2026-08-01,2026-08-03');
    expect(body.history[1].totals.open, 'and the numbers each one carried').toBe(12);
    expect(body.closedDay, 'while today’s closed count comes from the sweep, not from the history').toBe(0);
    cleanup(w.root);
  });

  test('/api/brief carries the mornings themselves, off that same read', async (t) => {
    // A body is the one thing on this payload nothing else supplies: the numbers
    // are what the posts counted, the texts what they said, both off the one
    // Discussions read, so the archive costs no round trip.
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
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/brief');
    expect(body.documents.length, 'the morning and the summary beside it').toBe(2);
    expect(body.documents[0].kind, 'newest first, and each one says what it is').toBe('brief');
    expect(body.documents[0].body, 'carrying the text, with the machine markers off it').toBe('HEADLINE: today.');
    expect(body.documents[0].url, 'and the post it can be opened on').toBe('https://github.com/owner/private-home/discussions/3');
    expect(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 'the summaries read and the one the series and the archive share - the archive adds no round trip').toBe(2);
    cleanup(w.root);
  });

  test('/api/brief says how old the newest published brief is, off that same read', async (t) => {
    // The date is already in the history read, so the freshness rides beside it
    // and costs no second round trip.
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
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/brief');
    expect(body.briefFreshness.state, 'the newest morning is long past').toBe('stale');
    expect(body.briefFreshness.date, 'and the payload names the day it was').toBe('2026-08-03');
    expect(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 'the summaries read and the history read, as before - the freshness adds no round trip of its own').toBe(2);

    w.discussions = [];
    const empty = await start(w);
    t.after(() => empty.stop());
    expect((await getJson(empty, '/api/brief')).body.briefFreshness.state, 'a home repo that has published no brief carrying a block has never published one').toBe('never');
    cleanup(w.root);
  });

  test('/api/brief says WHY the mornings are missing, never only that they are (#215)', async (t) => {
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
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/brief');
    expect(body.ok, 'the sweep itself answered, so the brief is a brief').toBe(true);
    expect(body.history, 'the series could not be read').toBe(null);
    expect(body.documents, 'and neither could the mornings themselves').toBe(null);
    expect(/^GitHub rate limit hit for this token; resets at /.test(body.historyReason),
      `the payload names the limit: ${body.historyReason}`).toBeTruthy();
    expect(/^GitHub rate limit hit for this token; resets at /.test(body.summariesReason),
      `and so does the summaries read beside it: ${body.summariesReason}`).toBeTruthy();
    expect(body.findings, 'with nothing to say about yesterday').toBe(null);
    expect(body.briefFreshness.state, 'a read that failed judges no morning').toBe('unreadable');
    cleanup(w.root);
  });

  test('a machine with no home repo still serves a brief', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/brief');
    expect(status, 'ok').toBe(200);
    expect(body.findings, 'there is nowhere to read a summary from').toBe(null);
    expect(body.history, 'and no history - a read that could not be made is null, never an empty series').toBe(null);
    expect(body.briefFreshness.state, 'so the freshness is unreadable rather than stale or fine').toBe('unreadable');
    expect(w.calls.filter((call) => call.join(' ').includes('discussions(first')).length, 'and nothing was asked of GitHub').toBe(0);
    cleanup(w.root);
  });

  test('/api/board serves the sweep, normalized', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/board');
    expect(status, 'ok').toBe(200);
    expect(body.ok, 'the sweep succeeded').toBe(true);
    expect(body.issues.length, 'both issues').toBe(2);
    expect(body.issues[0].status, 'labels parsed').toBe('specced');
    expect(body.issues[0].agentOk, 'the runway badge').toBe(true);
    expect(body.issues[1].priority, 'priority parsed').toBe('high');
    cleanup(w.root);
  });

  test('a sweep still paging is SERVED as it stands, and the next read has the rest', async (t) => {
    // The board is drawn page by page on this machine too: the request that
    // starts a sweep answers with the first pages rather than holding the reader
    // until the last one, marking what is still arriving.
    const w = pageTheBoard(mkWorld());
    const c = await start(w);
    t.after(() => c.stop());

    const first = await getJson(c, '/api/board');
    expect(first.body.issues.length, 'the page that had arrived is what the first read gets').toBe(1);
    expect(first.body.repos[0].loading, 'with the repo saying its issues are still coming').toBe(true);
    expect(first.body.repos[0].totalCount, 'which is what the progress line counts against').toBe(3);
    // That body is the proof the request did not wait for the last page:
    // a read held until the sweep ended could only have answered with all three.

    // The page's next poll, without the page. Bounded, so a sweep that never
    // finishes fails here instead of hanging the suite.
    const body = await sweptBoard(c, first.body);
    expect(body.issues.length, 'the finished board carries both pages').toBe(3);
    expect(body.repos[0].loading, 'and no progress at all - the line clears by being absent').toBe(undefined);
    expect(body.repos[0].truncated, 'the repo was swept to the end').toBe(false);
    expect(ghCalls(w, 'api').length, 'every page was asked for, behind the answer').toBe(BOARD_PAGES.length);
    cleanup(w.root);
  });

  test('/api/sessions serves the live crew', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/sessions');
    expect(status, 'ok').toBe(200);
    expect(body.length, 'one marker').toBe(1);
    expect(body[0].claudePid, 'the pid from the marker name').toBe(5001);
    expect(body[0].chatName, 'the transcript title').toBe('The tower build');
    expect(body[0].state, 'fresh transcript, live assertion').toBe('working');
    expect(body[0].model, 'from the statusline cache').toBe('claude-opus-5');
    cleanup(w.root);
  });

  test('/api/health is keyed by repo path and carries the CHANGELOG count', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/health');
    expect(status, 'ok').toBe(200);
    expect(tiles(body).length, 'one tile').toBe(1);
    const health = body[gitPath(w.repo)];
    expect(health.unreleasedEntries, 'one [Unreleased] bullet').toBe(1);
    expect(health.uncommitted, 'a clean fixture').toBe(0);
    expect(health.unpushed, 'no upstream is null, not zero').toBe(null);
    cleanup(w.root);
  });

  test('/api/health carries a meta block naming the process that is answering', async (t) => {
    const w = mkWorld();
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/health');
    expect(body.meta && typeof body.meta === 'object', 'the payload carries a meta block').toBeTruthy();
    expect(/^[0-9a-f]{40}$/.test(body.meta.bootCommit), 'the commit the process booted from').toBeTruthy();
    expect(body.meta.currentHead, 'and the checkout is at that same commit').toBe(body.meta.bootCommit);
    expect(!Number.isNaN(new Date(body.meta.startedAt).getTime()), 'with a readable start time').toBeTruthy();
    expect(tiles(body).length, 'beside the per-repo map, which is untouched').toBe(1);
    cleanup(w.root);
  });

  test('a process older than its checkout shows the two commits differing', async (t) => {
    const w = mkWorld();
    // The tower started before the code on disk existed.
    scriptHead(w, ['a'.repeat(40), 'b'.repeat(40)]);
    const c = await start(w);
    t.after(() => c.stop());
    const { body } = await getJson(c, '/api/health');
    expect(body.meta.bootCommit, 'the boot capture is the OLD commit').toBe('a'.repeat(40));
    expect(body.meta.currentHead, 'and the live read is what is on disk now').toBe('b'.repeat(40));
    expect(body.meta.bootCommit !== body.meta.currentHead, 'which is the staleness the page reads').toBeTruthy();
    cleanup(w.root);
  });

  test('git failing answers two nulls - absence of proof is not staleness', async (t) => {
    const w = mkWorld();
    scriptHead(w, [new Error('spawnSync git ENOENT')]);
    const c = await start(w);
    t.after(() => c.stop());
    const { status, body } = await getJson(c, '/api/health');
    expect(status, 'the endpoint still answers').toBe(200);
    expect(body.meta.bootCommit, 'nothing was captured at boot').toBe(null);
    expect(body.meta.currentHead, 'and nothing can be read now').toBe(null);
    expect(tiles(body).length, 'the readings are unaffected').toBe(1);
    cleanup(w.root);
  });
});
