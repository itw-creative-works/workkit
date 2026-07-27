//
// Tests for tower/lib/health.js — per-repo health.
//
// Real git repositories throughout, including a real bare "origin" cloned
// locally so the upstream cases are genuine: whether a branch has an upstream,
// and how far ahead of it HEAD sits, is exactly the question a stub would beg.
// No network — a local path is a perfectly good remote.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');

const { repoHealth, unreleasedCount } = require(path.join(__dirname, '..', '..', 'tower', 'lib', 'health.js'));

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tower-health-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A repo with one commit and no remote. */
const mkRepo = (root, name = 'repo') => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# repo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
};

/** The same repo, plus a local bare origin its branch tracks. */
const mkTrackedRepo = (root) => {
  const dir = mkRepo(root, 'tracked');
  const origin = path.join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  return dir;
};

const commit = (dir, file, body) => {
  fs.writeFileSync(path.join(dir, file), body);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', `add ${file}`);
};

const CHANGELOG = [
  '# Changelog',
  '',
  '- a preamble bullet that is not an entry',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- [#17](../../issues/17) — The tower reads the board.',
  '- [#18](../../issues/18) — The tower reads the crew.',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '- [#1](../../issues/1) — An older entry, already released.',
  '',
].join('\n');

const run = async () => {
  group('tower/health: git counts');

  await test('unpushed counts commits ahead of the upstream', () => {
    const tmp = mkTmp();
    const dir = mkTrackedRepo(tmp);
    assertEq(repoHealth(dir).unpushed, 0, 'level with origin');
    commit(dir, 'a.txt', 'a');
    commit(dir, 'b.txt', 'b');
    assertEq(repoHealth(dir).unpushed, 2, 'two ahead');
    cleanup(tmp);
  });

  await test('no upstream reads null, which is NOT the same as zero', () => {
    const tmp = mkTmp();
    const health = repoHealth(mkRepo(tmp));
    assertEq(health.unpushed, null, 'never pushed anywhere');
    assertEq(health.error, null, 'a local-only repo is healthy, not broken');
    cleanup(tmp);
  });

  await test('uncommitted counts working-tree entries', () => {
    const tmp = mkTmp();
    const dir = mkRepo(tmp);
    assertEq(repoHealth(dir).uncommitted, 0, 'clean');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
    assertEq(repoHealth(dir).uncommitted, 2, 'one untracked, one modified');
    cleanup(tmp);
  });

  await test('lastTag is the most recent tag, or null when there is none', () => {
    const tmp = mkTmp();
    const dir = mkRepo(tmp);
    assertEq(repoHealth(dir).lastTag, null, 'never released');
    git(dir, 'tag', 'v1.0.0');
    commit(dir, 'c.txt', 'c');
    git(dir, 'tag', 'v1.1.0');
    assertEq(repoHealth(dir).lastTag, 'v1.1.0', 'the latest');
    cleanup(tmp);
  });

  group('tower/health: the CHANGELOG');

  await test('only bullets under [Unreleased] are counted', () => {
    const tmp = mkTmp();
    const dir = mkRepo(tmp);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);
    assertEq(repoHealth(dir).unreleasedEntries, 2, 'the preamble and the released section are excluded');
    cleanup(tmp);
  });

  await test('no CHANGELOG, and an empty [Unreleased], both count zero', () => {
    const tmp = mkTmp();
    const dir = mkRepo(tmp);
    assertEq(repoHealth(dir).unreleasedEntries, 0, 'no file');
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- [#1](../../issues/1) — Shipped.\n');
    assertEq(repoHealth(dir).unreleasedEntries, 0, 'just released');
    cleanup(tmp);
  });

  await test('unreleasedCount reads a file directly, and a missing one is zero', () => {
    const tmp = mkTmp();
    const file = path.join(tmp, 'CHANGELOG.md');
    fs.writeFileSync(file, CHANGELOG);
    assertEq(unreleasedCount(file), 2, 'two entries');
    assertEq(unreleasedCount(path.join(tmp, 'absent.md')), 0, 'no file');
    cleanup(tmp);
  });

  group('tower/health: nothing throws');

  await test('a path that is not a git repository reports an error and nulls', () => {
    const tmp = mkTmp();
    const health = repoHealth(path.join(tmp, 'not-a-repo'));
    assert(/not a git repository/.test(health.error), 'the error names the problem');
    assertEq(health.unpushed, null, 'null');
    assertEq(health.uncommitted, null, 'null');
    assertEq(health.lastTag, null, 'null');
    assertEq(health.unreleasedEntries, 0, 'zero');
    cleanup(tmp);
  });

  await test('every field is present on every path, so a tile always renders', () => {
    const tmp = mkTmp();
    const keys = (h) => Object.keys(h).sort().join(',');
    const expected = 'error,lastTag,uncommitted,unpushed,unreleasedEntries';
    assertEq(keys(repoHealth(mkRepo(tmp))), expected, 'healthy repo');
    assertEq(keys(repoHealth(path.join(tmp, 'nope'))), expected, 'broken path');
    cleanup(tmp);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
