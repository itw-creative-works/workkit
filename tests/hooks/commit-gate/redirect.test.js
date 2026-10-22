// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: a shell redirect after the commit clause is
// syntax, never a pathspec, so it never gates a docs-only commit as code.
// Each case ports the HEAD case its name quotes; every HEAD case's mechanism
// survives.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const {
  T, NOTICE, mkRepo, stage, write, judge, blocks, passes, suiteRan, pkg, mkReleaseRepo,
} = require('./helpers');

const docsStaged = () => {
  const r = mkRepo();
  stage(r, 'README.md', '# docs\n');
  return r;
};

const run = async () => {
  group('commit-gate: a redirect is shell syntax, never a pathspec');

  await test('ports "a docs-only commit with a redirect passes"', async () => {
    for (const redirect of ['2>&1', '> out.txt', '>> log.txt', '2> err.txt', '>"out.txt"', '&> all.txt']) {
      passes(await judge(docsStaged(), `git commit -m docs ${redirect}`), '', `${redirect} allowed as docs-only`);
    }
  });

  await test('ports "a here-string message is fed by a bare <<<, never a pathspec"', async () => {
    passes(await judge(docsStaged(), 'git commit -F - <<< "msg"'), '', 'a docs-only index with no marker passes');
  });

  await test('ports "a heredoc-fed -F - commit is judged on its index"', async () => {
    passes(await judge(docsStaged(), "git commit -F - <<'EOF'\ndocs: note\n\nBody here.\nEOF"), '', 'a docs-only index with no marker passes');
  });

  await test('ports "a real pathspec after a redirect is still a pathspec"', async () => {
    for (const redirect of ['2>&1', '> out.txt']) {
      const r = docsStaged();
      write(r, 'app.js', 'const x = 1;\n');
      blocks(await judge(r, `git commit -m docs ${redirect} app.js`), T.noReview, `${redirect} then app.js blocked for the review reason`);
    }
  });

  await test('ports "a version-only release commit piped through tail passes with no marker"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'package.json', pkg('1.2.3'));
    passes(await judge(r, 'git commit -m "chore(release): 1.2.3" 2>&1 | tail -2'), NOTICE.noCode, 'the release commit\'s shape passes');
    assert(!suiteRan(r), 'the version stamp is bookkeeping, not code');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
