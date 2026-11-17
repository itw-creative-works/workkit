// Tests for workflow/lib/records.js run as a command (`node records.js <verb>
// ...`, a yes or no its exit code): the suite record's write, the package
// record's locked line write, and the sweep each write runs first. The record
// paths are the tests' own (test/lib/suite-record.js).

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, start, seeded,
} = require('../lib/harness');
const { homeEnv } = require('../lib/platform');
const { suiteMarkerPath, pkgMarkerPath, pkgRecord } = require('../lib/suite-record');
const { agedFile, daysAgo } = require('../lib/workflow-home');

const RECORDS = path.join(__dirname, '..', '..', 'workflow', 'lib', 'records.js');

// Two tree ids a record can hold, neither a real tree.
const T1 = '1'.repeat(40);
const T2 = '2'.repeat(40);

// A git repo with nothing in it: a root to key the records by, as git spells it.
const emptyRepo = seeded((dir) => run('git', ['init', '-q'], { cwd: dir }));

/** A scratch machine (its own home and workflow home) and a repo of its own; `root` is git's spelling of it. */
const recWorld = () => {
  const base = mkTmp('records-');
  const repo = path.join(base, 'repo');
  emptyRepo(repo);
  const home = path.join(base, 'home');
  const workflowHome = path.join(home, '.workkit');
  const env = homeEnv(home, { PATH: process.env.PATH, WORKFLOW_HOME: workflowHome });
  const root = run('git', ['rev-parse', '--show-toplevel'], { cwd: repo, env }).stdout.trim();
  return { repo, root, workflowHome, env };
};

// `node records.js <verb> <args>` in the world's env.
const rec = (w, verb, ...args) => run(process.execPath, [RECORDS, verb, ...args], { cwd: w.repo, env: w.env });

// A record file's lines, its last line end dropped; undefined when there is none.
const linesOf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : undefined);

describe('records.js: the suite record', () => {
  test('suite-write: the tree id on line 1, ms=<n> on line 2, and suite-proved holds that tree alone', () => {
    const w = recWorld();
    const res = rec(w, 'suite-write', w.root, T1, '1234');
    expect(res.status, `the record is written, stderr: ${res.stderr}`).toBe(0);
    expect(JSON.stringify(linesOf(suiteMarkerPath(w.workflowHome, w.repo))), 'the tree, then the run\'s ms').toBe(JSON.stringify([T1, 'ms=1234']));
    expect(rec(w, 'suite-proved', w.root, T1).status, 'the recorded tree is proved').toBe(0);
    expect(rec(w, 'suite-proved', w.root, T2).status, 'another tree is not').toBe(1);
  });

  test('suite-write: an empty tree is refused and nothing is written', () => {
    const w = recWorld();
    expect(rec(w, 'suite-write', w.root, '', '1234').status !== 0, 'an empty tree (a failed hash) is refused').toBeTruthy();
    expect(fs.existsSync(suiteMarkerPath(w.workflowHome, w.repo)), 'and no record is there').toBe(false);
  });
});

describe('records.js: the package record', () => {
  test('pkg-write for 12 packages at once: every line lands, one per package; a package written again keeps one line, its newest, last', async () => {
    const w = recWorld();
    const pkgs = Array.from({ length: 12 }, (_, i) => `packages/p${i + 1}`);
    const runs = pkgs.map((pkg) => start(process.execPath, [RECORDS, 'pkg-write', w.root, T1, pkg], { cwd: w.repo, env: w.env }));
    const ends = await Promise.all(runs.map((r) => r.done));
    expect(JSON.stringify(ends.map((e) => e.status)), `every write exits 0: ${runs.map((r) => r.stderr()).join('')}`).toBe(JSON.stringify(pkgs.map(() => 0)));
    expect(JSON.stringify([...pkgRecord(w.workflowHome, w.repo)].sort()), 'one line per package, none lost')
      .toBe(JSON.stringify(pkgs.map((pkg) => `${T1} ${pkg}`).sort()));

    expect(rec(w, 'pkg-write', w.root, T2, 'packages/p1').status, 'p1 written again on another tree').toBe(0);
    const lines = pkgRecord(w.workflowHome, w.repo);
    expect(lines.filter((l) => l.endsWith(' packages/p1')).length, 'p1 keeps one line').toBe(1);
    expect(lines[lines.length - 1], 'its newest, last').toBe(`${T2} packages/p1`);
    expect(lines.length, 'and every other package keeps its line').toBe(12);
    expect(rec(w, 'pkg-proved', w.root, T2, 'packages/p1').status, 'p1 is proved on its new tree').toBe(0);
    expect(rec(w, 'pkg-proved', w.root, T1, 'packages/p1').status, 'and no longer on its old one').toBe(1);
    expect(rec(w, 'pkg-proved', w.root, T1, 'packages/p2').status, 'p2 still is on its own').toBe(0);
  });

  test('a pkg-write that cannot land: a records: line, exit 1, and no temp file or lock folder left beside the record', () => {
    const w = recWorld();
    const marker = pkgMarkerPath(w.workflowHome, w.repo);
    // A folder where the record's file goes, so the write cannot land.
    fs.mkdirSync(marker, { recursive: true });
    const res = rec(w, 'pkg-write', w.root, T1, 'packages/a');
    expect(res.status, `exit 1, got: ${res.stdout}|${res.stderr}`).toBe(1);
    expect(res.stderr.split('\n').some((l) => l.startsWith('records: ')), `a records: line, got: ${res.stderr}`).toBeTruthy();
    const left = fs.readdirSync(path.dirname(marker)).filter((name) => name.includes('.tmp.') || name.endsWith('.lock'));
    expect(JSON.stringify(left), 'no temp file and no lock folder left').toBe('[]');
  });
});

describe('records.js: the sweep at a write', () => {
  test('a record file older than 7 days in a marker folder goes at the next write; a younger one and a lock folder stay', () => {
    for (const [verb, ...args] of [['suite-write', T1, '1'], ['pkg-write', T1, '.']]) {
      const w = recWorld();
      const markers = path.join(w.workflowHome, 'markers');
      const old = agedFile(path.join(markers, 'claude-review-marker', 'old'), 8);
      const young = agedFile(path.join(markers, 'claude-review-marker', 'young'), 6);
      const lockFile = agedFile(path.join(markers, 'claude-suite-lock', 'held', 'pid'), 8);
      fs.utimesSync(path.dirname(lockFile), daysAgo(8), daysAgo(8));
      expect(rec(w, verb, w.root, ...args).status, `${verb}: the record is written`).toBe(0);
      expect(fs.existsSync(old), `${verb}: the 8-day-old file goes`).toBe(false);
      expect(fs.existsSync(young), `${verb}: the 6-day-old file stays`).toBe(true);
      expect(fs.existsSync(lockFile), `${verb}: the lock folder is left alone, its file in it`).toBe(true);
    }
  });
});
