// Tests for jobs/claude-nightly/nightly-payload.js: the day's record, as the
// summaries step hands it to Claude. Transcript mtimes are set by the suite, so
// "the last 24 hours" is a fact of the fixture; the commit walk uses one real
// opted-in repo plus a canned exec. Nothing here reaches the network or Claude.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { gitPath, homeEnv } = require('../lib/platform');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'claude-nightly', 'nightly-payload.js');
const {
  composeNightly, composeRollup, transcriptIndex, commitsToday,
  renderRollup, rollupInstruction, INSTRUCTION,
} = require(SCRIPT);

const NOW = Date.parse('2026-07-28T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A projects tree holding the named transcripts. `agoHours` is how long before
 * now the file was last written; `bytes` how big it is.
 */
const mkProjects = (files) => {
  const root = mkTmp('nightly-payload-');
  for (const file of files) {
    const dir = path.join(root, file.project);
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, file.name);
    fs.writeFileSync(full, 'x'.repeat(file.bytes === undefined ? 10 : file.bytes));
    const when = new Date(NOW - file.agoHours * HOUR);
    fs.utimesSync(full, when, when);
  }
  return root;
};

const indexIn = (projectsRoot) => transcriptIndex({ projectsRoot, now: NOW });

/**
 * A fixture roster with one opted-in repo carrying two commits: the repo, and
 * the scratch ~/.workkit that registers it: the index the tower and the jobs
 * both read, so nothing here walks a disk.
 */
const mkRepos = () => {
  const root = mkTmp('nightly-payload-');
  const repo = path.join(root, 'repos', 'Owner', 'fixture');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'remote', 'add', 'origin', 'git@github.com:ITW-Creative-Works/fixture.git');
  fs.mkdirSync(path.join(repo, '.workkit'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), JSON.stringify({ version: 7, enabled: true }));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'feat: the first thing');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'fix: the second thing');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.workkit'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.workkit', '.repos.json'),
    JSON.stringify({ version: 1, repos: { [gitPath(repo)]: 'enabled' } }, null, 2),
  );
  return { root, repo, home };
};

const passThrough = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commitsIn = (world, exec) => commitsToday({
  workflowHome: path.join(world.home, '.workkit'),
  home: world.home,
  exec: exec || passThrough,
});

describe('jobs/nightly-payload: the transcript index', () => {
  test('only the transcripts that moved inside the window are listed', () => {
    const root = mkProjects([
      { project: 'repo-a', name: 'fresh.jsonl', agoHours: 2 },
      { project: 'repo-b', name: 'yesterday.jsonl', agoHours: 30 },
    ]);
    const index = indexIn(root);
    expect(index.length, 'the day-old transcript is out of the window').toBe(1);
    // The index carries the path the way the platform joins one, so the tail
    // this compares against is joined the same way.
    expect(index[0].path.endsWith(path.join('repo-a', 'fresh.jsonl')), `the fresh one is in: ${index[0].path}`).toBeTruthy();
    cleanup(root);
  });

  test('newest first, with the size and mtime the sampler needs', () => {
    const root = mkProjects([
      { project: 'repo-a', name: 'older.jsonl', agoHours: 20, bytes: 40 },
      { project: 'repo-b', name: 'newest.jsonl', agoHours: 1, bytes: 400 },
      { project: 'repo-b', name: 'middle.jsonl', agoHours: 6, bytes: 4000 },
    ]);
    const index = indexIn(root);
    expect(index.map((t) => path.basename(t.path)).join(','), 'ordered by mtime').toBe('newest.jsonl,middle.jsonl,older.jsonl');
    expect(index[0].bytes, 'the size rides along: a 10 MB file is skipped by size alone').toBe(400);
    expect(index[0].modifiedAt, 'and the mtime as ISO').toBe(new Date(NOW - HOUR).toISOString());
    cleanup(root);
  });

  test('only .jsonl files, and only inside a project directory', () => {
    const root = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    fs.writeFileSync(path.join(root, 'repo-a', 'notes.md'), 'not a transcript');
    fs.writeFileSync(path.join(root, 'loose.jsonl'), 'not in a project');
    const index = indexIn(root);
    expect(index.length, `one transcript: ${index.map((t) => t.path).join(', ')}`).toBe(1);
    cleanup(root);
  });

  test('a missing projects root is an empty index, not a crash', () => {
    expect(indexIn('/nonexistent/projects').length, 'a machine with no transcripts still gets a payload').toBe(0);
  });

  test('WORKKIT_CLAUDE_PROJECTS overrides the root', () => {
    const root = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    const previous = process.env.WORKKIT_CLAUDE_PROJECTS;
    process.env.WORKKIT_CLAUDE_PROJECTS = root;
    try {
      expect(transcriptIndex({ home: '/nonexistent', now: NOW }).length, 'the env seam points the walk at the fixture').toBe(1);
    } finally {
      if (previous === undefined) delete process.env.WORKKIT_CLAUDE_PROJECTS;
      else process.env.WORKKIT_CLAUDE_PROJECTS = previous;
    }
    cleanup(root);
  });
});

describe('jobs/nightly-payload: the day’s commits', () => {
  test('a real repo’s commits arrive with their shas and subjects', () => {
    const world = mkRepos();
    const out = commitsIn(world);
    expect(out.length, `the one opted-in repo: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0].repo, 'named').toBe('fixture');
    expect(out[0].slug, 'and slugged').toBe('ITW-Creative-Works/fixture');
    expect(out[0].commits.length, 'both of today’s commits').toBe(2);
    expect(out[0].commits[0].subject, 'newest first, as git logs it').toBe('fix: the second thing');
    expect(/^[0-9a-f]{7,}$/.test(out[0].commits[0].sha), `with a sha: ${out[0].commits[0].sha}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a repo with nothing today is left out entirely', () => {
    const world = mkRepos();
    const out = commitsIn(world, (cmd, args) => {
      if (args.includes('log')) return '';
      return passThrough(cmd, args);
    });
    expect(out.length, 'a quiet repo is not a line in the payload').toBe(0);
    cleanup(world.root);
  });

  test('a git log that fails is reported, not dropped', () => {
    const world = mkRepos();
    const out = commitsIn(world, (cmd, args) => {
      if (args.includes('log')) throw new Error('not a git repository');
      return passThrough(cmd, args);
    });
    expect(out.length, 'the repo still appears').toBe(1);
    expect(/git log failed: not a git repository/.test(out[0].error), `carrying why: ${out[0].error}`).toBeTruthy();
    cleanup(world.root);
  });

  test('the window asked of git is the same 24 hours', () => {
    const world = mkRepos();
    let since = null;
    commitsIn(world, (cmd, args) => {
      if (args.includes('log')) {
        since = args.find((a) => a.startsWith('--since='));
        return '';
      }
      return passThrough(cmd, args);
    });
    expect(since, 'one window for both halves of the payload').toBe('--since=24 hours ago');
    cleanup(world.root);
  });
});

describe('jobs/nightly-payload: composition', () => {
  test('a day with sessions and commits is not quiet', () => {
    const world = mkRepos();
    const projects = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    const out = composeNightly({
      projectsRoot: projects,
      workflowHome: path.join(world.home, '.workkit'),
      home: world.home,
      exec: passThrough,
      now: NOW,
    });
    expect(out.quiet, 'there is a day to reflect on').toBe(false);
    expect(out.transcripts.length, 'the index rode along').toBe(1);
    expect(out.commits.length, 'and the commits').toBe(1);
    expect(out.window.since, 'the window is stated in the payload').toBe(new Date(NOW - 24 * HOUR).toISOString());
    expect(out.generatedAt, 'stamped from the injected clock').toBe(new Date(NOW).toISOString());
    cleanup(world.root);
    cleanup(projects);
  });

  test('no sessions and no commits is a quiet day', () => {
    const out = composeNightly({
      projectsRoot: '/nonexistent/projects',
      workflowHome: '/nonexistent/.workkit',
      exec: () => { throw new Error('never called'); },
      now: NOW,
    });
    expect(out.quiet, 'the runner short-circuits on this').toBe(true);
    expect(out.transcripts.length, 'nothing to read').toBe(0);
    expect(out.commits.length, 'and nothing landed').toBe(0);
  });
});

describe('jobs/nightly-payload: the instruction', () => {
  test('it names the four sections, in order', () => {
    const sections = ['## Went well', '## Went poorly', '## Improvements', '## Facts learned'];
    let cursor = -1;
    for (const section of sections) {
      const at = INSTRUCTION.indexOf(section);
      expect(at > cursor, `${section} is named, after the one before it`).toBeTruthy();
      cursor = at;
    }
    expect(/EXACTLY these four\s+sections/.test(INSTRUCTION), 'and they are the only four').toBeTruthy();
  });
});

describe('jobs/nightly-payload: what is printed', () => {
  test('run as a script it prints a payload and exits 0', () => {
    // An empty HOME: the live machine's repos and transcripts are none of this
    // suite's business.
    const home = mkTmp('nightly-payload-');
    const res = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
      env: homeEnv(home, { ...process.env, WORKKIT_CLAUDE_PROJECTS: path.join(home, 'projects') }),
    });
    cleanup(home);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith(INSTRUCTION), 'stdout leads with the instruction').toBeTruthy();
    const parsed = JSON.parse(res.stdout.slice(INSTRUCTION.length));
    expect(Array.isArray(parsed.transcripts), 'and carries the index').toBeTruthy();
    expect(Array.isArray(parsed.commits), 'and the commits').toBeTruthy();
  });
});

describe('jobs/nightly-payload: the rollups', () => {
  test('a rollup is composed from the summaries already published', () => {
    // A week's material is the daily summaries, read back from the Discussions
    // API, never the transcripts again, which the days already read.
    const prior = [
      { title: 'daily: 2026-07-27', createdAt: '2026-07-27T09:00:00Z', body: '## Went well\nShipped.' },
      { title: 'daily: 2026-07-26', createdAt: '2026-07-26T09:00:00Z', body: '## Went well\nSpecced.' },
    ];
    const payload = composeRollup(prior, { cadence: 'weekly', generatedAt: '2026-07-28T09:00:00Z' });
    expect(payload.cadence, 'it knows which period it is').toBe('weekly');
    expect(payload.quiet, 'and that there was something to roll up').toBe(false);
    expect(payload.summaries.length, 'carrying every summary it was given').toBe(2);

    const text = renderRollup(payload);
    expect(text.startsWith(rollupInstruction('weekly')), 'the instruction is first').toBeTruthy();
    expect(/WEEKLY SUMMARY/.test(text), 'and names the cadence it is asking for').toBeTruthy();
    expect(JSON.parse(text.slice(rollupInstruction('weekly').length)).summaries.length, 'the payload round-trips').toBe(2);
  });

  test('a period with nothing published is quiet, not invented', () => {
    expect(composeRollup([], { cadence: 'monthly' }).quiet, 'an empty period says so').toBe(true);
    expect(composeRollup(null, { cadence: 'monthly' }).summaries.length, 'and unreadable input is empty, never a guess').toBe(0);
  });

  test('run as a script, --cadence reads the prior summaries from stdin', () => {
    const home = mkTmp('nightly-payload-');
    const res = spawnSync(process.execPath, [SCRIPT, '--cadence', 'weekly'], {
      encoding: 'utf8',
      timeout: SPAWN_DEADLINE,
      input: JSON.stringify([{ title: 'daily: 2026-07-27', createdAt: '2026-07-27T09:00:00Z', body: 'a day' }]),
      env: homeEnv(home, { ...process.env }),
    });
    cleanup(home);
    expect(res.status, `exit 0, stderr: ${res.stderr}`).toBe(0);
    expect(res.stdout.startsWith(rollupInstruction('weekly')), 'stdout leads with the rollup instruction').toBeTruthy();
    const parsed = JSON.parse(res.stdout.slice(rollupInstruction('weekly').length));
    expect(parsed.summaries[0].body, 'and carries what stdin handed it').toBe('a day');
  });

  test('an unknown cadence is refused rather than guessed', () => {
    const res = spawnSync(process.execPath, [SCRIPT, '--cadence', 'hourly'], { encoding: 'utf8', input: '[]', timeout: SPAWN_DEADLINE });
    expect(res.status, 'exit 1').toBe(1);
    expect(/unknown cadence hourly/.test(res.stderr), `it names what it did not understand, got: ${res.stderr}`).toBeTruthy();
  });
});
