//
// Tests for tower/api/lib/documents.js - the mornings themselves.
//
// The read is history.js's and its one seam is `gh`, so every case here is a
// fake exec answering the Discussions query with a board of published posts.
// Nothing reaches GitHub, and the scratch ~/.workkit is what names the home
// repo.
//
// The question this module answers is the OTHER one asked of that same board:
// not what a morning counted (history.js) but what it said. So the cases are
// about the text - which posts are documents, what comes off a body before a
// browser renders it, and how far back the archive goes.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { documentsFrom, readable, DOCUMENT_LIMIT } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'documents.js'));
const { readDiscussions, historyFrom } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-documents-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A scratch ~/.workkit naming a home repo - or naming none. */
const mkHome = (repo = 'owner/private-home') => {
  const dir = mkTmp();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
  );
  return dir;
};

/** The line a morning publishes, as jobs/stats.js renders it. */
const mark = (date) => `<!-- workkit-stats: {"v":1,"date":"${date}","totals":{"open":9,"waiting":0,"ready":0,"inFlight":0,"inbox":0,"backlog":0},"closedDay":1,"repos":{}} -->`;

/** A published brief: a digest, the news cursor, then the stats line. */
const brief = (date) => ({
  title: `brief: ${date}`,
  url: `https://github.com/owner/private-home/discussions/${date}`,
  createdAt: `${date}T09:00:00Z`,
  body: `HEADLINE: ${date} happened.\n\nIN FLIGHT: nothing.\n\n<!-- cc-news: 2.1.220 -->\n${mark(date)}\n`,
});

/** A published summary - the other kind of post on the same board. */
const daily = (date) => ({
  title: `daily: ${date}`,
  url: `https://github.com/owner/private-home/discussions/d${date}`,
  createdAt: `${date}T21:00:00Z`,
  body: `# ${date}\n\nwhat the day produced.`,
});

/** A `gh` that answers the Discussions query with `nodes`, newest first. */
const mkExec = (nodes, calls = []) => (cmd, args) => {
  calls.push([cmd, ...args]);
  if (cmd !== 'gh') throw new Error(`unexpected command: ${cmd}`);
  return JSON.stringify({ data: { repository: { discussions: { nodes } } } });
};

const run = async () => {
  group('tower/documents: every morning, and every summary beside it');

  await test('both kinds of post are documents, newest first, and the title says which is which', () => {
    const out = documentsFrom([brief('2026-08-03'), daily('2026-08-02'), brief('2026-08-02')]);
    assertEq(out.length, 3, 'a brief is not a different feed from a summary - the archive is the board');
    assertEq(out.map((doc) => doc.kind).join(','), 'brief,summary,brief', 'the title prefix is the whole of the question');
    assertEq(out.map((doc) => doc.title).join(','), 'brief: 2026-08-03,daily: 2026-08-02,brief: 2026-08-02',
      'newest first - the order the board answered in, which is the order an archive is read in');
  });

  await test('a document carries what a card and a dialog need, and the post it came from', () => {
    const [doc] = documentsFrom([brief('2026-08-03')]);
    assertEq(doc.url, 'https://github.com/owner/private-home/discussions/2026-08-03', 'the post itself');
    assertEq(doc.createdAt, '2026-08-03T09:00:00Z', 'the day it was published');
    assert(doc.body.startsWith('HEADLINE: 2026-08-03 happened.'), `and the text whole: ${doc.body}`);
  });

  await test('the machine markers come off, and the blank lines they leave with them', () => {
    const [doc] = documentsFrom([brief('2026-08-03')]);
    assert(!doc.body.includes('workkit-stats'), 'the stats line is not something a reader should see');
    assert(!doc.body.includes('cc-news'), 'nor the news cursor beside it');
    assertEq(doc.body, 'HEADLINE: 2026-08-03 happened.\n\nIN FLIGHT: nothing.',
      'and what is left is the digest, with no hole where they were');
    assertEq(readable('one\n\n\n\n\ntwo'), 'one\n\ntwo', 'three blank lines in a row is a gap, not a paragraph');
    assertEq(readable(null), '', 'and a post with no body at all is the empty string, never a throw');
  });

  await test('a post with no title is no document', () => {
    // The kind is decided by the title, so a node without one cannot be placed -
    // and it is the shape a read of another schema comes back in.
    const out = documentsFrom([{ title: '', url: 'u', createdAt: null, body: 'orphan' }, daily('2026-08-02')]);
    assertEq(out.length, 1, 'it is left out rather than filed as a summary');
    assertEq(out[0].kind, 'summary', 'and the one with a title is placed by it');
  });

  await test('nothing to read is an empty archive, never a throw', () => {
    assertEq(documentsFrom(null).length, 0, 'a read that failed hands over null, and the caller says the sentence for it');
    assertEq(documentsFrom([]).length, 0, 'a board with nothing on it has an empty archive');
  });

  await test('the archive is capped, keeping the newest', () => {
    const nodes = [];
    for (let i = 0; i < DOCUMENT_LIMIT + 10; i++) nodes.push(brief(`2026-06-${String(60 - i).padStart(2, '0')}`));
    const out = documentsFrom(nodes);
    assertEq(out.length, DOCUMENT_LIMIT, `${DOCUMENT_LIMIT} documents at most - the bodies ride the payload`);
    assertEq(out[0].title, 'brief: 2026-06-60', 'the newest post is the first one');
  });

  group('tower/documents: one read, two readings');

  await test('the read carries the fields a card needs, off the query the series already made', () => {
    const home = mkHome();
    const calls = [];
    const nodes = readDiscussions({ workflowHome: home, exec: mkExec([brief('2026-08-03')], calls) });
    assertEq(calls.length, 1, 'one round trip');
    const argv = calls[0].join(' ');
    for (const field of ['title', 'url', 'createdAt', 'body']) {
      assert(argv.includes(field), `the query asks for ${field}: ${argv}`);
    }
    assertEq(nodes.length, 1, 'and the board comes back');
    cleanup(home);
  });

  await test('the archive and the series are two readings of that one read', () => {
    const home = mkHome();
    const calls = [];
    const nodes = readDiscussions({ workflowHome: home, exec: mkExec([brief('2026-08-03'), daily('2026-08-02')], calls) });
    assertEq(documentsFrom(nodes).length, 2, 'the archive is both posts');
    assertEq(historyFrom(nodes).length, 1, 'the series is the one that carried a stats line');
    assertEq(calls.length, 1, 'and asking both questions cost one round trip, not two');
    cleanup(home);
  });

  await test('a node of another shape is normalized at the read, never defended against twice', () => {
    const home = mkHome();
    const nodes = readDiscussions({
      workflowHome: home,
      exec: mkExec([null, { title: 7 }, { title: 'daily: 2026-08-02' }]),
    });
    assertEq(nodes.length, 2, 'a null node is not a post');
    assertEq(nodes[0].title, '', 'a title that is not a string is no title');
    assertEq(nodes[1].body, '', 'a post that answered with no body reads as empty');
    assertEq(nodes[1].url, '', 'and with no url as unlinked');
    assertEq(documentsFrom(nodes).length, 1, 'so the archive is the one post that can be placed');
    cleanup(home);
  });

  await test('a read that could not be made is null, which is not an empty archive', () => {
    const home = mkHome();
    assertEq(readDiscussions({ workflowHome: home, exec: () => { throw new Error('gh: not authenticated'); } }), null, 'a read that failed');
    assertEq(readDiscussions({ workflowHome: home, exec: () => 'not json at all' }), null, 'an answer of another shape');
    const noHome = mkHome(null);
    assertEq(readDiscussions({
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }), null, 'a machine with nowhere to read from never asks');
    cleanup(home); cleanup(noHome);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
