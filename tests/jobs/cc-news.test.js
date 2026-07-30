//
// Tests for jobs/cc-news.js — the upstream Claude Code entries the morning
// brief carries, grouped by topic.
//
// BOTH reads are the injected exec seam: `curl` answers with a fixture
// CHANGELOG, `gh` answers with a fixture board of published briefs. The home
// repo is named in a scratch workflow home, so nothing here reaches the network
// or touches the real ~/.workkit.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR } = require('../lib/harness');

const { collectCcNews, renderCcNews, renderVersionMark, parseSections, topicOf, compareVersions } =
  require(path.join(__dirname, '..', '..', 'jobs', 'cc-news.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-news-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

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
 * A world: a scratch workflow home naming a home repo, plus an exec seam that
 * answers `curl` with the fixture CHANGELOG and `gh` with the fixture board.
 *
 * `slug: null` writes no settings file — a machine with no home repo, which is
 * a board that cannot be read at all.
 */
const mkWorld = (text = CHANGELOG, { slug = SLUG } = {}) => {
  const home = mkTmp();
  const world = {
    home,
    workflowHome: path.join(home, WORKKIT_DIR),
    cacheFile: path.join(home, WORKKIT_DIR, '.cache.json'),
    calls: [],
    text,
    fail: null,        // the curl read throws
    ghFail: null,      // the board read throws
    ghOut: null,       // raw board stdout, for the answers jq would not parse
    discussions: [],   // what the home repo carries, newest first
  };
  world.exec = (cmd, args) => {
    world.calls.push([cmd, ...args]);
    if (cmd === 'gh') {
      if (world.ghFail) throw world.ghFail;
      if (world.ghOut !== null) return world.ghOut;
      return JSON.stringify({ data: { repository: { discussions: { nodes: world.discussions } } } });
    }
    if (world.fail) throw world.fail;
    return world.text;
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

const collectIn = (world) => collectCcNews({
  workflowHome: world.workflowHome,
  source: 'file:///fixture/CHANGELOG.md',
  exec: world.exec,
});

// The cursor is a line in the latest published brief (issue #86), so seeding it
// means putting a brief on the board.
const board = (world, version) => {
  world.discussions = [{
    title: 'brief: 2026-07-29',
    body: `HEADLINE: yesterday happened.\nIN FLIGHT: nothing.\n\n${renderVersionMark(version)}\n`,
  }];
};

const ghCalls = (world) => world.calls.filter(([cmd]) => cmd === 'gh');

const run = async () => {
  group('jobs/cc-news: parsing');

  await test('the release sections and their entries come out in file order', () => {
    const sections = parseSections(CHANGELOG);
    assertEq(sections.length, 3, 'three releases');
    assertEq(sections[0].version, '2.1.220', 'newest first, as published');
    assertEq(sections[0].entries.length, 2, 'with its entries');
    assertEq(sections[2].entries[0], 'Bug fixes and reliability improvements', 'text without the bullet');
  });

  await test('a heading that is not a version carries no entries', () => {
    const sections = parseSections('# Changelog\n\n- not a release\n\n## [Unreleased]\n\n- nor this\n');
    assertEq(sections.length, 0, 'nothing is a release');
  });

  await test('versions compare numerically, not as strings', () => {
    assert(compareVersions('2.1.220', '2.1.99') > 0, '220 is newer than 99');
    assert(compareVersions('2.1.9', '2.2.0') < 0, 'the minor wins');
    assertEq(compareVersions('2.1.220', '2.1.220'), 0, 'equal is equal');
  });

  group('jobs/cc-news: the topic map');

  await test('entries file under the kit surface they name', () => {
    assertEq(topicOf('Added a `DirectoryAdded` hook that fires mid-session'), 'hooks', 'hooks');
    assertEq(topicOf('Added the `workflowSizeGuideline` settings key'), 'settings', 'settings');
    assertEq(topicOf('Added HTTP status text to `claude mcp list` and MCP errors'), 'MCP', 'MCP');
    assertEq(topicOf('Added the workflow size to the running status line'), 'statusline', 'statusline');
    assertEq(topicOf('Set CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1 to disable nesting'), 'settings', 'env vars are settings');
    assertEq(topicOf('Updated the claude-api skill to default to Opus 5'), 'skills', 'skills');
    assertEq(topicOf('Fixed a plugin marketplace refresh'), 'plugins', 'plugins');
    assertEq(topicOf('Raised the subagent spawn depth ceiling'), 'agents', 'agents');
  });

  await test('everything else files under other — a bucket, never dropped', () => {
    assertEq(topicOf('Bug fixes and reliability improvements'), 'other', 'housekeeping');
    assertEq(topicOf('Fixed multi-line paste collapsing into one line'), 'other', 'paste');
  });


  group('jobs/cc-news: what is newer than the cursor');

  await test('every entry above the cursor rides, each carrying its version and topic', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const news = collectIn(world);
    assertEq(news.matches.length, 2, 'both entries of the one newer release');
    assertEq(news.matches[0].version, '2.1.220', 'the version each shipped in');
    assertEq(news.matches[0].topic, 'hooks', 'the hook entry files under hooks');
    assertEq(news.matches[1].topic, 'other', 'the terminal fix files under other, not dropped');
    assertEq(news.since, '2.1.219', 'and the brief knows where it counted from');
    cleanup(world.home);
  });

  await test('an older cursor reaches back across releases, housekeeping included', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    const news = collectIn(world);
    assertEq(news.matches.length, 5, 'all five entries of the two newer releases');
    assert(news.matches.some((m) => /model picker/.test(m.entry)), 'the picker fix rides too — the digest judges, not the job');
    cleanup(world.home);
  });

  await test('a cursor at the latest release reports nothing', () => {
    const world = mkWorld();
    board(world, '2.1.220');
    const news = collectIn(world);
    assertEq(news.matches.length, 0, 'a quiet morning');
    assertEq(renderCcNews(news), '', 'and no block at all');
    cleanup(world.home);
  });

  await test('the block groups by topic, versions on every line', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const block = renderCcNews(collectIn(world));
    assert(/^\n--- CC NEWS ---\n/.test(block), 'it is a labeled block');
    assert(/since 2\.1\.219, by topic:/.test(block), 'saying where it counted from');
    assert(/\[hooks\]\n2\.1\.220 — Added a `DirectoryAdded` hook/.test(block), `entries sit under their topic: ${block}`);
    assert(/\[other\]\n2\.1\.220 — Fixed copy-on-select/.test(block), `and other files last: ${block}`);
    assert(block.indexOf('[hooks]') < block.indexOf('[other]'), 'kit surfaces before the rest');
    cleanup(world.home);
  });

  group('jobs/cc-news: the cursor is the board');

  await test('the since is read off the latest published brief, over gh', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    assertEq(collectIn(world).since, '2.1.219', 'the line in the brief IS the cursor');
    const calls = ghCalls(world);
    assertEq(calls.length, 1, `one board read: ${JSON.stringify(calls)}`);
    const argv = calls[0].join(' ');
    assert(/api graphql/.test(argv), 'through the GraphQL API');
    assert(argv.includes(`owner=${SLUG.split('/')[0]}`) && argv.includes(`name=${SLUG.split('/')[1]}`),
      `against the home repo the settings name: ${argv}`);
    assert(/discussions\(first:/.test(argv), 'asking for its discussions');
    cleanup(world.home);
  });

  await test('the newest brief wins, and older ones are not consulted', () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: renderVersionMark('2.1.219') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.100') },
    ];
    assertEq(collectIn(world).since, '2.1.219', 'the board is newest first and the first brief answers');
    cleanup(world.home);
  });

  await test('a summary discussion is not a brief', () => {
    // The daily summaries share the board. Only a `brief: ` title is a cursor.
    const world = mkWorld();
    world.discussions = [
      { title: 'daily: 2026-07-29', body: renderVersionMark('2.1.100') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.219') },
    ];
    assertEq(collectIn(world).since, '2.1.219', 'the summary above it is passed over');
    cleanup(world.home);
  });

  await test('a brief with no version line is passed over for one that has it', () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: 'HEADLINE: nothing to see.\n' },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.218') },
    ];
    assertEq(collectIn(world).since, '2.1.218', 'the line is what makes a brief a cursor');
    cleanup(world.home);
  });

  await test('a brief far down a busy board is still the cursor', () => {
    // Two posts a day share this board, and a morning whose send failed carries
    // no line at all. A narrow read window lets the last line-carrying brief
    // scroll out of view, which reads as an empty board and re-seeds the cursor
    // — every entry in between never reported.
    const world = mkWorld();
    const filler = Array.from({ length: 60 }, (_, i) => (
      { title: `daily: 2026-07-${i}`, body: 'a summary carries no cursor' }
    ));
    world.discussions = [...filler, { title: 'brief: 2026-06-01', body: renderVersionMark('2.1.218') }];
    const news = collectIn(world);
    assertEq(news.since, '2.1.218', 'sixty posts deep is still inside the window');
    assertEq(news.matches.length, 5, 'so the entries in between are reported rather than seeded past');
    assert(/discussions\(first:100/.test(ghCalls(world)[0].join(' ')), 'the window is the GraphQL maximum');
    cleanup(world.home);
  });

  await test('the version line is the shape the runner publishes', () => {
    assertEq(renderVersionMark('2.1.220'), '<!-- cc-news: 2.1.220 -->', 'greppable, and invisible when rendered');
  });

  group('jobs/cc-news: a first run seeds, it does not report');

  await test('an empty board is a first run — nothing reported, the latest carried', () => {
    const world = mkWorld();
    const news = collectIn(world);
    assertEq(news.since, null, 'nothing has ever been published');
    assertEq(news.matches.length, 0, 'so the history is not dumped into the brief');
    assertEq(news.version, '2.1.220', 'and the brief about to publish carries the latest');
    cleanup(world.home);
  });

  await test('no home repo reads as a first run, and asks gh nothing', () => {
    const world = mkWorld(CHANGELOG, { slug: null });
    const news = collectIn(world);
    assertEq(news.since, null, 'there is no board to read');
    assertEq(ghCalls(world).length, 0, 'so nothing was asked of it');
    assertEq(news.version, '2.1.220', 'the version is still there to publish');
    cleanup(world.home);
  });

  await test('the cursor never moves backwards', () => {
    const world = mkWorld();
    board(world, '2.2.0');
    const news = collectIn(world);
    assertEq(news.version, '2.2.0', 'an older source does not rewind the cursor');
    cleanup(world.home);
  });

  group('jobs/cc-news: nothing on this machine records the cursor');

  await test('a run writes no cache file at all', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    collectIn(world);
    assert(!fs.existsSync(world.cacheFile), 'the disposable cache is not this module\'s home any more');
    cleanup(world.home);
  });

  await test('a pre-seeded ccNews key is left byte-identical', () => {
    // No migration: the stale key is the owner's to remove, and no runner is
    // allowed to read it, write it, or take it away.
    const world = mkWorld();
    board(world, '2.1.218');
    const before = JSON.stringify({ ccNews: { version: '1.0.0' }, homeCache: { [SLUG]: { repositoryId: 'R_1' } } });
    fs.writeFileSync(world.cacheFile, before);
    const news = collectIn(world);
    assertEq(news.since, '2.1.218', 'the board answered, not the file');
    assertEq(fs.readFileSync(world.cacheFile, 'utf8'), before, 'and the file is untouched');
    cleanup(world.home);
  });

  await test('there is no commit callback to call', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    assertEq(typeof collectIn(world).commit, 'undefined', 'the publish IS the commit — no function pretends to persist');
    cleanup(world.home);
  });

  group('jobs/cc-news: a failure is silent');

  await test('a fetch that throws reports nothing and carries the cursor forward', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    world.fail = new Error('curl: (6) Could not resolve host');
    const news = collectIn(world);
    assertEq(news.matches.length, 0, 'no news');
    assertEq(renderCcNews(news), '', 'no block');
    assertEq(news.version, '2.1.218', 'and the published line repeats the board\'s version rather than rewinding it');
    cleanup(world.home);
  });

  await test('an empty or unparseable body skips too', () => {
    const empty = mkWorld('');
    assertEq(collectIn(empty).version, null, 'a non-200 curl -f prints nothing, and there is no version to carry');
    cleanup(empty.home);
    const junk = mkWorld('<html><body>404: Not Found</body></html>\n');
    assertEq(collectIn(junk).matches.length, 0, 'and a page that is not a changelog has no releases');
    cleanup(junk.home);
  });

  await test('a gh that refuses publishes no version line rather than re-seeding', () => {
    // A board that could not be read is not an empty board. Seeding here would
    // move the cursor to latest on a run that reported nothing, and everything
    // the last good brief had yet to cover would be lost.
    const world = mkWorld();
    world.ghFail = new Error('gh: could not authenticate');
    const news = collectIn(world);
    assertEq(news.since, null, 'no board, no since');
    assertEq(news.matches.length, 0, 'so nothing is reported');
    assertEq(news.version, null, 'and no line publishes — the last brief\'s cursor stands');
    cleanup(world.home);
  });

  await test('a board answer that is not the shape asked for is not a throw, and not a seed', () => {
    const world = mkWorld();
    world.ghOut = '{ not json';
    const junk = collectIn(world);
    assertEq(junk.since, null, 'nothing could be read');
    assertEq(junk.version, null, 'and a failed read publishes no cursor');
    cleanup(world.home);

    const hidden = mkWorld();
    hidden.ghOut = '{"data":{"repository":null}}';
    const unseen = collectIn(hidden);
    assertEq(unseen.since, null, 'and so is a repo the token cannot see');
    assertEq(unseen.version, null, 'which is a failure too, not an empty board');
    cleanup(hidden.home);
  });

  await test('an unreadable settings file reads as no home repo', () => {
    const world = mkWorld();
    fs.writeFileSync(path.join(world.workflowHome, 'settings.json'), '{ not json');
    assertEq(collectIn(world).since, null, 'treated as never looked');
    assertEq(ghCalls(world).length, 0, 'and nothing was asked of gh');
    cleanup(world.home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
