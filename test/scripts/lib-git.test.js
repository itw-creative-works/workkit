// Tests for workflow/lib/git.js: `repoRoot(cwd)` and `headSha(cwd)`, the git
// reads the kit's JavaScript scripts share. Every case asks a real git about a
// real folder in scratch; the expected answer is read from the folder itself
// (its real path, its branch's ref file), never git's answer read back.

const fs = require('fs');
const path = require('path');
const { group, test, assertEq, summary, selfRun, mkTmp } = require('../lib/harness');
const { gitPath } = require('../lib/platform');
const { mkRepo, mkOriginRepo, FIXTURE_ORIGIN } = require('../lib/git-repo');
const { repoRoot, headSha } = require('../../workflow/lib/git');

const cases = async () => {
  group('lib/git.js: repoRoot');

  await test('inside a repo, from its root or a subfolder, it answers the top level, trimmed', () => {
    const repo = mkOriginRepo(mkTmp('lib-git-repo-'), FIXTURE_ORIGIN);
    const sub = path.join(repo, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    const top = gitPath(fs.realpathSync.native(repo));
    assertEq(repoRoot(repo), top, 'from the root, the top level with no trailing newline');
    assertEq(repoRoot(sub), top, 'and from a subfolder two levels down, the same top level');
  });

  await test('a folder outside any repo answers null', () => {
    assertEq(repoRoot(mkTmp('lib-git-plain-')), null, 'a plain scratch folder is in no repo');
  });

  await test('a folder that does not exist answers null', () => {
    assertEq(repoRoot(path.join(mkTmp('lib-git-gone-'), 'missing')), null, 'a missing path is in no repo');
  });

  group('lib/git.js: headSha');

  await test('in a committed repo, from a subfolder, it answers the branch tip, trimmed', () => {
    const g = mkRepo('lib-git-head-', { 'a/b/.keep': '' });
    const tip = fs.readFileSync(path.join(g.repo, '.git', 'refs', 'heads', 'main'), 'utf8').trim();
    assertEq(headSha(path.join(g.repo, 'a', 'b')), tip, 'the full sha the main ref file holds');
  });

  await test('a repo with no commit, or a folder outside any repo, answers null', () => {
    assertEq(headSha(mkOriginRepo(mkTmp('lib-git-empty-'), FIXTURE_ORIGIN)), null, 'an unborn HEAD has no sha');
    assertEq(headSha(mkTmp('lib-git-plain-')), null, 'a plain scratch folder is in no repo');
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
