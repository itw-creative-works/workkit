// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: command parsing, and the hardening of prefixed,
// wrapped and command-position spellings. Each case ports the HEAD case its
// name quotes; "no cwd" is a fact with an empty cwd now. Dropped with the
// shell mechanism: "a broken perl blocks only commands carrying the commit
// word" (the module strips quotes in JavaScript, with no perl to break).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, summary, selfRun } = require('../../lib/harness');
const {
  ELSEWHERE, T, mkRepo, stage, write, commit, touchMarker, judge, blocks, passes,
} = require('./helpers');

// A repo with app.js staged and no review marker: a gated commit blocks for review.
const codeStaged = () => {
  const r = mkRepo();
  stage(r, 'app.js', 'const x = 1;\n');
  return r;
};

// README.md staged, while tracked.js carries an unstaged edit an -a would take.
const docsWithTrackedEdit = () => {
  const r = mkRepo();
  stage(r, 'tracked.js', 'const x = 1;\n');
  commit(r);
  write(r, 'tracked.js', 'const x = 2;\n');
  stage(r, 'README.md', '# docs\n');
  return r;
};

const run = async () => {
  group('commit-gate: command parsing (review regressions)');

  await test('ports "command that only MENTIONS git commit: exit 0"', async () => {
    for (const c of ['echo "use git commit -m msg"', 'git log --grep=commit', 'echo how to git commit']) {
      passes(await judge(codeStaged(), c), '', `mention must not gate: ${c}`);
    }
  });

  await test('ports "commit followed by ; or && still gates: exit 2"', async () => {
    for (const c of ['git commit -m "x";', 'git commit -m "x"&&git push']) {
      blocks(await judge(codeStaged(), c), T.noReview, `chained commit must gate: ${c}`);
    }
  });

  await test('ports "flag-like words inside the message do not trigger -a: exit 0 for docs-only"', async () => {
    passes(await judge(docsWithTrackedEdit(), 'git commit -m "fix the -alpha bug"'), '', 'message text must not flip the -a branch');
  });

  await test('ports "git -C other-repo commit: exit 2 fail closed"', async () => {
    blocks(await judge(mkRepo(), 'git -C /somewhere/else commit -m "x"'), T.dashC, 'commits aimed at another repo must fail closed');
  });

  await test('ports "cd elsewhere && git commit: exit 2 fail closed"', async () => {
    blocks(await judge(mkRepo(), 'cd /somewhere/else && git commit -m "x"'), T.cd, 'directory-changing commits must fail closed');
  });

  await test('ports "pushd / popd elsewhere && git commit: exit 2 fail closed (issue #159)"', async () => {
    for (const c of ['pushd /somewhere/else && git commit -m "feat: x"',
      'pushd /somewhere/else >/dev/null && git commit -m "feat: x"',
      'popd && git commit -m "feat: x"']) {
      blocks(await judge(mkRepo(), c), T.cd, `directory-changing commits must fail closed: ${c}`);
    }
  });

  await test('ports "a commit whose session cwd is in no repo: exit 2 fail closed (issue #159)"', async () => {
    blocks(await judge(mkRepo(), 'git commit -m "feat: x"', { cwd: ELSEWHERE }), T.noRepo, 'a commit the gate cannot place must not pass');
  });

  await test('ports "a plain in-repo commit is untouched by the fail-closed (issue #159)"', async () => {
    const r = codeStaged();
    touchMarker(r);
    passes(await judge(r, 'git commit -m "feat: thing"'), '', 'a resolvable repo still passes');
  });

  await test('ports "a NON-commit command outside any repo stays silent (issue #159)"', async () => {
    passes(await judge(mkRepo(), 'ls -la && npm test', { cwd: ELSEWHERE }), '', 'no commit clause, no verdict');
  });

  await test('ports "pathspec commit with nothing staged: exit 2 (bypass closed)"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    commit(r);
    write(r, 'app.js', 'const x = 2;\n');
    blocks(await judge(r, 'git commit -m fix app.js'), T.noReview, 'pathspec commits bypass staging and are gated strictly');
  });

  await test('ports "MULTI-LINE quoted mention: exit 0 (_lib.sh unification)"', async () => {
    passes(await judge(codeStaged(), 'echo "todo list\ngit commit the fix later"'), '', 'multi-line quoted mentions are not commits');
  });

  await test('ports "quote character inside single quotes before a real commit: exit 2 (strip-ordering regression)"', async () => {
    blocks(await judge(codeStaged(), 'grep \'"\' notes.txt; git commit -m "feat: thing"'), T.noReview, 'the commit clause survives the quote strip');
  });

  await test('ports "heredoc BODY mentioning git commit: exit 0 (gotchas-sweep regression)"', async () => {
    const cmd = 'cat >> notes.md <<\'EOF\'\n- example: git add -A && git commit -m "x"\nEOF';
    passes(await judge(codeStaged(), cmd), '', 'heredoc bodies are not commands');
  });

  await test('ports "commit inside interpreter-fed heredoc still gates: exit 2 (light-review finding)"', async () => {
    const cmd = 'bash <<\'EOF\'\ngit commit -m "sneaky"\nEOF';
    blocks(await judge(codeStaged(), cmd), T.noReview, 'interpreter-fed heredoc bodies are commands and gate');
  });

  await test('ports "real commit with heredoc message still gates: exit 2"', async () => {
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nfeat: thing\n\nBody here.\nEOF\n)"';
    blocks(await judge(codeStaged(), cmd), T.noReview, 'the commit clause sits outside the heredoc body and gates');
  });

  group('commit-gate: prefixed and wrapped spellings (hardening 2026-07-25)');

  await test('ports "prefixed spellings still gate: command/env/path/subshell/group"', async () => {
    for (const c of ['command git commit -m "x"', 'env git commit -m "x"', '/usr/bin/git commit -m "x"', '(git commit -m "x")', '{ git commit -m "x"; }']) {
      blocks(await judge(codeStaged(), c), T.noReview, `must gate for the review reason: ${c}`);
    }
  });

  await test('ports "interpreter-string commit: exit 2 asking for the plain form"', async () => {
    for (const c of ['sh -c \'git commit -m "x"\'', 'bash -c "git commit -m x"', 'bash -lc "cd /x && git commit -m x"', 'eval "git commit -m x"']) {
      blocks(await judge(codeStaged(), c), T.wrapped, `must fail closed: ${c}`);
    }
  });

  await test('ports "interpreter string without a commit inside: exit 0"', async () => {
    for (const c of ['sh -c "echo hi"', 'bash -c "git status"']) {
      passes(await judge(codeStaged(), c), '', `not a commit: ${c}`);
    }
  });

  group('commit-gate: wrapper detection reads command position (review 2026-07-25)');

  await test('ports "a wrapped spelling inside DATA quotes does not block: grep pattern, --grep value"', async () => {
    for (const c of ['grep -n "sh -c \'git commit\'" file.txt', 'git log --grep "eval \'git commit\'"']) {
      passes(await judge(codeStaged(), c), '', `data, not a wrapper: ${c}`);
    }
  });

  await test('ports "a commit whose MESSAGE mentions a wrapped spelling gates normally"', async () => {
    const r = mkRepo();
    stage(r, 'README.md', '# docs\n');
    passes(await judge(r, 'git commit -m "fix: detect sh -c \'git commit\' wrappers"'), '', 'the -m span is data');
  });

  await test('ports "unquoted eval commit still gates: exit 2 (eval-peel regression)"', async () => {
    blocks(await judge(codeStaged(), 'eval git commit -m "x"'), T.noReview, 'gated normally, the flags are readable');
  });

  await test('ports "attached -c string still fails closed: exit 2 (no-space regression)"', async () => {
    for (const c of ['bash -c"git commit -m x"', 'sh -lc"git commit -m x"']) {
      blocks(await judge(codeStaged(), c), T.wrapped, `must fail closed: ${c}`);
    }
  });

  await test('ports "GIT_DIR / --git-dir / --work-tree aimed elsewhere: exit 2 fail closed"', async () => {
    for (const [c, text] of [
      ['GIT_DIR=/other/.git git commit -m "x"', T.sets('GIT_DIR')],
      ['git --git-dir=/other/.git commit -m "x"', T.uses('--git-dir')],
      ['git --git-dir /other/.git commit -m "x"', T.uses('--git-dir')],
      ['git --work-tree=/other commit -m "x"', T.uses('--work-tree')],
      ['env GIT_WORK_TREE=/other git commit -m "x"', T.sets('GIT_WORK_TREE')],
    ]) {
      blocks(await judge(mkRepo(), c), text, `must fail closed: ${c}`);
    }
  });

  await test('ports "the subcommand must be commit: log/show/diff with a commit argument pass"', async () => {
    for (const c of ['git log --grep commit', 'git show commit', 'git diff commit -- app.js']) {
      passes(await judge(codeStaged(), c), '', `not a commit: ${c}`);
    }
  });

  await test('ports "a glob token in the clause is not expanded against the process cwd (set -f)": -? is not -a', async () => {
    passes(await judge(docsWithTrackedEdit(), 'git commit -m "docs" -?'), '', 'docs-only commit, the glob token read as written');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
