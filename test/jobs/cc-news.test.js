// Tests for jobs/morning/brief/cc-news.js: the upstream Claude Code entries the
// morning brief carries, grouped by topic. Both reads go through the injected
// exec seam (`curl` a fixture CHANGELOG, `gh` a fixture board), so nothing
// here reaches the network or the real ~/.workkit.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, WORKKIT_DIR, mkTmp } = require('../lib/harness');

const { collectCcNews, renderCcNews, renderVersionMark, parseSections, topicOf } =
  require(path.join(__dirname, '..', '..', 'jobs', 'morning', 'brief', 'cc-news.js'));

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
 * `slug: null` writes no settings file: a machine with no home repo, which is
 * a board that cannot be read at all.
 */
const mkWorld = (text = CHANGELOG, { slug = SLUG } = {}) => {
  const home = mkTmp('cc-news-');
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
  test('every entry above the cursor rides, each carrying its version and topic', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const news = collectIn(world);
    expect(news.matches.length, 'both entries of the one newer release').toBe(2);
    expect(news.matches[0].version, 'the version each shipped in').toBe('2.1.220');
    expect(news.matches[0].topic, 'the hook entry files under hooks').toBe('hooks');
    expect(news.matches[1].topic, 'the terminal fix files under other, not dropped').toBe('other');
    expect(news.since, 'and the brief knows where it counted from').toBe('2.1.219');
    cleanup(world.home);
  });

  test('an older cursor reaches back across releases, housekeeping included', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    const news = collectIn(world);
    expect(news.matches.length, 'all five entries of the two newer releases').toBe(5);
    expect(news.matches.some((m) => /model picker/.test(m.entry)), 'the picker fix rides too: the digest judges, not the job').toBeTruthy();
    cleanup(world.home);
  });

  test('a cursor at the latest release reports nothing', () => {
    const world = mkWorld();
    board(world, '2.1.220');
    const news = collectIn(world);
    expect(news.matches.length, 'a quiet morning').toBe(0);
    expect(renderCcNews(news), 'and no block at all').toBe('');
    cleanup(world.home);
  });

  test('the block groups by topic, versions on every line', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    const block = renderCcNews(collectIn(world));
    expect(/^\n--- CC NEWS ---\n/.test(block), 'it is a labeled block').toBeTruthy();
    expect(/since 2\.1\.219, by topic:/.test(block), 'saying where it counted from').toBeTruthy();
    expect(/\[hooks\]\n2\.1\.220: Added a `DirectoryAdded` hook/.test(block), `entries sit under their topic: ${block}`).toBeTruthy();
    expect(/\[other\]\n2\.1\.220: Fixed copy-on-select/.test(block), `and other files last: ${block}`).toBeTruthy();
    expect(block.indexOf('[hooks]') < block.indexOf('[other]'), 'kit surfaces before the rest').toBeTruthy();
    cleanup(world.home);
  });
});

describe('jobs/cc-news: the cursor is the board', () => {
  test('the since is read off the latest published brief, over gh', () => {
    const world = mkWorld();
    board(world, '2.1.219');
    expect(collectIn(world).since, 'the line in the brief IS the cursor').toBe('2.1.219');
    const calls = ghCalls(world);
    expect(calls.length, `one board read: ${JSON.stringify(calls)}`).toBe(1);
    const argv = calls[0].join(' ');
    expect(/api graphql/.test(argv), 'through the GraphQL API').toBeTruthy();
    expect(argv.includes(`owner=${SLUG.split('/')[0]}`) && argv.includes(`name=${SLUG.split('/')[1]}`),
      `against the home repo the settings name: ${argv}`).toBeTruthy();
    expect(/discussions\(first:/.test(argv), 'asking for its discussions').toBeTruthy();
    cleanup(world.home);
  });

  test('the newest brief wins, and older ones are not consulted', () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: renderVersionMark('2.1.219') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.100') },
    ];
    expect(collectIn(world).since, 'the board is newest first and the first brief answers').toBe('2.1.219');
    cleanup(world.home);
  });

  test('a summary discussion is not a brief', () => {
    // The daily summaries share the board. Only a `brief: ` title is a cursor.
    const world = mkWorld();
    world.discussions = [
      { title: 'daily: 2026-07-29', body: renderVersionMark('2.1.100') },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.219') },
    ];
    expect(collectIn(world).since, 'the summary above it is passed over').toBe('2.1.219');
    cleanup(world.home);
  });

  test('a brief with no version line is passed over for one that has it', () => {
    const world = mkWorld();
    world.discussions = [
      { title: 'brief: 2026-07-29', body: 'HEADLINE: nothing to see.\n' },
      { title: 'brief: 2026-07-28', body: renderVersionMark('2.1.218') },
    ];
    expect(collectIn(world).since, 'the line is what makes a brief a cursor').toBe('2.1.218');
    cleanup(world.home);
  });

  test('a brief far down a busy board is still the cursor', () => {
    // Two posts a day share this board, and a morning whose send failed carries
    // no line at all. A narrow read window lets the last line-carrying brief
    // scroll out of view, which reads as an empty board and re-seeds the cursor,
    // every entry in between never reported.
    const world = mkWorld();
    const filler = Array.from({ length: 60 }, (_, i) => (
      { title: `daily: 2026-07-${i}`, body: 'a summary carries no cursor' }
    ));
    world.discussions = [...filler, { title: 'brief: 2026-06-01', body: renderVersionMark('2.1.218') }];
    const news = collectIn(world);
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
  test('an empty board is a first run: nothing reported, the latest carried', () => {
    const world = mkWorld();
    const news = collectIn(world);
    expect(news.since, 'nothing has ever been published').toBe(null);
    expect(news.matches.length, 'so the history is not dumped into the brief').toBe(0);
    expect(news.version, 'and the brief about to publish carries the latest').toBe('2.1.220');
    cleanup(world.home);
  });

  test('no home repo reads as a first run, and asks gh nothing', () => {
    const world = mkWorld(CHANGELOG, { slug: null });
    const news = collectIn(world);
    expect(news.since, 'there is no board to read').toBe(null);
    expect(ghCalls(world).length, 'so nothing was asked of it').toBe(0);
    expect(news.version, 'the version is still there to publish').toBe('2.1.220');
    cleanup(world.home);
  });

  test('the cursor never moves backwards', () => {
    const world = mkWorld();
    board(world, '2.2.0');
    const news = collectIn(world);
    expect(news.version, 'an older source does not rewind the cursor').toBe('2.2.0');
    cleanup(world.home);
  });
});

describe('jobs/cc-news: nothing on this machine records the cursor', () => {
  test('a pre-seeded ccNews key is left byte-identical', () => {
    // No migration: the stale key is the owner's to remove, and no runner is
    // allowed to read it, write it, or take it away.
    const world = mkWorld();
    board(world, '2.1.218');
    const before = JSON.stringify({ ccNews: { version: '1.0.0' }, homeCache: { [SLUG]: { repositoryId: 'R_1' } } });
    fs.writeFileSync(world.cacheFile, before);
    const news = collectIn(world);
    expect(news.since, 'the board answered, not the file').toBe('2.1.218');
    expect(fs.readFileSync(world.cacheFile, 'utf8'), 'and the file is untouched').toBe(before);
    cleanup(world.home);
  });
});

describe('jobs/cc-news: a failure is silent', () => {
  test('a fetch that throws reports nothing and carries the cursor forward', () => {
    const world = mkWorld();
    board(world, '2.1.218');
    world.fail = new Error('curl: (6) Could not resolve host');
    const news = collectIn(world);
    expect(news.matches.length, 'no news').toBe(0);
    expect(renderCcNews(news), 'no block').toBe('');
    expect(news.version, 'and the published line repeats the board\'s version rather than rewinding it').toBe('2.1.218');
    cleanup(world.home);
  });

  test('an empty or unparseable body skips too', () => {
    const empty = mkWorld('');
    expect(collectIn(empty).version, 'a non-200 curl -f prints nothing, and there is no version to carry').toBe(null);
    cleanup(empty.home);
    const junk = mkWorld('<html><body>404: Not Found</body></html>\n');
    expect(collectIn(junk).matches.length, 'and a page that is not a changelog has no releases').toBe(0);
    cleanup(junk.home);
  });

  test('a gh that refuses publishes no version line rather than re-seeding', () => {
    // A board that could not be read is not an empty board. Seeding here would
    // move the cursor to latest on a run that reported nothing, and everything
    // the last good brief had yet to cover would be lost.
    const world = mkWorld();
    world.ghFail = new Error('gh: could not authenticate');
    const news = collectIn(world);
    expect(news.since, 'no board, no since').toBe(null);
    expect(news.matches.length, 'so nothing is reported').toBe(0);
    expect(news.version, 'and no line publishes: the last brief\'s cursor stands').toBe(null);
    cleanup(world.home);
  });

  test('a board answer that is not the shape asked for is not a throw, and not a seed', () => {
    const world = mkWorld();
    world.ghOut = '{ not json';
    const junk = collectIn(world);
    expect(junk.since, 'nothing could be read').toBe(null);
    expect(junk.version, 'and a failed read publishes no cursor').toBe(null);
    cleanup(world.home);

    const hidden = mkWorld();
    hidden.ghOut = '{"data":{"repository":null}}';
    const unseen = collectIn(hidden);
    expect(unseen.since, 'and so is a repo the token cannot see').toBe(null);
    expect(unseen.version, 'which is a failure too, not an empty board').toBe(null);
    cleanup(hidden.home);
  });

  test('an unreadable settings file reads as no home repo', () => {
    const world = mkWorld();
    fs.writeFileSync(path.join(world.workflowHome, 'settings.json'), '{ not json');
    expect(collectIn(world).since, 'treated as never looked').toBe(null);
    expect(ghCalls(world).length, 'and nothing was asked of gh').toBe(0);
    cleanup(world.home);
  });
});
