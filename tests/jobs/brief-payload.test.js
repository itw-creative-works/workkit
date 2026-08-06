//
// Tests for jobs/brief-payload.js — the payload the 9am job hands to Claude.
//
// The whole composition runs here against a fixture roster: one
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
const { composeBrief, render, writeBriefMarks, INSTRUCTION } = require(SCRIPT);
const { parseStatsMark } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'history.js'));

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

/**
 * A world for the news path: a scratch HOME naming a home repo, a `gh` shim
 * that answers the board read out of a file this suite rewrites, the CHANGELOG
 * on disk, and the scratch mark file the runner would name. Nothing here
 * reaches GitHub — the shim is first on PATH and never calls out.
 */
const mkNewsWorld = () => {
  const home = mkTmp();
  const bin = path.join(home, 'bin');
  const boardFile = path.join(home, 'board.json');
  const markFile = path.join(home, 'cc-version');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.workkit', 'settings.json'),
    JSON.stringify({ version: 1, site: { repo: 'owner/private-home', publish: false, url: null } }),
  );

  const setBoard = (nodes) => fs.writeFileSync(
    boardFile,
    JSON.stringify({ data: { repository: { discussions: { nodes } } } }),
  );
  setBoard([]);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env bash\ncat ${JSON.stringify(boardFile)}\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  return {
    home,
    ccFile: ccFixture(home),
    /** What the last run handed the runner to append to the published brief. */
    mark: () => (fs.existsSync(markFile) ? fs.readFileSync(markFile, 'utf8') : ''),
    /** The brief the runner would have posted, now on the board. */
    publish: (version) => setBoard([{
      title: 'brief: 2026-07-29',
      body: `HEADLINE: yesterday happened.\n\n<!-- cc-news: ${version} -->\n`,
    }]),
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      WORKKIT_CC_CHANGELOG: `file://${ccFixture(home)}`,
      WORKKIT_BRIEF_MARK_FILE: markFile,
    },
  };
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
 * One opted-in repo with an origin, an unreleased CHANGELOG entry, and an
 * uncommitted file, registered in a scratch ~/.workkit roster — plus the exec
 * seam that answers gh and lets git through.
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

  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.workkit', '.repos.json'),
    JSON.stringify({ version: 1, repos: { [repo]: 'enabled' } }, null, 2),
  );

  const world = {
    root,
    repo,
    home,
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
    // The home repo's Discussions, as the summaries read finds them. Empty until
    // a test publishes something, and unreachable only when it says so.
    discussions: [],
  };
  fs.mkdirSync(world.home, { recursive: true });

  world.exec = (cmd, args) => {
    if (cmd === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (cmd === 'gh' && args[0] === '--version') {
      if (world.ghMissing) throw new Error('gh: command not found');
      return 'gh version 2.0.0\n';
    }
    if (cmd === 'gh' && args[0] === 'api') {
      // The two GraphQL reads a morning makes, told apart by the query itself:
      // the board sweep, and the summaries published on the home repo.
      if (args.join(' ').includes('discussions(first')) {
        if (world.discussionsError) throw world.discussionsError;
        return JSON.stringify({ data: { repository: { discussions: { nodes: world.discussions } } } });
      }
      if (world.boardError) throw world.boardError;
      return JSON.stringify(world.board);
    }
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  return world;
};

// What the run wrote to stderr while `fn` ran. The line the composer prints
// about unreadable repos goes there and nowhere else, so this is the only place
// to read it back.
const captureStderr = (fn) => {
  const original = process.stderr.write.bind(process.stderr);
  let text = '';
  process.stderr.write = (chunk) => { text += chunk; return true; };
  try { fn(); } finally { process.stderr.write = original; }
  return text;
};

const composeIn = (world, generatedAt = STAMP) => composeBrief({
  workflowHome: path.join(world.home, '.workkit'),
  home: world.home,
  generatedAt,
  exec: world.exec,
});

// The machine's hand-edited settings, naming the home repo the summaries are
// published on. A world without one is a machine that has no board at all.
const nameHomeRepo = (world, repo = 'owner/private-home') => fs.writeFileSync(
  path.join(world.home, '.workkit', 'settings.json'),
  JSON.stringify({ version: 1, site: { repo, publish: false, url: null } }),
);

const discussion = (title, day) => ({
  title,
  url: `https://github.com/owner/private-home/discussions/${title.replace(/\W+/g, '')}`,
  createdAt: `${day}T09:00:00Z`,
});

// Local noon, so the weekday is the same one wherever this suite runs.
const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
const MONDAY = localNoon(2026, 8, 3);
const TUESDAY = localNoon(2026, 8, 4);

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
    fs.writeFileSync(path.join(world.home, '.workkit', '.repos.json'), JSON.stringify({
      version: 1,
      repos: { [world.repo]: 'declined' },
    }));
    const out = composeIn(world);
    assertEq(out.counts.open, 0, 'nothing is swept');
    assertEq(out.warnings.length, 0, 'and nothing is on the table');
    cleanup(world.root);
  });

  await test('what to work on next rides through the whole composition', () => {
    const world = mkWorld();
    const out = composeIn(world);
    assertEq(out.nextUp.length, 1, 'the one repo has actionable work');
    assertEq(out.nextUp[0].repo, SLUG, 'named by its slug');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '18,17',
      'the decision waiting on the owner leads, then the accepted spec');
    cleanup(world.root);
  });

  await test('a built item waiting on the owner is its own section, and ranks above the specs', () => {
    // Issue #135: `status:qa` is the park a built item sits in until the owner
    // checks it. The composed payload carries it exactly as the tower's does —
    // its own bucket and count, and actionable in nextUp under the decisions.
    const world = mkWorld();
    world.board.data.r0.issues.totalCount = 3;
    world.board.data.r0.issues.nodes.push(issueNode(19, ['status:qa']));
    const out = composeIn(world);
    assertEq(out.qa.map((i) => i.number).join(','), '19', 'the parked item is the qa section');
    assertEq(out.counts.qa, 1, 'and its own count');
    assertEq(out.inFlight.length, 0, 'never counted as work somebody is still on');
    assertEq(out.nextUp[0].items.map((i) => i.number).join(','), '18,19,17',
      'the decision, then the check the owner owes, then the accepted spec');
    cleanup(world.root);
  });

  group('jobs/brief-payload: yesterday and the week');

  await test('the newest daily summary is the findings, every morning', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [
      discussion('brief: 2026-08-03', '2026-08-03'),
      discussion('daily: 2026-08-02', '2026-08-02'),
      discussion('weekly: 2026-08-02', '2026-08-02'),
    ];
    const out = composeIn(world, TUESDAY);
    assertEq(out.findings.title, 'daily: 2026-08-02', 'what yesterday produced, said by the artifact that recorded it');
    assert(out.findings.url.includes('/discussions/'), `and its link: ${out.findings.url}`);
    assert(!('week' in out), 'and a Tuesday carries no rollup at all');
    cleanup(world.root);
  });

  await test('Monday, and only Monday, also carries the week', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussions = [discussion('daily: 2026-08-02', '2026-08-02'), discussion('weekly: 2026-08-02', '2026-08-02')];
    const monday = composeIn(world, MONDAY);
    assertEq(monday.week.title, 'weekly: 2026-08-02', 'one brief a day, richer on a Monday');
    assertEq(monday.findings.title, 'daily: 2026-08-02', 'beside the day before');
    assert(!('week' in composeIn(world, TUESDAY)), 'the day after asks for no rollup');
    cleanup(world.root);
  });

  await test('unreachable Discussions still compose a brief, and the gap is named', () => {
    const world = mkWorld();
    nameHomeRepo(world);
    world.discussionsError = new Error('gh: not authenticated');
    let out;
    const stderr = captureStderr(() => { out = composeIn(world, MONDAY); });
    assertEq(out.ok, true, 'the morning is not lost to a summary nobody could read');
    assertEq(out.counts.open, 2, 'and the board is all there');
    assertEq(out.findings, null, 'the key says there was nothing to read');
    assertEq(out.week, null, 'and so does the rollup');
    assert(/^brief: no daily summary could be read from owner\/private-home$/m.test(stderr), `the skip is named: ${JSON.stringify(stderr)}`);
    assert(/^brief: it is Monday and no weekly rollup could be read from owner\/private-home$/m.test(stderr), `both of them: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a machine with no home repo says nothing about summaries', () => {
    // It has no board to have read — a fact about the machine, not a gap in
    // this morning, and a line every day would be noise.
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world, MONDAY));
    assertEq(stderr, '', `nothing is said: ${JSON.stringify(stderr)}`);
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

  await test('a repo the sweep could not read is named on stderr', () => {
    // The shape a short token scope takes: the board answers, ok stays true, and
    // the repo it could not read is a per-repo error the payload never carries.
    const world = mkWorld();
    world.board = {
      data: { r0: null },
      errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve to a Repository' }],
    };
    let out;
    const stderr = captureStderr(() => { out = composeIn(world); });
    assertEq(out.ok, true, 'the sweep itself answered — this is not a failed morning');
    assertEq(stderr, `brief: 1 repos unreadable: ${SLUG}\n`, `the gap is said out loud: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a clean sweep says nothing', () => {
    const world = mkWorld();
    const stderr = captureStderr(() => composeIn(world));
    assertEq(stderr, '', `no line when every repo answered: ${JSON.stringify(stderr)}`);
    cleanup(world.root);
  });

  await test('a roster read that throws is reported as one', () => {
    const out = composeBrief({
      generatedAt: STAMP,
      exec: () => { throw new Error('never called'); },
      // The read swallows an unreadable file, so the throw has to come from
      // the argument itself — a getter is the one seam that reaches inside.
      get workflowHome() { throw new Error('the workflow home could not be read'); },
    });
    assertEq(out.ok, false, 'the brief is not ok');
    assert(/roster read failed/.test(out.reason), `and names the read: ${out.reason}`);
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

  await test('the instruction describes the new keys and gives each one a section', () => {
    assert(/`nextUp` is the same board asked one question further/.test(INSTRUCTION), 'the payload description explains nextUp');
    assert(/`qa` is built and verified and waiting on the\nowner's check/.test(INSTRUCTION), 'the payload description explains qa (#135)');
    assert(/^WAITING ON YOUR CHECK: every issue in `qa`/m.test(INSTRUCTION), 'and the response shape has its section');
    assert(/`findings` is the newest daily summary/.test(INSTRUCTION), 'and the findings');
    assert(/`week` is the weekly rollup, which rides on Mondays/.test(INSTRUCTION), 'and when the week rides');
    assert(/^WORK ON THIS NEXT: `nextUp`/m.test(INSTRUCTION), 'the response shape has its ranked list');
    assert(/waits on/.test(INSTRUCTION), 'and the digest is told to say what an item waits on (#103)');
    assert(/^YESTERDAY: one line/m.test(INSTRUCTION), 'a line for what yesterday produced');
    assert(/^THE WEEK: one line/m.test(INSTRUCTION), 'and one for the week');
    // Each omit clause is looked for inside its OWN section: the instruction is
    // split at every labeled header, so a section that lost the clause fails
    // here instead of matching the next section's copy of it further down.
    const chunks = INSTRUCTION.split(/\n(?=[A-Z][A-Z' 0-9]+:)/);
    for (const section of ['WAITING ON YOUR CHECK', 'WORK ON THIS NEXT', 'YESTERDAY', 'THE WEEK']) {
      const chunk = chunks.find((part) => part.startsWith(`${section}:`));
      assert(chunk && /Omit\s+the\s+section\s+entirely/.test(chunk),
        `${section} is omitted when there is nothing to say`);
    }
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


  await test('a first run prints no block and hands the runner the latest version', () => {
    // The cursor is a line in the latest published brief (issue #86), so the
    // world here is an empty board and a scratch mark file — never the network.
    const world = mkNewsWorld();
    const first = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(first.status, 0, `exit 0 — stderr: ${first.stderr}`);
    // Past the instruction, which names the block it is explaining.
    assert(!/--- CC NEWS ---/.test(first.stdout.slice(INSTRUCTION.length)), 'the first morning does not dump the history');
    assertEq(world.mark().split('\n')[0], '<!-- cc-news: 2.1.219 -->', 'the version line the published brief will carry');

    // The brief that publish would have made, now on the board — and a release
    // above it upstream.
    world.publish('2.1.219');
    fs.writeFileSync(world.ccFile, `# Changelog\n\n## 2.1.220\n\n- Added a \`DirectoryAdded\` hook\n- Bug fixes\n${CC_CHANGELOG}`);
    const second = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(second.status, 0, `exit 0 — stderr: ${second.stderr}`);
    assert(/--- CC NEWS ---/.test(second.stdout.slice(INSTRUCTION.length)), 'the new release is flagged');
    assert(/\[hooks\]\n2\.1\.220 — Added a `DirectoryAdded` hook/.test(second.stdout), 'with the entry under its topic');
    assert(/\[other\]\n2\.1\.220 — Bug fixes/.test(second.stdout), 'and the housekeeping rides under other — the digest judges, not the job');
    assertEq(world.mark().split('\n')[0], '<!-- cc-news: 2.1.220 -->', 'and the cursor the next brief publishes has advanced');
    cleanup(world.home);
  });

  await test('the mark file carries both lines — the cursor and the day’s stats', () => {
    // Issue #55: the runner appends this file verbatim under the digest, so
    // both lines the published brief is meant to carry leave together.
    const world = mkNewsWorld();
    const res = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const lines = world.mark().trim().split('\n');
    assertEq(lines.length, 2, `two lines, got: ${world.mark()}`);
    assert(/^<!-- cc-news: /.test(lines[0]), `the cursor leads: ${lines[0]}`);
    assert(/^<!-- workkit-stats: \{"v":1,"date":"\d{4}-\d{2}-\d{2}",/.test(lines[1]), `and the stats line follows: ${lines[1]}`);
    assert(parseStatsMark(lines[1]), 'in the shape the read-back parses');
    cleanup(world.home);
  });

  await test('the stats line rides even when there was no news to carry', () => {
    // The two lines are independent: an upstream read that failed publishes no
    // cursor, and the day's numbers are not the news's to take with it.
    const world = mkNewsWorld();
    const env = { ...world.env, WORKKIT_CC_CHANGELOG: 'file:///nowhere/at/all.md' };
    const res = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    const lines = world.mark().trim().split('\n');
    assertEq(lines.length, 1, `one line, got: ${world.mark()}`);
    assert(/^<!-- workkit-stats: /.test(lines[0]), `and it is the day's numbers: ${lines[0]}`);
    cleanup(world.home);
  });

  await test('the stats line says what the payload said, not what the day happened to be', () => {
    // Composed directly, so the numbers are stated rather than swept: the line
    // is the payload's own counts, and its date is the payload's own stamp.
    const dir = mkTmp();
    const file = path.join(dir, 'mark');
    const before = process.env.WORKKIT_BRIEF_MARK_FILE;
    process.env.WORKKIT_BRIEF_MARK_FILE = file;
    writeBriefMarks(null, {
      ok: true,
      generatedAt: '2026-08-03T09:00:00.000Z',
      counts: { open: 4, waiting: 1, qa: 1, ready: 1, inFlight: 1, inbox: 1, parked: 0 },
      closedDay: 2,
      repoCounts: [{ slug: 'owner/repo', open: 4, closedDay: 2 }],
    });
    if (before === undefined) delete process.env.WORKKIT_BRIEF_MARK_FILE;
    else process.env.WORKKIT_BRIEF_MARK_FILE = before;
    assertEq(
      fs.readFileSync(file, 'utf8'),
      '<!-- workkit-stats: {"v":1,"date":"2026-08-03","totals":{"open":4,"waiting":1,"qa":1,"ready":1,"inFlight":1,"inbox":1,"parked":0},"closedDay":2,"repos":{"owner/repo":{"open":4}}} -->\n',
      'the line, exactly as the runner will append it',
    );
    cleanup(dir);
  });

  await test('nothing on this machine records the cursor', () => {
    const world = mkNewsWorld();
    spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env: world.env });
    assert(!fs.existsSync(path.join(world.home, '.workkit', '.cache.json')),
      'the disposable cache is not where the news cursor lives any more');
    cleanup(world.home);
  });

  await test('with no mark file named, the script still prints its brief', () => {
    // The runner names the file; a human running `node jobs/brief-payload.js`
    // does not, and the payload is the whole point of the script.
    const world = mkNewsWorld();
    const env = { ...world.env };
    delete env.WORKKIT_BRIEF_MARK_FILE;
    const res = spawnSync('node', [SCRIPT], { encoding: 'utf8', timeout: 60000, env });
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.startsWith(INSTRUCTION), 'the payload printed');
    cleanup(world.home);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
