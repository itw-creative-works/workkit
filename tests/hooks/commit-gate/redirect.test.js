//
// Tests for hooks/safety/commit-gate: a shell redirect after the commit clause
// is syntax, never a pathspec, so it never gates a docs-only commit as code.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipWithoutDigest, mkRepo, stage, dropMarker, runHook, cleanup, pkg, suiteRan, mkReleaseRepo } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: a redirect is shell syntax, never a pathspec');

  await test('a docs-only commit with a redirect passes', () => {
    for (const redirect of ['2>&1', '> out.txt', '>> log.txt', '2> err.txt', '>"out.txt"', '&> all.txt']) {
      const dir = mkRepo();
      stage(dir, 'README.md', '# docs\n');
      const { code, stderr } = runHook(dir, `git commit -m docs ${redirect}`);
      assertEq(code, 0, `${redirect} allowed as docs-only, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a here-string message is fed by a bare <<<, never a pathspec', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git commit -F - <<< "msg"');
    assertEq(code, 0, `a docs-only index with no marker passes, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a heredoc-fed -F - commit is judged on its index', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, "git commit -F - <<'EOF'\ndocs: note\n\nBody here.\nEOF");
    assertEq(code, 0, `a docs-only index with no marker passes, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a real pathspec after a redirect is still a pathspec', () => {
    for (const redirect of ['2>&1', '> out.txt']) {
      const dir = mkRepo();
      stage(dir, 'README.md', '# docs\n');
      fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
      const { code, stderr } = runHook(dir, `git commit -m docs ${redirect} app.js`);
      assertEq(code, 2, `${redirect} then app.js blocked, got: ${stderr}`);
      assert(stderr.includes('review'), `for the review reason, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a version-only release commit piped through tail passes with no marker', () => {
    // A release commit piped through tail is bookkeeping, never code: its
    // redirect is no pathspec, so the version stamp needs no review marker.
    const dir = mkReleaseRepo();
    stage(dir, 'package.json', pkg('1.2.3'));
    dropMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "chore(release): 1.2.3" 2>&1 | tail -2');
    assertEq(code, 0, `the release commit's shape passes, got: ${stderr}`);
    assert(!suiteRan(dir), 'the version stamp is bookkeeping, not code');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
