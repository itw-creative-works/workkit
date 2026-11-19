// Tests for workflow/lib/records.js's exports, each asked in a node of its own under
// the world's env (the records live under its machine folder): the suite record's
// write, the package record's locked line write, and the sweep each write runs first.
// The record paths are the tests' own (test/lib/suite-record.js).

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run, seeded,
} = require('../lib/harness');
const { homeEnv } = require('../lib/platform');
const { caught } = require('../lib/caught');
const { kitUnder, kitUnderAsync } = require('../lib/kit-under');
const { suiteMarkerPath, pkgMarkerPath, pkgRecord } = require('../lib/suite-record');
const { agedFile, daysAgo } = require('../lib/workflow-home');

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

// records.js's <name> once per argument list, the root first, in the world's env.
const ask = (w, name, ...asks) => kitUnder(w.env, 'records.js', name, asks.map((args) => [w.root, ...args]));

// A record file's lines, its last line end dropped; undefined when there is none.
const linesOf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : undefined);

describe('records.js: the suite record', () => {
  test('writeSuiteRecord: the tree id on line 1, ms=<n> on line 2, and suiteHolds holds that tree alone', () => {
    const w = recWorld();
    expect(ask(w, 'writeSuiteRecord', [T1, '1234'])[0], 'the record is written').toBe(true);
    expect(JSON.stringify(linesOf(suiteMarkerPath(w.workflowHome, w.repo))), 'the tree, then the run\'s ms').toBe(JSON.stringify([T1, 'ms=1234']));
    expect(JSON.stringify(ask(w, 'suiteHolds', [T1], [T2])), 'the recorded tree is proved, another tree is not').toBe(JSON.stringify([true, false]));
  });

  test('writeSuiteRecord: an empty tree is refused and nothing is written', () => {
    const w = recWorld();
    expect(ask(w, 'writeSuiteRecord', ['', '1234'])[0], 'an empty tree (a failed hash) is refused').toBe(false);
    expect(fs.existsSync(suiteMarkerPath(w.workflowHome, w.repo)), 'and no record is there').toBe(false);
  });
});

describe('records.js: the package record', () => {
  test('writePkgRecord from 12 nodes at once: every line lands, one per package; a package written again keeps one line, its newest, last', async () => {
    const w = recWorld();
    const pkgs = Array.from({ length: 12 }, (_, i) => `packages/p${i + 1}`);
    const wrote = await Promise.all(pkgs.map((pkg) => kitUnderAsync(w.env, 'records.js', 'writePkgRecord', [[w.root, T1, pkg]])));
    expect(JSON.stringify(wrote), 'every write answers true').toBe(JSON.stringify(pkgs.map(() => [true])));
    expect(JSON.stringify([...pkgRecord(w.workflowHome, w.repo)].sort()), 'one line per package, none lost')
      .toBe(JSON.stringify(pkgs.map((pkg) => `${T1} ${pkg}`).sort()));

    expect(ask(w, 'writePkgRecord', [T2, 'packages/p1'])[0], 'p1 written again on another tree').toBe(true);
    const lines = pkgRecord(w.workflowHome, w.repo);
    expect(lines.filter((l) => l.endsWith(' packages/p1')).length, 'p1 keeps one line').toBe(1);
    expect(lines[lines.length - 1], 'its newest, last').toBe(`${T2} packages/p1`);
    expect(lines.length, 'and every other package keeps its line').toBe(12);
    expect(JSON.stringify(ask(w, 'pkgHolds', [T2, 'packages/p1'], [T1, 'packages/p1'], [T1, 'packages/p2'])),
      'p1 is proved on its new tree and no longer on its old one; p2 still is on its own').toBe(JSON.stringify([true, false, true]));
  });

  test('a writePkgRecord that cannot land: it throws, and no temp file or lock folder is left beside the record', async () => {
    const w = recWorld();
    const marker = pkgMarkerPath(w.workflowHome, w.repo);
    // A folder where the record's file goes, so the write cannot land.
    fs.mkdirSync(marker, { recursive: true });
    const err = await caught(() => ask(w, 'writePkgRecord', [T1, 'packages/a']));
    expect(err !== null && err.message.startsWith('writePkgRecord of records.js threw: '), `the write threw, got: ${err && err.message}`).toBe(true);
    const left = fs.readdirSync(path.dirname(marker)).filter((name) => name.includes('.tmp.') || name.endsWith('.lock'));
    expect(JSON.stringify(left), 'no temp file and no lock folder left').toBe('[]');
  });
});

describe('records.js: the sweep at a write', () => {
  test('a record file older than 7 days in a marker folder goes at the next write; a younger one and a lock folder stay', () => {
    for (const [name, ...args] of [['writeSuiteRecord', T1, '1'], ['writePkgRecord', T1, '.']]) {
      const w = recWorld();
      const markers = path.join(w.workflowHome, 'markers');
      const old = agedFile(path.join(markers, 'claude-review-marker', 'old'), 8);
      const young = agedFile(path.join(markers, 'claude-review-marker', 'young'), 6);
      const lockFile = agedFile(path.join(markers, 'claude-suite-lock', 'held', 'pid'), 8);
      fs.utimesSync(path.dirname(lockFile), daysAgo(8), daysAgo(8));
      expect(ask(w, name, args)[0], `${name}: the record is written`).toBe(true);
      expect(fs.existsSync(old), `${name}: the 8-day-old file goes`).toBe(false);
      expect(fs.existsSync(young), `${name}: the 6-day-old file stays`).toBe(true);
      expect(fs.existsSync(lockFile), `${name}: the lock folder is left alone, its file in it`).toBe(true);
    }
  });
});
