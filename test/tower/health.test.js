//
// Tests for tower/api/lib/health.js, per-repo health, over real git repos and a
// local bare origin: the upstream questions are exactly what a stub would beg.
//

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, test, expect, mkTmp } = require('../lib/harness');

const { repoHealth, unreleasedCount } = require(path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'health.js'));

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
  '- [#17](../../issues/17) - The tower reads the board.',
  '- [#18](../../issues/18) - The tower reads the crew.',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '- [#1](../../issues/1) - An older entry, already released.',
  '',
].join('\n');

describe('tower/health: git counts', () => {
  test('unpushed counts commits ahead of the upstream', () => {
    const tmp = mkTmp('tower-health-');
    const dir = mkTrackedRepo(tmp);
    expect(repoHealth(dir).unpushed, 'level with origin').toBe(0);
    commit(dir, 'a.txt', 'a');
    commit(dir, 'b.txt', 'b');
    expect(repoHealth(dir).unpushed, 'two ahead').toBe(2);
    cleanup(tmp);
  });

  test('no upstream reads null, which is NOT the same as zero', () => {
    const tmp = mkTmp('tower-health-');
    const health = repoHealth(mkRepo(tmp));
    expect(health.unpushed, 'never pushed anywhere').toBe(null);
    expect(health.error, 'a local-only repo is healthy, not broken').toBe(null);
    cleanup(tmp);
  });

  test('uncommitted counts working-tree entries', () => {
    const tmp = mkTmp('tower-health-');
    const dir = mkRepo(tmp);
    expect(repoHealth(dir).uncommitted, 'clean').toBe(0);
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'README.md'), '# changed\n');
    expect(repoHealth(dir).uncommitted, 'one untracked, one modified').toBe(2);
    cleanup(tmp);
  });

  test('lastTag is the most recent tag, or null when there is none', () => {
    const tmp = mkTmp('tower-health-');
    const dir = mkRepo(tmp);
    expect(repoHealth(dir).lastTag, 'never released').toBe(null);
    git(dir, 'tag', 'v1.0.0');
    commit(dir, 'c.txt', 'c');
    git(dir, 'tag', 'v1.1.0');
    expect(repoHealth(dir).lastTag, 'the latest').toBe('v1.1.0');
    cleanup(tmp);
  });
});

describe('tower/health: the CHANGELOG', () => {
  test('only bullets under [Unreleased] are counted', () => {
    const tmp = mkTmp('tower-health-');
    const dir = mkRepo(tmp);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);
    expect(repoHealth(dir).unreleasedEntries, 'the preamble and the released section are excluded').toBe(2);
    cleanup(tmp);
  });

  test('no CHANGELOG, and an empty [Unreleased], both count zero', () => {
    const tmp = mkTmp('tower-health-');
    const dir = mkRepo(tmp);
    expect(repoHealth(dir).unreleasedEntries, 'no file').toBe(0);
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- [#1](../../issues/1) - Shipped.\n');
    expect(repoHealth(dir).unreleasedEntries, 'just released').toBe(0);
    cleanup(tmp);
  });

  test('unreleasedCount reads a file directly, and a missing one is zero', () => {
    const tmp = mkTmp('tower-health-');
    const file = path.join(tmp, 'CHANGELOG.md');
    fs.writeFileSync(file, CHANGELOG);
    expect(unreleasedCount(file), 'two entries').toBe(2);
    expect(unreleasedCount(path.join(tmp, 'absent.md')), 'no file').toBe(0);
    cleanup(tmp);
  });
});

describe('tower/health: nothing throws', () => {
  test('a path that is not a git repository reports an error and nulls', () => {
    const tmp = mkTmp('tower-health-');
    const health = repoHealth(path.join(tmp, 'not-a-repo'));
    expect(/not a git repository/.test(health.error), 'the error names the problem').toBeTruthy();
    expect(health.unpushed, 'null').toBe(null);
    expect(health.uncommitted, 'null').toBe(null);
    expect(health.lastTag, 'null').toBe(null);
    expect(health.unreleasedEntries, 'zero').toBe(0);
    cleanup(tmp);
  });

  test('every field is present on every path, so a tile always renders', () => {
    const tmp = mkTmp('tower-health-');
    const keys = (h) => Object.keys(h).sort().join(',');
    const expected = 'error,lastTag,uncommitted,unpushed,unreleasedEntries';
    expect(keys(repoHealth(mkRepo(tmp))), 'healthy repo').toBe(expected);
    expect(keys(repoHealth(path.join(tmp, 'nope'))), 'broken path').toBe(expected);
    cleanup(tmp);
  });
});
