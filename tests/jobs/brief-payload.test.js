//
// Tests for jobs/brief-payload.js — the payload the 9am job hands to Claude.
//
// The whole composition runs here against a fixture Repositories root: one
// real, opted-in git repo and one fake exec answering `gh` while passing `git`
// through to the real binary — the same seam the tower's server suite uses,
// because roster discovery and health ask git questions no stub answers
// honestly.
//
// Nothing here reaches the network, and nothing here runs Claude.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'brief-payload.js');
const { composeBrief, render, INSTRUCTION } = require(SCRIPT);

const SLUG = 'ITW-Creative-Works/fixture';
const STAMP = '2026-07-27T16:00:00.000Z';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'brief-payload-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// The upstream CHANGELOG the script reads, as a file on disk — the seam that
// keeps the news gather off the network. cc-news.test.js owns the parsing and
// filtering cases; this suite only asks whether the script wires it up.
const CC_CHANGELOG = '\n## 2.1.219\n\n- Added the `workflowSizeGuideline` settings key\n';

const ccFixture = (home) => {
  const file = path.join(home, 'cc-changelog.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# Changelog\n${CC_CHANGELOG}`);
  return file;
};

const issueNode = (number, labels) => ({
  number,
  title: `issue ${number}`,
  url: `https://github.com/${SLUG}/issues/${number}`,
  updatedAt: '2026-07-27T00:00:00Z',
  labels: { nodes: labels.map((name) => ({ name })) },
  assignees: { nodes: [] },
});

/**
 * A scratch Repositories root holding one opted-in repo with an origin, an
 * unreleased CHANGELOG entry, and an uncommitted file — plus the exec seam that
 * answers gh and lets git through.
 */
const mkWorld = () => {
  const root = mkTmp();
  const repo = path.join(root, 'repos', 'Owner', 'fixture');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'remote', 'add', 'origin', `git@github.com:${SLUG}.git`);
  fs.mkdirSync(path.join(repo, '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), JSON.stringify({ version: 7, enabled: true }));
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n- [#1](u) — One thing.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'initial');
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'uncommitted\n');

  const world = {
    root,
    repo,
    home: path.join(root, 'home'),
    board: {
      data: {
        r0: {
          issues: {
            totalCount: 2,
            nodes: [
              issueNode(17, ['status:specced', 'agent:ok']),
              issueNode(18, ['status:blocked', 'priority:high']),
            ],
          },
        },
      },
    },
    ghMissing: false,
  };
  fs.mkdirSync(world.home, { recursive: true });

  world.exec = (cmd, args) => {
    if (cmd === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (cmd === 'gh' && args[0] === '--version') {
      if (world.ghMissing) throw new Error('gh: command not found');
      return 'gh version 2.0.0\n';
    }
    if (cmd === 'gh' && args[0] === 'api') {
      if (world.boardError) throw world.boardError;
      return JSON.stringify(world.board);
    }
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  return world;
};

const composeIn = (world) => composeBrief({
  root: path.join(world.root, 'repos'),
  workflowHome: path.join(world.home, '.workkit'),
  home: world.home,
  generatedAt: STAMP,
  exec: world.exec,
});

const run = async () => {
  group('jobs/brief-payload: composition');

  await test('the fixture roster sweeps into a real brief', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.ok, true, 'the sweep answered');
    assertEq(out.generatedAt, STAMP, 'the stamp is the one passed in');
    assertEq(out.counts.open, 2, 'both open issues arrived');
    assertEq(out.waiting.length, 1, 'the blocked issue is waiting on the owner');
    assertEq(out.waiting[0].number, 18, 'that one');
    assertEq(out.ready.length, 1, 'the specced, unclaimed issue is ready');
    assert(/waiting on a decision/.test(out.headline), `the headline names it: ${out.headline}`);
    cleanup(world.root);
  });

  await test('per-repo health rides along as the work sitting on the table', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.warnings.length, 1, 'the one repo has work on the table');
    assertEq(out.warnings[0].repo, SLUG, 'named by its slug');
    assertEq(out.warnings[0].uncommitted, 1, 'the scratch file is uncommitted');
    assertEq(out.warnings[0].unreleased, 1, 'and the CHANGELOG entry is unreleased');
    cleanup(world.root);
  });

  await test('a declined repo leaves the roster, and the brief', () => {
    const world = mkWorld();
    fs.mkdirSync(path.join(world.home, '.workkit'), { recursive: true });
    fs.writeFileSync(path.join(world.home, '.workkit', 'settings.json'), JSON.stringify({
      version: 1,
      repos: { [world.repo]: 'declined' },
    }));
    const out = composeIn(world);
    assertEq(out.counts.open, 0, 'nothing is swept');
    assertEq(out.warnings.length, 0, 'and nothing is on the table');
    cleanup(world.root);
  });

  group('jobs/brief-payload: a failed morning is still a morning');

  await test('gh missing prints a failed sweep, not a quiet board', () => {
    const world = mkWorld();
    world.ghMissing = true;
    const out = composeIn(world);
    assertEq(out.ok, false, 'the brief is not ok');
    assertEq(out.reason, 'gh not found', 'and says why');
    assertEq(out.counts.open, 0, 'with no invented work');
    cleanup(world.root);
  });

  await test('a roster walk that throws is reported as one', () => {
    const out = composeBrief({
      root: '/nonexistent',
      generatedAt: STAMP,
      exec: () => { throw new Error('never called'); },
      // Discovery swallows an unreadable directory, so the throw has to come
      // from the argument itself — a getter is the one seam that reaches inside.
      get workflowHome() { throw new Error('the workflow home could not be read'); },
    });
    assertEq(out.ok, false, 'the brief is not ok');
    assert(/roster walk failed/.test(out.reason), `and names the walk: ${out.reason}`);
  });

  group('jobs/brief-payload: what is printed');

  await test('the rendered payload leads with the digest instruction', () => {
    const world = mkWorld();
    const text = render(composeIn(world));
    assert(text.startsWith(INSTRUCTION), 'the instruction is first, before anything else');
    assert(/MORNING KICKOFF/.test(text), 'the digest framing survives');
    assert(/the literal prefix "HEADLINE: "/.test(text), 'and fixes the first response line for the notification');
    cleanup(world.root);
  });

  await test('the payload after the instruction is readable JSON carrying the counts', () => {
    const world = mkWorld();
    const text = render(composeIn(world));
    const json = text.slice(INSTRUCTION.length);
    const parsed = JSON.parse(json);
    assertEq(parsed.counts.open, 2, 'the counts round-trip');
    assertEq(parsed.headline, composeIn(world).headline, 'so does the headline');
    assert(/\n  "counts": \{/.test(json), 'indented, not one line — a human reads this over a shoulder');
    cleanup(world.root);
  });

  await test('run as a script it prints a payload and exits 0', () => {
    // An empty HOME: the live machine's repos are none of this suite's business.
    // WORKKIT_CC_CHANGELOG points the news fetch at a fixture file, so the
    // script's one network read happens against the disk instead.
    const home = mkTmp();
    const res = spawnSync('node', [SCRIPT], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, HOME: home, WORKKIT_CC_CHANGELOG: `file://${ccFixture(home)}` },
    });
    cleanup(home);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.startsWith(INSTRUCTION), 'stdout leads with the instruction');
    const parsed = JSON.parse(res.stdout.slice(INSTRUCTION.length).split('--- CC NEWS ---')[0]);
    assert(typeof parsed.headline === 'string' && parsed.headline.length > 0, 'and carries a headline');
    assert(Array.isArray(parsed.waiting), 'and the sections');
  });

  group('jobs/brief-payload: the upstream news');

  await test('the instruction tells the digest what a CC NEWS block is', () => {
    assert(/--- CC NEWS ---/.test(INSTRUCTION), 'the payload description names the block');
    assert(/^CC NEWS: only when a CC NEWS block is present/m.test(INSTRUCTION), 'and the response shape has its line');
  });

  await test('a first run seeds the mark and prints no block; the next run prints one', () => {
    const home = mkTmp();
    const env = { ...process.env, HOME: home, WORKKIT_CC_CHANGELOG: `file://${ccFixture(home)}` };
    const first = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(first.status, 0, `exit 0 — stderr: ${first.stderr}`);
    // Past the instruction, which names the block it is explaining.
    assert(!/--- CC NEWS ---/.test(first.stdout.slice(INSTRUCTION.length)), 'the first morning does not dump the history');
    assertEq(
      JSON.parse(fs.readFileSync(path.join(home, '.workkit', 'cc-news.json'), 'utf8')).version,
      '2.1.219',
      'it recorded the latest instead',
    );

    fs.writeFileSync(ccFixture(home), `# Changelog\n\n## 2.1.220\n\n- Added a \`DirectoryAdded\` hook\n- Bug fixes\n${CC_CHANGELOG}`);
    const second = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(second.status, 0, `exit 0 — stderr: ${second.stderr}`);
    assert(/--- CC NEWS ---/.test(second.stdout.slice(INSTRUCTION.length)), 'the new release is flagged');
    assert(/\[hooks\]\n2\.1\.220 — Added a `DirectoryAdded` hook/.test(second.stdout), 'with the entry under its topic');
    assert(/\[other\]\n2\.1\.220 — Bug fixes/.test(second.stdout), 'and the housekeeping rides under other — the digest judges, not the job');
    cleanup(home);
  });

  await test('a manual run reports the news but leaves the mark where it is', () => {
    // `claude-daily.sh --now` exists for testing the brief; consuming the news
    // there would mean the 9am job never reports it.
    const home = mkTmp();
    const env = { ...process.env, HOME: home, WORKKIT_CC_CHANGELOG: `file://${ccFixture(home)}` };
    const markFile = path.join(home, '.workkit', 'cc-news.json');
    spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    fs.writeFileSync(ccFixture(home), `# Changelog\n\n## 2.1.220\n\n- Added a \`DirectoryAdded\` hook\n${CC_CHANGELOG}`);

    const manual = spawnSync('node', [SCRIPT], {
      encoding: 'utf8', timeout: 60000, env: { ...env, WORKKIT_BRIEF_MANUAL: '1' },
    });
    assertEq(manual.status, 0, `exit 0 — stderr: ${manual.stderr}`);
    assert(/--- CC NEWS ---/.test(manual.stdout.slice(INSTRUCTION.length)), 'the manual run still sees the news');
    assertEq(
      JSON.parse(fs.readFileSync(markFile, 'utf8')).version, '2.1.219',
      'and the mark is untouched',
    );

    spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(
      JSON.parse(fs.readFileSync(markFile, 'utf8')).version, '2.1.220',
      'the scheduled run still advances it',
    );
    cleanup(home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
