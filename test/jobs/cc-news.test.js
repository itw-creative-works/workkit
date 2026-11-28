// Tests for jobs/morning/brief/cc-news.js: the upstream Claude Code entries the
// morning brief carries, grouped by topic. The news read fetches a fixture
// CHANGELOG from a local server on a port the system picks, and the board read
// goes through the injected exec seam (`gh` a fixture board), so nothing here
// reaches the network or the real ~/.workkit.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  describe, test, expect, before, after, WORKKIT_DIR, mkTmp,
} = require('../lib/harness');

const { collectCcNews, fetchChangelog, renderCcNews, renderVersionMark, parseSections, topicOf } =
  require(path.join(__dirname, '..', '..', 'jobs', 'morning', 'brief', 'cc-news.js'));

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// The source the news read fetches: one server for the suite, each world a path
// of its own answering by the world's `status` and `stall`.
const worlds = new Map();
let base = '';
const server = http.createServer((req, res) => {
  const world = worlds.get(req.url);
  if (!world) { res.writeHead(404); res.end(); return; }
  res.writeHead(world.status, { 'content-type': 'text/plain' });
  // A stall sends the head and the start of the text, then nothing more.
  if (world.stall) { res.write(world.text.slice(0, 20)); return; }
  res.end(world.text);
});

before(() => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => {
  server.closeAllConnections();
  server.close();
});

/** An address where nothing listens: a port the system gave out, then closed. */
const refusedSource = () => new Promise((resolve) => {
  const gone = http.createServer();
  gone.listen(0, '127.0.0.1', () => {
    const { port } = gone.address();
    gone.close(() => resolve(`http://127.0.0.1:${port}/CHANGELOG.md`));
  });
});

// Two releases of harness news and one of housekeeping, in the shape upstream
// publishes: `## <version>` and a list under it.
const CHANGELOG = `# Changelog

## 2.1.220

- Added a \`DirectoryAdded\` hook that fires when a directory is registered mid-session
- Fixed copy-on-select inside GNU screen printing base64 into the terminal

## 2.1.219

- Added the \`workflowSizeGuideline\` settings key
- Changed \`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH\` to default to 3
- Fixed the model picker showing a stale row

## 2.1.218

- Bug fixes and reliability improvements
`;

const SLUG = 'owner/private-home';

/**
 * A world: a scratch workflow home naming a home repo, its own path on the
 * suite's server serving the fixture CHANGELOG, plus an exec seam that answers
 * `gh` with the fixture board.
 *
 * `slug: null` writes no settings file: a machine with no home repo, which is
 * a board that cannot be read at all.
 */
const mkWorld = (text = CHANGELOG, { slug = SLUG } = {}) => {
  const home = mkTmp('cc-news-');
  const route = `/${path.basename(home)}/CHANGELOG.md`;
  const world = {
    home,
    workflowHome: path.join(home, WORKKIT_DIR),
    cacheFile: path.join(home, WORKKIT_DIR, '.cache.json'),
    route,
    source: `${base}${route}`,
    calls: [],
    text,
    status: 200,       // what the server answers the news read with
    stall: false,      // the server sends the head and a little text, then nothing
    ghFail: null,      // the board read throws
    ghOut: null,       // raw board stdout, for the answers jq would not parse
    discussions: [],   // what the home repo carries, newest first
  };
  worlds.set(route, world);
  world.exec = (cmd, args) => {
    world.calls.push([cmd, ...args]);
    if (cmd === 'gh') {
      if (world.ghFail) throw world.ghFail;
      if (world.ghOut !== null) return world.ghOut;
      return JSON.stringify({ data: { repository: { discussions: { nodes: world.discussions } } } });
    }
    throw new Error(`the news read started ${cmd}: it fetches, it starts no program`);
  };
  fs.mkdirSync(world.workflowHome, { recursive: true });
  if (slug) {
    fs.writeFileSync(
      path.join(world.workflowHome, 'settings.json'),
      JSON.stringify({ version: 1, site: { repo: slug, publish: false, url: null } }),
    );
  }
  return world;
};

const collectIn = async (world) => collectCcNews({
  workflowHome: world.workflowHome,
  source: world.source,
  exec: world.exec,
});

// The cursor is a line in the latest published brief, so seeding it
// means putting a brief on the board.
const board = (world, version) => {
  world.discussions = [{
    title: 'brief: 2026-07-29',
    body: `HEADLINE: yesterday happened.\nIN FLIGHT: nothing.\n\n${renderVersionMark(version)}\n`,
  }];
};

const ghCalls = (world) => world.calls.filter(([cmd]) => cmd === 'gh');

describe('jobs/cc-news: parsing', () => {
  test('the release sections and their entries come out in file order', () => {
    const sections = parseSections(CHANGELOG);
    expect(sections.length, 'three releases').toBe(3);
    expect(sections[0].version, 'newest first, as published').toBe('2.1.220');
    expect(sections[0].entries.length, 'with its entries').toBe(2);
    expect(sections[2].entries[0], 'text without the bullet').toBe('Bug fixes and reliability improvements');
  });

  test('a heading that is not a version carries no entries', () => {
    const sections = parseSections('# Changelog\n\n- not a release\n\n## [Unreleased]\n\n- nor this\n');
    expect(sections.length, 'nothing is a release').toBe(0);
  });
});

describe('jobs/cc-news: the topic map', () => {
  test('entries file under the kit surface they name', () => {
    expect(topicOf('Added a `DirectoryAdded` hook that fires mid-session'), 'hooks').toBe('hooks');
    expect(topicOf('Added the `workflowSizeGuideline` settings key'), 'settings').toBe('settings');
    expect(topicOf('Added HTTP status text to `claude mcp list` and MCP errors'), 'MCP').toBe('MCP');
    expect(topicOf('Added the workflow size to the running status line'), 'statusline').toBe('statusline');
    expect(topicOf('Set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 to disable nesting'), 'env vars are settings').toBe('settings');
    expect(topicOf('Updated the claude-api skill to default to Opus 5'), 'skills').toBe('skills');
    expect(topicOf('Fixed a plugin marketplace refresh'), 'plugins').toBe('plugins');
    expect(topicOf('Raised the subagent spawn depth ceiling'), 'agents').toBe('agents');
  });

  test('everything else files under other: a bucket, never dropped', () => {
    expect(topicOf('Bug fixes and reliability improvements'), 'housekeeping').toBe('other');
    expect(topicOf('Fixed multi-line paste collapsing into one line'), 'paste').toBe('other');
  });
});


describe('jobs/cc-news: what is newer than the cursor', () => {
  test('every entry above the cursor rides, each carrying its version and topic', async () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const news = await collectIn(world);
    expect(news.matches.length, 'both entries of the one newer release').toBe(2);
    expect(news.matches[0].version, 'the version each shipped in').toBe('2.1.220');
    expect(news.matches[0].topic, 'the hook entry files under hooks').toBe('hooks');
    expect(news.matches[1].topic, 'the terminal fix files under other, not dropped').toBe('other');
    expect(news.since, 'and the brief knows where it counted from').toBe('2.1.219');
    cleanup(world.home);
  });

  test('an older cursor reaches back across releases, housekeeping included', async () => {
    const world = mkWorld();
    board(world, '2.1.218');
    const news = await collectIn(world);
    expect(news.matches.length, 'all five entries of the two newer releases').toBe(5);
    expect(news.matches.some((m) => /model picker/.test(m.entry)), 'the picker fix rides too: the digest judges, not the job').toBeTruthy();
    cleanup(world.home);
  });

  test('a cursor at the latest release reports nothing', async () => {
    const world = mkWorld();
    board(world, '2.1.220');
    const news = await collectIn(world);
    expect(news.matches.length, 'a quiet morning').toBe(0);
    expect(renderCcNews(news), 'and no block at all').toBe('');
    cleanup(world.home);
  });

  test('the block groups by topic, versions on every line', async () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const block = renderCcNews(await collectIn(world));
    expect(/^\n--- CC NEWS ---\n/.test(block), 'it is a labeled block').toBeTruthy();
    expect(/since 2\.1\.219, by topic:/.test(block), 'saying where it counted from').toBeTruthy();
    expect(/\[hooks\]\n2\.1\.220: Added a `DirectoryAdded` hook/.test(block), `entries sit under their topic: ${block}`).toBeTruthy();
    expect(/\[other\]\n2\.1\.220: Fixed copy-on-select/.test(block), `and other files last: ${block}`).toBeTruthy();
    expect(block.indexOf('[hooks]') < block.indexOf('[other]'), 'kit surfaces before the rest').toBeTruthy();
    cleanup(world.home);
  });
});

describe('jobs/cc-news: the cursor is the board', () => {
  test('the since is read off the latest published brief, over gh', async () => {
    const world = mkWorld();
    board(world, '2.1.219');
    expect((await collectIn(world)).since, 'the line in the brief IS the cursor').toBe('2.1.219');
    const calls = ghCalls(world);
    expect(calls.length, `one board read: ${JSON.stringify(calls)}`).toBe(1);
    const argv = calls[0].join(' ');
    expect(/api graphql/.test(argv), 'through the GraphQL API').toBeTruthy();
    expect(argv.includes(`owner=${SLUG.split('/')[0]}`) && argv.includes(`name=${SLUG.split('/')[1]}`),
      `against the home repo the settings name: ${argv}`).toBeTruthy();
    expect(/discussions\(first:/.test(argv), 'asking for its discussions').toBeTruthy();
    cleanup(world.home);
  });

  test('the newest brief wins, and older ones are not consulted', async () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: renderVersionMark('2.1.219') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.100') },
    ];
    expect((await collectIn(world)).since, 'the board is newest first and the first brief answers').toBe('2.1.219');
    cleanup(world.home);
  });

  test('a summary discussion is not a brief', async () => {
    // The daily summaries share the board. Only a `brief: ` title is a cursor.
    const world = mkWorld();
    world.discussions = [
      { title: 'daily: 2026-07-29', body: renderVersionMark('2.1.100') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.219') },
    ];
    expect((await collectIn(world)).since, 'the summary above it is passed over').toBe('2.1.219');
    cleanup(world.home);
  });

  test('a brief with no version line is passed over for one that has it', async () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: 'HEADLINE: nothing to see.\n' },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.218') },
    ];
    expect((await collectIn(world)).since, 'the line is what makes a brief a cursor').toBe('2.1.218');
    cleanup(world.home);
  });

  test('a brief far down a busy board is still the cursor', async () => {
    // Two posts a day share this board, and a morning whose send failed carries
    // no line at all. A narrow read window lets the last line-carrying brief
    // scroll out of view, which reads as an empty board and re-seeds the cursor,
    // every entry in between never reported.
    const world = mkWorld();
    const filler = Array.from({ length: 60 }, (_, i) => (
      { title: `daily: 2026-07-${i}`, body: 'a summary carries no cursor' }
    ));
    world.discussions = [...filler, { title: 'brief: 2026-06-01', body: renderVersionMark('2.1.218') }];
    const news = await collectIn(world);
    expect(news.since, 'sixty posts deep is still inside the window').toBe('2.1.218');
    expect(news.matches.length, 'so the entries in between are reported rather than seeded past').toBe(5);
    expect(/discussions\(first:100/.test(ghCalls(world)[0].join(' ')), 'the window is the GraphQL maximum').toBeTruthy();
    cleanup(world.home);
  });

  test('the version line is the shape the runner publishes', () => {
    expect(renderVersionMark('2.1.220'), 'greppable, and invisible when rendered').toBe('<!-- cc-news: 2.1.220 -->');
  });
});

describe('jobs/cc-news: a first run seeds, it does not report', () => {
  test('an empty board is a first run: nothing reported, the latest carried', async () => {
    const world = mkWorld();
    const news = await collectIn(world);
    expect(news.since, 'nothing has ever been published').toBe(null);
    expect(news.matches.length, 'so the history is not dumped into the brief').toBe(0);
    expect(news.version, 'and the brief about to publish carries the latest').toBe('2.1.220');
    cleanup(world.home);
  });

  test('no home repo reads as a first run, and asks gh nothing', async () => {
    const world = mkWorld(CHANGELOG, { slug: null });
    const news = await collectIn(world);
    expect(news.since, 'there is no board to read').toBe(null);
    expect(ghCalls(world).length, 'so nothing was asked of it').toBe(0);
    expect(news.version, 'the version is still there to publish').toBe('2.1.220');
    cleanup(world.home);
  });

  test('the cursor never moves backwards', async () => {
    const world = mkWorld();
    board(world, '2.2.0');
    const news = await collectIn(world);
    expect(news.version, 'an older source does not rewind the cursor').toBe('2.2.0');
    cleanup(world.home);
  });
});

describe('jobs/cc-news: nothing on this machine records the cursor', () => {
  test('a pre-seeded ccNews key is left byte-identical', async () => {
    // No migration: the stale key is the owner's to remove, and no runner is
    // allowed to read it, write it, or take it away.
    const world = mkWorld();
    board(world, '2.1.218');
    const seeded = JSON.stringify({ ccNews: { version: '1.0.0' }, homeCache: { [SLUG]: { repositoryId: 'R_1' } } });
    fs.writeFileSync(world.cacheFile, seeded);
    const news = await collectIn(world);
    expect(news.since, 'the board answered, not the file').toBe('2.1.218');
    expect(fs.readFileSync(world.cacheFile, 'utf8'), 'and the file is untouched').toBe(seeded);
    cleanup(world.home);
  });
});

describe('jobs/cc-news: a failure is silent', () => {
  // The 404 serves a real changelog, so a read that ignored the status would
  // hand it back; the stall sends a little of the text, then nothing, under a
  // short bound in place of the module's 20 seconds.
  test('the news read: a served text comes back whole, and a 404, a refused connection and a stall past the bound each answer null', async () => {
    const served = mkWorld();
    expect(await fetchChangelog(served.source), 'the served text, as served').toBe(CHANGELOG);
    const missing = mkWorld();
    missing.status = 404;
    expect(await fetchChangelog(missing.source), 'a 404').toBe(null);
    expect(await fetchChangelog(await refusedSource()), 'a refused connection').toBe(null);
    const stalled = mkWorld();
    stalled.stall = true;
    expect(await fetchChangelog(stalled.source, 200), 'a stall past the bound').toBe(null);
    for (const world of [served, missing, stalled]) cleanup(world.home);
  });

  test('the news read from a file: address: the file\'s text comes back, and a missing or an empty file answers null', async () => {
    const dir = mkTmp('cc-news-file-');
    const at = (name) => pathToFileURL(path.join(dir, name)).href;
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);
    fs.writeFileSync(path.join(dir, 'empty.md'), '');
    expect(await fetchChangelog(at('CHANGELOG.md')), 'the file\'s text, as written').toBe(CHANGELOG);
    expect(await fetchChangelog(at('missing.md')), 'a missing file').toBe(null);
    expect(await fetchChangelog(at('empty.md')), 'an empty file').toBe(null);
  });

  test('a read that answers null reports nothing and carries the cursor forward', async () => {
    const world = mkWorld();
    board(world, '2.1.218');
    world.source = await refusedSource();
    const news = await collectIn(world);
    expect(news.matches.length, 'no news').toBe(0);
    expect(renderCcNews(news), 'no block').toBe('');
    expect(news.version, 'and the published line repeats the board\'s version rather than rewinding it').toBe('2.1.218');
    cleanup(world.home);
  });

  test('an empty or unparseable body skips too', async () => {
    const empty = mkWorld('');
    expect((await collectIn(empty)).version, 'an empty text has no version to carry').toBe(null);
    cleanup(empty.home);
    const junk = mkWorld('<html><body>404: Not Found</body></html>\n');
    expect((await collectIn(junk)).matches.length, 'and a page that is not a changelog has no releases').toBe(0);
    cleanup(junk.home);
  });

  test('a gh that refuses publishes no version line rather than re-seeding', async () => {
    // A board that could not be read is not an empty board. Seeding here would
    // move the cursor to latest on a run that reported nothing, and everything
    // the last good brief had yet to cover would be lost.
    const world = mkWorld();
    world.ghFail = new Error('gh: could not authenticate');
    const news = await collectIn(world);
    expect(news.since, 'no board, no since').toBe(null);
    expect(news.matches.length, 'so nothing is reported').toBe(0);
    expect(news.version, 'and no line publishes: the last brief\'s cursor stands').toBe(null);
    cleanup(world.home);
  });

  test('a board answer that is not the shape asked for is not a throw, and not a seed', async () => {
    const world = mkWorld();
    world.ghOut = '{ not json';
    const junk = await collectIn(world);
    expect(junk.since, 'nothing could be read').toBe(null);
    expect(junk.version, 'and a failed read publishes no cursor').toBe(null);
    cleanup(world.home);

    const hidden = mkWorld();
    hidden.ghOut = '{"data":{"repository":null}}';
    const unseen = await collectIn(hidden);
    expect(unseen.since, 'and so is a repo the token cannot see').toBe(null);
    expect(unseen.version, 'which is a failure too, not an empty board').toBe(null);
    cleanup(hidden.home);
  });

  test('an unreadable settings file reads as no home repo', async () => {
    const world = mkWorld();
    fs.writeFileSync(path.join(world.workflowHome, 'settings.json'), '{ not json');
    expect((await collectIn(world)).since, 'treated as never looked').toBe(null);
    expect(ghCalls(world).length, 'and nothing was asked of gh').toBe(0);
    cleanup(world.home);
  });
});
