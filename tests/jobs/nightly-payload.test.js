//
// Tests for jobs/nightly-payload.js — the day's record, as the summaries step
// hands it to Claude.
//
// The transcript index runs against a fixture projects tree whose mtimes are set
// by the suite, so "the last 24 hours" is a fact of the fixture and not of the
// clock. The commit walk runs against a fixture Repositories root: one real,
// opted-in git repo for the pass-through case, and a canned exec for the shapes
// a real repo cannot be made to produce on demand.
//
// Nothing here reaches the network, and nothing here runs Claude.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const SCRIPT = path.join(__dirname, '..', '..', 'jobs', 'nightly-payload.js');
const { composeNightly, transcriptIndex, commitsToday, render, INSTRUCTION } = require(SCRIPT);

const NOW = Date.parse('2026-07-28T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nightly-payload-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A projects tree holding the named transcripts. `agoHours` is how long before
 * NOW the file was last written; `bytes` how big it is.
 */
const mkProjects = (files) => {
  const root = mkTmp();
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

/** A fixture Repositories root with one opted-in repo carrying two commits. */
const mkRepos = () => {
  const root = mkTmp();
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
  return { root, repo, home: path.join(root, 'home') };
};

const passThrough = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commitsIn = (world, exec) => commitsToday({
  root: path.join(world.root, 'repos'),
  workflowHome: path.join(world.home, '.workkit'),
  home: world.home,
  exec: exec || passThrough,
});

const run = async () => {
  group('jobs/nightly-payload: the transcript index');

  await test('only the transcripts that moved inside the window are listed', () => {
    const root = mkProjects([
      { project: 'repo-a', name: 'fresh.jsonl', agoHours: 2 },
      { project: 'repo-b', name: 'yesterday.jsonl', agoHours: 30 },
    ]);
    const index = indexIn(root);
    assertEq(index.length, 1, 'the day-old transcript is out of the window');
    assert(index[0].path.endsWith('repo-a/fresh.jsonl'), `the fresh one is in: ${index[0].path}`);
    cleanup(root);
  });

  await test('newest first, with the size and mtime the sampler needs', () => {
    const root = mkProjects([
      { project: 'repo-a', name: 'older.jsonl', agoHours: 20, bytes: 40 },
      { project: 'repo-b', name: 'newest.jsonl', agoHours: 1, bytes: 400 },
      { project: 'repo-b', name: 'middle.jsonl', agoHours: 6, bytes: 4000 },
    ]);
    const index = indexIn(root);
    assertEq(index.map((t) => path.basename(t.path)).join(','), 'newest.jsonl,middle.jsonl,older.jsonl', 'ordered by mtime');
    assertEq(index[0].bytes, 400, 'the size rides along — a 10 MB file is skipped by size alone');
    assertEq(index[0].modifiedAt, new Date(NOW - HOUR).toISOString(), 'and the mtime as ISO');
    cleanup(root);
  });

  await test('only .jsonl files, and only inside a project directory', () => {
    const root = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    fs.writeFileSync(path.join(root, 'repo-a', 'notes.md'), 'not a transcript');
    fs.writeFileSync(path.join(root, 'loose.jsonl'), 'not in a project');
    const index = indexIn(root);
    assertEq(index.length, 1, `one transcript: ${index.map((t) => t.path).join(', ')}`);
    cleanup(root);
  });

  await test('a missing projects root is an empty index, not a crash', () => {
    assertEq(indexIn('/nonexistent/projects').length, 0, 'a machine with no transcripts still gets a payload');
  });

  await test('WORKKIT_CLAUDE_PROJECTS overrides the root', () => {
    const root = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    const previous = process.env.WORKKIT_CLAUDE_PROJECTS;
    process.env.WORKKIT_CLAUDE_PROJECTS = root;
    try {
      assertEq(transcriptIndex({ home: '/nonexistent', now: NOW }).length, 1, 'the env seam points the walk at the fixture');
    } finally {
      if (previous === undefined) delete process.env.WORKKIT_CLAUDE_PROJECTS;
      else process.env.WORKKIT_CLAUDE_PROJECTS = previous;
    }
    cleanup(root);
  });

  group('jobs/nightly-payload: the day’s commits');

  await test('a real repo’s commits arrive with their shas and subjects', () => {
    const world = mkRepos();
    const out = commitsIn(world);
    assertEq(out.length, 1, `the one opted-in repo: ${JSON.stringify(out)}`);
    assertEq(out[0].repo, 'fixture', 'named');
    assertEq(out[0].slug, 'ITW-Creative-Works/fixture', 'and slugged');
    assertEq(out[0].commits.length, 2, 'both of today’s commits');
    assertEq(out[0].commits[0].subject, 'fix: the second thing', 'newest first, as git logs it');
    assert(/^[0-9a-f]{7,}$/.test(out[0].commits[0].sha), `with a sha: ${out[0].commits[0].sha}`);
    cleanup(world.root);
  });

  await test('a repo with nothing today is left out entirely', () => {
    const world = mkRepos();
    const out = commitsIn(world, (cmd, args) => {
      if (args.includes('log')) return '';
      return passThrough(cmd, args);
    });
    assertEq(out.length, 0, 'a quiet repo is not a line in the payload');
    cleanup(world.root);
  });

  await test('a git log that fails is reported, not dropped', () => {
    const world = mkRepos();
    const out = commitsIn(world, (cmd, args) => {
      if (args.includes('log')) throw new Error('not a git repository');
      return passThrough(cmd, args);
    });
    assertEq(out.length, 1, 'the repo still appears');
    assert(/git log failed: not a git repository/.test(out[0].error), `carrying why: ${out[0].error}`);
    cleanup(world.root);
  });

  await test('the window asked of git is the same 24 hours', () => {
    const world = mkRepos();
    let since = null;
    commitsIn(world, (cmd, args) => {
      if (args.includes('log')) {
        since = args.find((a) => a.startsWith('--since='));
        return '';
      }
      return passThrough(cmd, args);
    });
    assertEq(since, '--since=24 hours ago', 'one window for both halves of the payload');
    cleanup(world.root);
  });

  group('jobs/nightly-payload: composition');

  await test('a day with sessions and commits is not quiet', () => {
    const world = mkRepos();
    const projects = mkProjects([{ project: 'repo-a', name: 'session.jsonl', agoHours: 1 }]);
    const out = composeNightly({
      projectsRoot: projects,
      root: path.join(world.root, 'repos'),
      workflowHome: path.join(world.home, '.workkit'),
      home: world.home,
      exec: passThrough,
      now: NOW,
    });
    assertEq(out.quiet, false, 'there is a day to reflect on');
    assertEq(out.transcripts.length, 1, 'the index rode along');
    assertEq(out.commits.length, 1, 'and the commits');
    assertEq(out.window.since, new Date(NOW - 24 * HOUR).toISOString(), 'the window is stated in the payload');
    assertEq(out.generatedAt, new Date(NOW).toISOString(), 'stamped from the injected clock');
    cleanup(world.root);
    cleanup(projects);
  });

  await test('no sessions and no commits is a quiet day', () => {
    const out = composeNightly({
      projectsRoot: '/nonexistent/projects',
      root: '/nonexistent/repos',
      workflowHome: '/nonexistent/.workkit',
      exec: () => { throw new Error('never called'); },
      now: NOW,
    });
    assertEq(out.quiet, true, 'the runner short-circuits on this');
    assertEq(out.transcripts.length, 0, 'nothing to read');
    assertEq(out.commits.length, 0, 'and nothing landed');
  });

  group('jobs/nightly-payload: the instruction');

  await test('it names the four sections, in order', () => {
    const sections = ['## Went well', '## Went poorly', '## Improvements', '## Facts learned'];
    let cursor = -1;
    for (const section of sections) {
      const at = INSTRUCTION.indexOf(section);
      assert(at > cursor, `${section} is named, after the one before it`);
      cursor = at;
    }
    assert(/EXACTLY these four\s+sections/.test(INSTRUCTION), 'and they are the only four');
  });

  await test('it hands the model its own reading budget over the index', () => {
    assert(/Read, Grep, and Glob/.test(INSTRUCTION), 'the tools it samples with');
    assert(/newest/.test(INSTRUCTION), 'the order');
    assert(/larger than 10 MB/.test(INSTRUCTION), 'the size ceiling');
    assert(/Stop when the reading budget feels spent/.test(INSTRUCTION), 'and when to stop');
  });

  await test('the improvements are candidates, not filings', () => {
    assert(/candidate issue/.test(INSTRUCTION), 'each improvement is phrased as one');
    assert(/Nothing is filed from this document/.test(INSTRUCTION), 'and the job files nothing itself');
  });

  await test('the output is the document, with nothing wrapped around it', () => {
    assert(/output ONLY the finished daily summary/.test(INSTRUCTION), 'the response IS the summary');
    assert(/No preamble/.test(INSTRUCTION), 'no preamble');
    assert(/no code fence around\s+the document itself/.test(INSTRUCTION), 'and no fence — the script writes this to a file');
  });

  group('jobs/nightly-payload: what is printed');

  await test('the rendered payload leads with the instruction, then readable JSON', () => {
    const out = composeNightly({ projectsRoot: '/nonexistent', root: '/nonexistent', now: NOW });
    const text = render(out);
    assert(text.startsWith(INSTRUCTION), 'the instruction is first');
    const parsed = JSON.parse(text.slice(INSTRUCTION.length));
    assertEq(parsed.quiet, true, 'the payload round-trips');
    assert(/\n  "transcripts": \[/.test(text), 'indented, not one line — a human reads this over a shoulder');
  });

  await test('run as a script it prints a payload and exits 0', () => {
    // An empty HOME: the live machine's repos and transcripts are none of this
    // suite's business.
    const home = mkTmp();
    const res = spawnSync('node', [SCRIPT], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, HOME: home, WORKKIT_CLAUDE_PROJECTS: path.join(home, 'projects') },
    });
    cleanup(home);
    assertEq(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert(res.stdout.startsWith(INSTRUCTION), 'stdout leads with the instruction');
    const parsed = JSON.parse(res.stdout.slice(INSTRUCTION.length));
    assert(Array.isArray(parsed.transcripts), 'and carries the index');
    assert(Array.isArray(parsed.commits), 'and the commits');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
