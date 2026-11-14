// Tests for workflow/lib/git.js: `repoRoot(cwd)` and `headSha(cwd)`, the git
// reads the kit's JavaScript scripts share. Every case asks a real git about a
// real folder in scratch; the expected answer is read from the folder itself
// (its real path, its branch's ref file), never git's answer read back.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { gitPath } = require('../lib/platform');
const { mkRepo, mkOriginRepo, FIXTURE_ORIGIN } = require('../lib/git-repo');
const { repoRoot, headSha } = require('../../workflow/lib/git');

describe('lib/git.js: repoRoot', () => {
  test('inside a repo, from its root or a subfolder, it answers the top level, trimmed', () => {
    const repo = mkOriginRepo(mkTmp('lib-git-repo-'), FIXTURE_ORIGIN);
    const sub = path.join(repo, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    const top = gitPath(fs.realpathSync.native(repo));
    expect(repoRoot(repo), 'from the root, the top level with no trailing newline').toBe(top);
    expect(repoRoot(sub), 'and from a subfolder two levels down, the same top level').toBe(top);
  });

  test('a folder outside any repo answers null', () => {
    expect(repoRoot(mkTmp('lib-git-plain-')), 'a plain scratch folder is in no repo').toBe(null);
  });

  test('a folder that does not exist answers null', () => {
    expect(repoRoot(path.join(mkTmp('lib-git-gone-'), 'missing')), 'a missing path is in no repo').toBe(null);
  });
});

describe('lib/git.js: headSha', () => {
  test('in a committed repo, from a subfolder, it answers the branch tip, trimmed', () => {
    const g = mkRepo('lib-git-head-', { 'a/b/.keep': '' });
    const tip = fs.readFileSync(path.join(g.repo, '.git', 'refs', 'heads', 'main'), 'utf8').trim();
    expect(headSha(path.join(g.repo, 'a', 'b')), 'the full sha the main ref file holds').toBe(tip);
  });

  test('a repo with no commit, or a folder outside any repo, answers null', () => {
    expect(headSha(mkOriginRepo(mkTmp('lib-git-empty-'), FIXTURE_ORIGIN)), 'an unborn HEAD has no sha').toBe(null);
    expect(headSha(mkTmp('lib-git-plain-')), 'a plain scratch folder is in no repo').toBe(null);
  });
});
