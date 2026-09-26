//
// Tests for workflow/changelog-links.js, the release-time CHANGELOG backfill:
// reading the origin remote into the GitHub slug its links are built from.
// The shared prologue (the git and gh fixtures, the script runner, the Windows skip) is ./helpers.js.
//

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  skipOnWindows, repoSlug, mkTmp, cleanup, git,
} = require('./helpers');

const run = async () => {
  skipOnWindows();

  group('changelog-links: reading the remote');

  await test('parses both GitHub remote URL forms, and rejects others', () => {
    const dir = mkTmp();
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:alice/.dotfiles.git');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'ssh form');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles.git');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'https form');
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/alice/x.git');
    assertEq(repoSlug(dir), null, 'a non-GitHub remote has nothing to link to');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles/');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'a trailing slash is tolerated');
    git(dir, 'remote', 'remove', 'origin');
    assertEq(repoSlug(dir), null, 'no origin remote resolves to no slug');
    cleanup(dir);
  });

  await test('the slug comes from the engine rule, behind a GitHub-only gate', () => {
    // repoSlug reads `slugFromRemote` (workflow/slug.js) rather than parsing an
    // origin of its own, so it inherits EVERY trailing separator coming off,
    // not one. The gate above it stays: the links this file builds are
    // GitHub's, so a remote anywhere else has nothing to link to.
    const dir = mkTmp();
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', 'https://github.com/alice/.dotfiles//');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'every trailing slash, not one');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles/');
    assertEq(repoSlug(dir), 'alice/.dotfiles', 'and one is still tolerated');
    git(dir, 'remote', 'set-url', 'origin', 'C:\\Users\\x\\theirs.git');
    assertEq(repoSlug(dir), null, 'a local path names a repo, but not one on GitHub');
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/alice/x.git');
    assertEq(repoSlug(dir), null, 'and neither does another host');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
