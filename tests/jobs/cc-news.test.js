//
// Tests for jobs/cc-news.js — the upstream Claude Code entries the morning
// brief carries, grouped by topic.
//
// The fetch is the injected exec seam answering with a fixture CHANGELOG, and
// the mark file lives in a scratch workflow home, so nothing here reaches the
// network or touches the real ~/.workkit.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR } = require('../lib/harness');

const { collectCcNews, renderCcNews, parseSections, topicOf, compareVersions } =
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

/** A world: a scratch workflow home plus an exec seam serving the fixture. */
const mkWorld = (text = CHANGELOG) => {
  const home = mkTmp();
  const world = {
    home,
    workflowHome: path.join(home, WORKKIT_DIR),
    cacheFile: path.join(home, WORKKIT_DIR, '.cache.json'),
    calls: [],
    text,
    fail: null,
  };
  world.exec = (cmd, args) => {
    world.calls.push([cmd, ...args]);
    if (world.fail) throw world.fail;
    return world.text;
  };
  return world;
};

const collectIn = (world) => collectCcNews({
  workflowHome: world.workflowHome,
  source: 'file:///fixture/CHANGELOG.md',
  exec: world.exec,
});

// The cursor is one key in the machine's disposable cache file (issue #80), so
// seeding and reading it both go through that key rather than the whole file.
const seed = (world, version, rest = {}) => {
  fs.mkdirSync(path.dirname(world.cacheFile), { recursive: true });
  fs.writeFileSync(world.cacheFile, JSON.stringify({ ...rest, ccNews: { version } }));
};

const readCache = (world) => JSON.parse(fs.readFileSync(world.cacheFile, 'utf8'));
const mark = (world) => readCache(world).ccNews.version;

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

  group('jobs/cc-news: what is newer than the mark');

  await test('every entry above the mark rides, each carrying its version and topic', () => {
    const world = mkWorld();
    seed(world, '2.1.219');
    const news = collectIn(world);
    assertEq(news.matches.length, 2, 'both entries of the one newer release');
    assertEq(news.matches[0].version, '2.1.220', 'the version each shipped in');
    assertEq(news.matches[0].topic, 'hooks', 'the hook entry files under hooks');
    assertEq(news.matches[1].topic, 'other', 'the terminal fix files under other, not dropped');
    assertEq(news.since, '2.1.219', 'and the brief knows where it counted from');
    cleanup(world.home);
  });

  await test('an older mark reaches back across releases, housekeeping included', () => {
    const world = mkWorld();
    seed(world, '2.1.218');
    const news = collectIn(world);
    assertEq(news.matches.length, 5, 'all five entries of the two newer releases');
    assert(news.matches.some((m) => /model picker/.test(m.entry)), 'the picker fix rides too — the digest judges, not the job');
    cleanup(world.home);
  });

  await test('a mark at the latest release reports nothing', () => {
    const world = mkWorld();
    seed(world, '2.1.220');
    const news = collectIn(world);
    assertEq(news.matches.length, 0, 'a quiet morning');
    assertEq(renderCcNews(news), '', 'and no block at all');
    cleanup(world.home);
  });

  await test('the block groups by topic, versions on every line', () => {
    const world = mkWorld();
    seed(world, '2.1.219');
    const block = renderCcNews(collectIn(world));
    assert(/^\n--- CC NEWS ---\n/.test(block), 'it is a labeled block');
    assert(/since 2\.1\.219, by topic:/.test(block), 'saying where it counted from');
    assert(/\[hooks\]\n2\.1\.220 — Added a `DirectoryAdded` hook/.test(block), `entries sit under their topic: ${block}`);
    assert(/\[other\]\n2\.1\.220 — Fixed copy-on-select/.test(block), `and other files last: ${block}`);
    assert(block.indexOf('[hooks]') < block.indexOf('[other]'), 'kit surfaces before the rest');
    cleanup(world.home);
  });

  group('jobs/cc-news: the mark');

  await test('a first run seeds the latest version and reports nothing', () => {
    const world = mkWorld();
    const news = collectIn(world);
    assertEq(news.since, null, 'this machine had never looked');
    assertEq(news.matches.length, 0, 'so the history is not dumped into the brief');
    news.commit();
    assertEq(mark(world), '2.1.220', 'the mark is the latest');
    cleanup(world.home);
  });

  await test('the mark advances only when the caller commits', () => {
    const world = mkWorld();
    seed(world, '2.1.218');
    const news = collectIn(world);
    assertEq(mark(world), '2.1.218', 'gathering moved nothing');
    news.commit();
    assertEq(mark(world), '2.1.220', 'committing did');
    // The next morning repeats nothing.
    assertEq(collectIn(world).matches.length, 0, 'and the news is not reported twice');
    cleanup(world.home);
  });

  await test('a run that never commits repeats the same news tomorrow', () => {
    const world = mkWorld();
    seed(world, '2.1.218');
    assertEq(collectIn(world).matches.length, 5, 'the morning that died');
    assertEq(collectIn(world).matches.length, 5, 'reports the same five the next day');
    cleanup(world.home);
  });

  await test('the mark never moves backwards', () => {
    const world = mkWorld();
    seed(world, '2.2.0');
    const news = collectIn(world);
    assertEq(news.version, '2.2.0', 'an older source does not rewind the mark');
    news.commit();
    assertEq(mark(world), '2.2.0', 'as written');
    cleanup(world.home);
  });

  group('jobs/cc-news: where the mark lives');

  await test('the mark lands in the machine\'s cache file, created when missing', () => {
    const world = mkWorld();
    assert(!fs.existsSync(world.workflowHome), 'nothing exists yet');
    collectIn(world).commit();
    assertEq(path.basename(world.cacheFile), '.cache.json', 'the disposable file, never the hand-edited one');
    assertEq(mark(world), '2.1.220', 'and the cursor is in it');
    cleanup(world.home);
  });

  await test('committing keeps the other keys in the cache file', () => {
    // The Discussions id cache shares this file, and a morning runs both steps:
    // a plain write of the cursor would take the ids away with it.
    const world = mkWorld();
    seed(world, '2.1.218', { homeCache: { 'owner/workkit': { repositoryId: 'R_1' } } });
    collectIn(world).commit();
    assertEq(mark(world), '2.1.220', 'the cursor advanced');
    assertEq(readCache(world).homeCache['owner/workkit'].repositoryId, 'R_1', 'and the ids beside it survived');
    cleanup(world.home);
  });

  group('jobs/cc-news: a failure is silent');

  await test('a fetch that throws skips, leaving the mark alone', () => {
    const world = mkWorld();
    seed(world, '2.1.218');
    world.fail = new Error('curl: (6) Could not resolve host');
    assertEq(collectIn(world), null, 'no news');
    assertEq(renderCcNews(null), '', 'no block');
    assertEq(mark(world), '2.1.218', 'the mark is untouched');
    cleanup(world.home);
  });

  await test('an empty or unparseable body skips too', () => {
    const empty = mkWorld('');
    assertEq(collectIn(empty), null, 'a non-200 curl -f prints nothing');
    cleanup(empty.home);
    const junk = mkWorld('<html><body>404: Not Found</body></html>\n');
    assertEq(collectIn(junk), null, 'and a page that is not a changelog has no releases');
    cleanup(junk.home);
  });

  await test('a mark that cannot be written does not throw — the run repeats tomorrow', () => {
    const world = mkWorld();
    seed(world, '2.1.218');
    const news = collectIn(world);
    fs.chmodSync(world.cacheFile, 0o444);
    try {
      news.commit();
    } finally {
      fs.chmodSync(world.cacheFile, 0o644);
    }
    assertEq(mark(world), '2.1.218', 'the mark held');
    assertEq(collectIn(world).matches.length, 5, 'and the news repeats rather than vetoing the brief');
    cleanup(world.home);
  });

  await test('an unreadable mark file reads as a first run rather than throwing', () => {
    const world = mkWorld();
    fs.mkdirSync(path.dirname(world.cacheFile), { recursive: true });
    fs.writeFileSync(world.cacheFile, '{ not json');
    const news = collectIn(world);
    assertEq(news.since, null, 'treated as never looked');
    assertEq(news.matches.length, 0, 'so it seeds instead of dumping');
    cleanup(world.home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
