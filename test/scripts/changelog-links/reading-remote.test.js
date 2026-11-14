// Tests for workflow/changelog/changelog-links.js, the release-time CHANGELOG backfill:
// reading the origin remote into the GitHub slug its links are built from.
// The shared prologue is ./helpers.js.

const { describe, test, expect, mkTmp } = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  repoSlug, cleanup, git,
} = require('./helpers');

describe('changelog-links: reading the remote', { skip: skipWithoutNodeStub() }, () => {
  test('parses both GitHub remote URL forms, and rejects others', () => {
    const dir = mkTmp('cll-');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:alice/.dotfiles.git');
    expect(repoSlug(dir), 'ssh form').toBe('alice/.dotfiles');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles.git');
    expect(repoSlug(dir), 'https form').toBe('alice/.dotfiles');
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/alice/x.git');
    expect(repoSlug(dir), 'a non-GitHub remote has nothing to link to').toBe(null);
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles/');
    expect(repoSlug(dir), 'a trailing slash is tolerated').toBe('alice/.dotfiles');
    git(dir, 'remote', 'remove', 'origin');
    expect(repoSlug(dir), 'no origin remote resolves to no slug').toBe(null);
    cleanup(dir);
  });

  test('the slug comes from the engine rule, behind a GitHub-only gate', () => {
    // repoSlug reads `slugFromRemote` (workflow/slug.js), so every trailing
    // separator comes off, not one. The links are GitHub's, so a remote
    // anywhere else has nothing to link to.
    const dir = mkTmp('cll-');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'remote', 'add', 'origin', 'https://github.com/alice/.dotfiles//');
    expect(repoSlug(dir), 'every trailing slash, not one').toBe('alice/.dotfiles');
    git(dir, 'remote', 'set-url', 'origin', 'https://github.com/alice/.dotfiles/');
    expect(repoSlug(dir), 'and one is still tolerated').toBe('alice/.dotfiles');
    git(dir, 'remote', 'set-url', 'origin', 'C:\\Users\\x\\theirs.git');
    expect(repoSlug(dir), 'a local path names a repo, but not one on GitHub').toBe(null);
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/alice/x.git');
    expect(repoSlug(dir), 'and neither does another host').toBe(null);
    cleanup(dir);
  });
});
