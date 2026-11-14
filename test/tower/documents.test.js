//
// Tests for tower/api/lib/documents.js: what each morning said (history.js has
// what it counted), read through a fake `gh` and a scratch ~/.workkit, never GitHub.
//

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');

const { documentsFrom, readable, DOCUMENT_LIMIT } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'documents.js'));
const { readDiscussions, historyFrom } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A scratch ~/.workkit naming a home repo - or naming none. */
const mkHome = (repo = 'owner/private-home') => {
  const dir = mkTmp('tower-documents-');
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
  );
  return dir;
};

/** The line a morning publishes, as jobs/morning/brief/stats.js renders it. */
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

describe('tower/documents: every morning, and every summary beside it', () => {
  test('both kinds of post are documents, newest first, and the title says which is which', () => {
    const out = documentsFrom([brief('2026-08-03'), daily('2026-08-02'), brief('2026-08-02')]);
    expect(out.length, 'a brief is not a different feed from a summary - the archive is the board').toBe(3);
    expect(out.map((doc) => doc.kind).join(','), 'the title prefix is the whole of the question').toBe('brief,summary,brief');
    expect(out.map((doc) => doc.title).join(','), 'newest first - the order the board answered in, which is the order an archive is read in').toBe('brief: 2026-08-03,daily: 2026-08-02,brief: 2026-08-02');
  });

  test('a document carries what a card and a dialog need, and the post it came from', () => {
    const [doc] = documentsFrom([brief('2026-08-03')]);
    expect(doc.url, 'the post itself').toBe('https://github.com/owner/private-home/discussions/2026-08-03');
    expect(doc.createdAt, 'the day it was published').toBe('2026-08-03T09:00:00Z');
    expect(doc.body.startsWith('HEADLINE: 2026-08-03 happened.'), `and the text whole: ${doc.body}`).toBeTruthy();
  });

  test('the machine markers come off, and the blank lines they leave with them', () => {
    const [doc] = documentsFrom([brief('2026-08-03')]);
    expect(!doc.body.includes('workkit-stats'), 'the stats line is not something a reader should see').toBeTruthy();
    expect(!doc.body.includes('cc-news'), 'nor the news cursor beside it').toBeTruthy();
    expect(doc.body, 'and what is left is the digest, with no hole where they were').toBe('HEADLINE: 2026-08-03 happened.\n\nIN FLIGHT: nothing.');
    expect(readable('one\n\n\n\n\ntwo'), 'three blank lines in a row is a gap, not a paragraph').toBe('one\n\ntwo');
    expect(readable(null), 'and a post with no body at all is the empty string, never a throw').toBe('');
  });

  test('a post with no title is no document', () => {
    // The kind is decided by the title, so a node without one cannot be placed -
    // and it is the shape a read of another schema comes back in.
    const out = documentsFrom([{ title: '', url: 'u', createdAt: null, body: 'orphan' }, daily('2026-08-02')]);
    expect(out.length, 'it is left out rather than filed as a summary').toBe(1);
    expect(out[0].kind, 'and the one with a title is placed by it').toBe('summary');
  });

  test('nothing to read is an empty archive, never a throw', () => {
    expect(documentsFrom(null).length, 'a read that failed hands over null, and the caller says the sentence for it').toBe(0);
    expect(documentsFrom([]).length, 'a board with nothing on it has an empty archive').toBe(0);
  });

  test('the archive is capped, keeping the newest', () => {
    const nodes = [];
    for (let i = 0; i < DOCUMENT_LIMIT + 10; i++) nodes.push(brief(`2026-06-${String(60 - i).padStart(2, '0')}`));
    const out = documentsFrom(nodes);
    expect(out.length, `${DOCUMENT_LIMIT} documents at most - the bodies ride the payload`).toBe(DOCUMENT_LIMIT);
    expect(out[0].title, 'the newest post is the first one').toBe('brief: 2026-06-60');
  });
});

describe('tower/documents: one read, two readings', () => {
  test('the read carries the fields a card needs, off the query the series already made', () => {
    const home = mkHome();
    const calls = [];
    const { nodes } = readDiscussions({ workflowHome: home, exec: mkExec([brief('2026-08-03')], calls) });
    expect(calls.length, 'one round trip').toBe(1);
    const argv = calls[0].join(' ');
    for (const field of ['title', 'url', 'createdAt', 'body']) {
      expect(argv.includes(field), `the query asks for ${field}: ${argv}`).toBeTruthy();
    }
    expect(nodes.length, 'and the board comes back').toBe(1);
    cleanup(home);
  });

  test('the archive and the series are two readings of that one read', () => {
    const home = mkHome();
    const calls = [];
    const { nodes } = readDiscussions({ workflowHome: home, exec: mkExec([brief('2026-08-03'), daily('2026-08-02')], calls) });
    expect(documentsFrom(nodes).length, 'the archive is both posts').toBe(2);
    expect(historyFrom(nodes).length, 'the series is the one that carried a stats line').toBe(1);
    expect(calls.length, 'and asking both questions cost one round trip, not two').toBe(1);
    cleanup(home);
  });

  test('a node of another shape is normalized at the read, never defended against twice', () => {
    const home = mkHome();
    const { nodes } = readDiscussions({
      workflowHome: home,
      exec: mkExec([null, { title: 7 }, { title: 'daily: 2026-08-02' }]),
    });
    expect(nodes.length, 'a null node is not a post').toBe(2);
    expect(nodes[0].title, 'a title that is not a string is no title').toBe('');
    expect(nodes[1].body, 'a post that answered with no body reads as empty').toBe('');
    expect(nodes[1].url, 'and with no url as unlinked').toBe('');
    expect(documentsFrom(nodes).length, 'so the archive is the one post that can be placed').toBe(1);
    cleanup(home);
  });

  test('a read that could not be made is null, which is not an empty archive', () => {
    const home = mkHome();
    expect(readDiscussions({ workflowHome: home, exec: () => { throw new Error('gh: not authenticated'); } }).nodes, 'a read that failed').toBe(null);
    expect(readDiscussions({ workflowHome: home, exec: () => 'not json at all' }).nodes, 'an answer of another shape').toBe(null);
    const noHome = mkHome(null);
    expect(readDiscussions({
      workflowHome: noHome,
      exec: () => { throw new Error('gh must not be called at all'); },
    }).nodes, 'a machine with nowhere to read from never asks').toBe(null);
    cleanup(home); cleanup(noHome);
  });
});
