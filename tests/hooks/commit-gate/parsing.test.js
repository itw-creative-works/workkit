//
// Tests for hooks/safety/commit-gate: command parsing, and the hardening of
// prefixed, wrapped and command-position spellings.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath, which, linkTool, stubTool } = require('../../lib/platform');
const { skipWithoutDigest, HOOK, WORKFLOW_DIR, TMP, mkRepo, stage, touchMarker, dropMarker, runHook, cleanup } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: command parsing (review regressions)');

  await test('command that only MENTIONS git commit: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['echo "use git commit -m msg"', 'git log --grep=commit', 'echo how to git commit']) {
      const { code } = runHook(dir, c);
      assertEq(code, 0, `mention must not gate: ${c}`);
    }
    cleanup(dir);
  });

  await test('commit followed by ; or && still gates: exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['git commit -m "x";', 'git commit -m "x"&&git push']) {
      const { code } = runHook(dir, c);
      assertEq(code, 2, `chained commit must gate: ${c}`);
    }
    cleanup(dir);
  });

  await test('flag-like words inside the message do not trigger -a: exit 0 for docs-only', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 1;\n');
    execSync('git add tracked.js && git commit -m "track" && git checkout -- . 2>/dev/null || true', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 2;\n');
    const { code } = runHook(dir, 'git commit -m "fix the -alpha bug"');
    assertEq(code, 0, 'message text must not flip the -a branch');
    cleanup(dir);
  });

  await test('git -C other-repo commit: exit 2 fail closed', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'git -C /somewhere/else commit -m "x"');
    assertEq(code, 2, 'commits aimed at another repo must fail closed');
    assert(stderr.includes('-C'), 'explains the -C rule');
    cleanup(dir);
  });

  await test('cd elsewhere && git commit: exit 2 fail closed', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'cd /somewhere/else && git commit -m "x"');
    assertEq(code, 2, 'directory-changing commits must fail closed');
    assert(stderr.includes('changes directory'), 'explains the cd rule');
    cleanup(dir);
  });

  await test('pushd / popd elsewhere && git commit: exit 2 fail closed (issue #159)', () => {
    // pushd does the same repo-addressing job as cd and used to pass the
    // detector outright, which is half of the combination that landed a commit
    // through the gate with none of its checks applied.
    for (const c of ['pushd /somewhere/else && git commit -m "feat: x"',
      'pushd /somewhere/else >/dev/null && git commit -m "feat: x"',
      'popd && git commit -m "feat: x"']) {
      const dir = mkRepo();
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `directory-changing commits must fail closed: ${c}, got: ${stderr}`);
      assert(stderr.includes('changes directory'), `explains the rule: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a commit whose session cwd is in no repo: exit 2 fail closed (issue #159)', () => {
    // The other half: a session sitting outside any repo (a background subagent's
    // steady state) resolved no toplevel, so the gate stood down entirely.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-norepo-'));
    const { code, stderr } = runHook(outside, 'git commit -m "feat: x"');
    assertEq(code, 2, `a commit the gate cannot place must not pass, got: ${stderr}`);
    assert(stderr.includes('not inside a git repository'), `names the reason, got: ${stderr}`);
    assert(stderr.includes('cd into the repo'), `and names the fix, got: ${stderr}`);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  await test('a plain in-repo commit is untouched by the fail-closed (issue #159)', () => {
    // The control for the two cases above: the ordinary shape still passes, so
    // the new block is scoped to a cwd that resolves no repo.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: thing"');
    assertEq(code, 0, `a resolvable repo still passes, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a NON-commit command outside any repo stays silent (issue #159)', () => {
    // The fail-closed sits after the commit-clause test, so ordinary Bash in a
    // scratch directory hears nothing.
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-norepo-'));
    const out = runHook(outside, 'ls -la && npm test');
    assertEq(out.code, 0, `no commit clause, no verdict, got: ${out.stderr}`);
    assertEq(out.stderr, '', 'and no message at all');
    fs.rmSync(outside, { recursive: true, force: true });
  });

  await test('a payload carrying NO cwd still fails open: exit 0 (issue #159)', () => {
    // The one thing the fail-closed deliberately does not cover: with no cwd in
    // the payload the gate is blind to WHERE the command runs, which is the
    // hook's own defect rather than a command shape an agent can write, and
    // blocking there would wedge every commit with nothing that could clear it.
    const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ tool_input: { command: 'git commit -m "feat: x"' } }),
      env: { ...process.env, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP), WORKFLOW_DIR: shellPath(WORKFLOW_DIR) },
      encoding: 'utf8',
      timeout: 60000,
    });
    assertEq(res.status, 0, `no cwd → fail open, got: ${res.stderr}`);
  });

  await test('pathspec commit with nothing staged: exit 2 (bypass closed)', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    execSync('git add app.js && git commit -m "add"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    dropMarker(dir);
    const { code } = runHook(dir, 'git commit -m fix app.js');
    assertEq(code, 2, 'pathspec commits bypass staging and must be gated strictly');
    cleanup(dir);
  });

  await test('MULTI-LINE quoted mention: exit 0 (_lib.sh unification)', () => {
    // The gate's old line-based sed strip left the tail lines of a multi-line
    // quoted string looking unquoted; the shared hooks/lib/commit.sh strip is
    // multiline perl, same as the commit-language hook.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const { code } = runHook(dir, 'echo "todo list\ngit commit the fix later"');
    assertEq(code, 0, 'multi-line quoted mentions are not commits');
    cleanup(dir);
  });

  await test('quote character inside single quotes before a real commit: exit 2 (strip-ordering regression)', () => {
    // Stripping double-quoted spans before single-quoted ones let the `"` in
    // `grep '"'` pair with the commit message's opening quote and swallow the
    // git commit clause; the strip must be one left-to-right alternation.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const { code } = runHook(dir, 'grep \'"\' notes.txt; git commit -m "feat: thing"');
    assertEq(code, 2, 'the commit clause must survive the quote strip and gate');
    cleanup(dir);
  });

  await test('heredoc BODY mentioning git commit: exit 0 (gotchas-sweep regression)', () => {
    // A `cat >> file <<EOF` whose body holds a literal `git commit` example
    // was clause-split like top-level code and blocked as a real commit.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const cmd = 'cat >> notes.md <<\'EOF\'\n- example: git add -A && git commit -m "x"\nEOF';
    const { code } = runHook(dir, cmd);
    assertEq(code, 0, 'heredoc bodies are not commands');
    cleanup(dir);
  });

  await test('commit inside interpreter-fed heredoc still gates: exit 2 (light-review finding)', () => {
    // A heredoc body piped INTO a shell is executed code: stripping it
    // before detection opened a bypass. The strip must skip commands whose
    // heredoc feeds an interpreter.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const cmd = 'bash <<\'EOF\'\ngit commit -m "sneaky"\nEOF';
    const { code } = runHook(dir, cmd);
    assertEq(code, 2, 'interpreter-fed heredoc bodies are commands and must gate');
    cleanup(dir);
  });

  await test('real commit with heredoc message still gates: exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nfeat: thing\n\nBody here.\nEOF\n)"';
    const { code } = runHook(dir, cmd);
    assertEq(code, 2, 'the commit clause sits outside the heredoc body and must gate');
    cleanup(dir);
  });

  group('commit-gate: prefixed and wrapped spellings (hardening 2026-07-25)');

  await test('prefixed spellings still gate: command/env/path/subshell/group', () => {
    // Each of these first words walked past the old first-word-is-git test,
    // so the whole gate was skipped.
    for (const c of ['command git commit -m "x"', 'env git commit -m "x"', '/usr/bin/git commit -m "x"', '(git commit -m "x")', '{ git commit -m "x"; }']) {
      const dir = mkRepo();
      stage(dir, 'app.js', 'const x = 1;\n');
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `must gate: ${c}, got: ${stderr}`);
      assert(stderr.includes('review'), `for the review reason: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('interpreter-string commit: exit 2 asking for the plain form', () => {
    // The -c string argument is one quoted span; the quote strip replaced it
    // with a placeholder, so the commit inside was never seen.
    for (const c of ['sh -c \'git commit -m "x"\'', 'bash -c "git commit -m x"', 'bash -lc "cd /x && git commit -m x"', 'eval "git commit -m x"']) {
      const dir = mkRepo();
      stage(dir, 'app.js', 'const x = 1;\n');
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `must fail closed: ${c}, got: ${stderr}`);
      assert(stderr.includes('plain'), `asks for the plain form: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('interpreter string without a commit inside: exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['sh -c "echo hi"', 'bash -c "git status"']) {
      const { code } = runHook(dir, c);
      assertEq(code, 0, `not a commit: ${c}`);
    }
    cleanup(dir);
  });

  group('commit-gate: wrapper detection reads command position (review 2026-07-25)');

  await test('a wrapped spelling inside DATA quotes does not block: grep pattern, --grep value', () => {
    // The old detector ran its regex over the ORIGINAL text, so a quoted span
    // that merely mentions a wrapper read as one and blocked commands that
    // commit nothing at all.
    for (const c of [
      'grep -n "sh -c \'git commit\'" file.txt',
      'git log --grep "eval \'git commit\'"',
    ]) {
      const dir = mkRepo();
      stage(dir, 'app.js', 'const x = 1;\n');
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 0, `data, not a wrapper: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a commit whose MESSAGE mentions a wrapped spelling gates normally', () => {
    // The worst false positive: the block told the user to run a plain
    // `git commit`, which is exactly what they were running, only rewording
    // the message escaped. A docs-only commit passing proves the message span
    // never reaches the wrapper test.
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git commit -m "fix: detect sh -c \'git commit\' wrappers"');
    assertEq(code, 0, `the -m span is data, got: ${stderr}`);
    cleanup(dir);
  });

  await test('unquoted eval commit still gates: exit 2 (eval-peel regression)', () => {
    // `eval git commit -m x` executes the words essentially as written, but
    // eval was not peeled, so the clause scan never saw git in first position
    // and the whole gate was skipped.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'eval git commit -m "x"');
    assertEq(code, 2, `must gate, got: ${stderr}`);
    assert(stderr.includes('review'), `gated normally, the flags are readable: ${stderr}`);
    cleanup(dir);
  });

  await test('attached -c string still fails closed: exit 2 (no-space regression)', () => {
    // `bash -c"git commit -m x"` runs the string, but the old detector
    // demanded whitespace between the option cluster and the quotes.
    for (const c of ['bash -c"git commit -m x"', 'sh -lc"git commit -m x"']) {
      const dir = mkRepo();
      stage(dir, 'app.js', 'const x = 1;\n');
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `must fail closed: ${c}, got: ${stderr}`);
      assert(stderr.includes('plain'), `asks for the plain form: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a broken perl blocks only commands carrying the commit word (fail-closed scope)', () => {
    // A perl RUNTIME failure used to set the wrapped flag unconditionally, so
    // a machine with a broken perl blocked EVERY Bash command. The fail-closed
    // now applies the same coarse word test as the no-perl path.
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-perl-'));
    for (const tool of ['bash', 'cat', 'jq', 'dirname', 'grep', 'sed', 'tr', 'git']) {
      const real = which(tool);
      if (real) linkTool(bin, real);
    }
    stubTool(bin, 'perl', ['#!/bin/bash', 'exit 1']);
    const dir = mkRepo();
    const runBroken = (command) => spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
      input: JSON.stringify({ cwd: shellPath(dir), tool_input: { command } }),
      env: { PATH: bin, HOME: shellPath(os.homedir()), TMPDIR: shellPath(TMP) },
      encoding: 'utf8',
      timeout: 60000,
    });
    const plain = runBroken('ls -la');
    assertEq(plain.status, 0, `no commit word, no block, got: ${plain.stderr}`);
    const wrapped = runBroken("sh -c 'git commit -m x'");
    assertEq(wrapped.status, 2, `a genuine wrapped commit still fails closed, got: ${wrapped.stderr}`);
    cleanup(dir);
    try { fs.rmSync(bin, { recursive: true, force: true }); } catch {}
  });

  await test('GIT_DIR / --git-dir / --work-tree aimed elsewhere: exit 2 fail closed', () => {
    // These were detected as commits but judged against the cwd's staging, so
    // a commit aimed at another repo could pass on this repo's cleanliness.
    for (const c of ['GIT_DIR=/other/.git git commit -m "x"', 'git --git-dir=/other/.git commit -m "x"', 'git --git-dir /other/.git commit -m "x"', 'git --work-tree=/other commit -m "x"', 'env GIT_WORK_TREE=/other git commit -m "x"']) {
      const dir = mkRepo();
      const { code, stderr } = runHook(dir, c);
      assertEq(code, 2, `must fail closed: ${c}, got: ${stderr}`);
      assert(stderr.includes("repo's own directory"), `explains the wrong-repo rule: ${c}, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('the subcommand must be commit: log/show/diff with a commit argument pass', () => {
    // Any clause `git … commit …` used to read as a commit, so
    // `git log --grep commit` ran the FULL gate, npm test included.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['git log --grep commit', 'git show commit', 'git diff commit -- app.js']) {
      const { code } = runHook(dir, c);
      assertEq(code, 0, `not a commit: ${c}`);
    }
    cleanup(dir);
  });

  await test('a glob token in the clause is not expanded against the process cwd (set -f)', () => {
    // The token walk ran with globbing enabled: with a file named -a in the
    // hook process cwd, the unquoted token -? expanded to -a and flipped the
    // --all branch, pulling modified tracked code into a docs-only commit.
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 1;\n');
    execSync('git add tracked.js && git commit -m "track" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 2;\n');
    stage(dir, 'README.md', '# docs\n');
    fs.writeFileSync(path.join(dir, '-a'), '');
    const { code, stderr } = runHook(dir, 'git commit -m "docs" -?', dir);
    assertEq(code, 0, `docs-only commit, glob left unexpanded, got: ${stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
