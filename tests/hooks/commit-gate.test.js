/* eslint-disable no-console */
//
// Tests for hooks/safety/commit-gate — the PreToolUse hook that gates every
// `git commit`: code commits need a fresh workkit:review marker, and repos
// with a test script need the suite green.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'commit-gate', 'run.sh');
// The gate's CHANGELOG check resolves the engine by path; point it at this
// checkout so the suite tests the code under review, not the installed copy.
const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');
const LIB = path.join(__dirname, '..', '..', 'hooks', '_lib.sh');

const mkRepo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-test-'));
  execSync('git init && git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
};

const stage = (dir, name, content) => {
  fs.writeFileSync(path.join(dir, name), content);
  execSync(`git add "${name}"`, { cwd: dir, stdio: 'pipe' });
};

const markerPath = (dir) => {
  const hash = execSync('printf \'%s\' "$(git rev-parse --show-toplevel)" | shasum | cut -d\' \' -f1',
    { cwd: dir, encoding: 'utf8' }).trim();
  const mdir = path.join(process.env.TMPDIR || '/tmp', 'claude-review-marker');
  fs.mkdirSync(mdir, { recursive: true });
  return path.join(mdir, hash);
};

const touchMarker = (dir) => fs.writeFileSync(markerPath(dir), '');
const dropMarker = (dir) => { try { fs.rmSync(markerPath(dir)); } catch {} };

const runHook = (cwd, command, spawnCwd) => {
  const input = JSON.stringify({ cwd, tool_input: { command } });
  const res = spawnSync('bash', [HOOK], {
    input,
    cwd: spawnCwd,
    env: { ...process.env, HOME: os.homedir(), WORKFLOW_DIR },
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const cleanup = (dir) => { dropMarker(dir); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const run = async () => {
  group('commit-gate: scope');

  await test('non-commit command — exit 0', () => {
    const dir = mkRepo();
    const { code } = runHook(dir, 'git status && npm test');
    assertEq(code, 0, 'only commits are gated');
    cleanup(dir);
  });

  await test('commit with nothing staged — exit 0 (git will fail it anyway)', () => {
    const dir = mkRepo();
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, 'empty commits pass through');
    cleanup(dir);
  });

  group('commit-gate: review marker');

  await test('staged code, no review marker — exit 2 naming workkit:review', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 2, 'unreviewed code commit must block');
    assert(stderr.includes('workkit:review'), 'tells the agent what to run');
    cleanup(dir);
  });

  await test('staged code + fresh marker — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 0, `reviewed commit passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('docs-only staged, no marker — exit 0 (review not required)', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code } = runHook(dir, 'git commit -m "docs"');
    assertEq(code, 0, 'docs-only commits skip the review requirement');
    cleanup(dir);
  });

  await test('marker OLDER than the last commit — exit 2 (stale review)', () => {
    const dir = mkRepo();
    touchMarker(dir);
    const past = new Date(Date.now() - 3600 * 1000);
    fs.utimesSync(markerPath(dir), past, past);
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m "feat"');
    assertEq(code, 2, 'a marker from before the last commit must not count');
    assert(stderr.includes('predates'), 'explains staleness');
    cleanup(dir);
  });

  await test('-a flag counts modified tracked files — exit 2 without marker', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    execSync('git commit -m "add app"', { cwd: dir, stdio: 'pipe' });
    dropMarker(dir);
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    const { code } = runHook(dir, 'git commit -am "tweak"');
    assertEq(code, 2, '-a commits are classified from modified tracked files');
    cleanup(dir);
  });

  group('commit-gate: tests must pass');

  await test('failing test script — exit 2 with output tail', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"echo BOOM && exit 1"}}');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'red suite must block the commit');
    assert(stderr.includes('BOOM'), 'carries the failure output');
    cleanup(dir);
  });

  await test('passing test script + marker — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `green suite + review passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: new source files need tests (test-TYPE proxy)');

  await test('new .js file, no test file staged — exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'new source without tests must block');
    assert(stderr.includes('test file'), 'names the missing tests');
    assert(stderr.includes('thing.js'), 'names the offending file');
    cleanup(dir);
  });

  await test('new .js file WITH a test file staged — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    stage(dir, 'thing.test.js', 'require("./thing");\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `test file present → passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('new .js file in a repo with NO test script — proxy skipped, exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, 'repos without a test script are not asked to start here');
    cleanup(dir);
  });

  await test('MODIFIED .js file (not added) — proxy skipped, exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    execSync('git commit -m "seed" --no-verify', { cwd: dir, stdio: 'pipe' });
    stage(dir, 'thing.js', 'module.exports = 2;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `only ADDED files trigger the proxy, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('commit from a SUBDIRECTORY is gated identically (review regression)', () => {
    // package.json and npm test are judged at the repo ROOT, not the session
    // cwd — a session sitting in repo/src must not slip past the proxy.
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    fs.mkdirSync(path.join(dir, 'src'));
    touchMarker(dir);
    const { code, stderr } = runHook(path.join(dir, 'src'), 'git commit -m "x"');
    assertEq(code, 2, 'subdir cwd must not skip the proxy');
    assert(stderr.includes('test file'), 'same proxy message as from the root');
    cleanup(dir);
  });

  await test('staged test-file DELETION does not satisfy the proxy (review regression)', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    fs.mkdirSync(path.join(dir, 'tests'));
    stage(dir, 'tests/old.test.js', 'x;\n');
    execSync('git commit -m "seed" --no-verify', { cwd: dir, stdio: 'pipe' });
    execSync('git rm -q tests/old.test.js', { cwd: dir, stdio: 'pipe' });
    stage(dir, 'thing.js', 'module.exports = 1;\n');
    touchMarker(dir);
    const { code } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 2, 'a deleted test file is not "touching tests"');
    cleanup(dir);
  });

  await test('new config/test-named files are exempt — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'package.json', '{"scripts":{"test":"exit 0"}}');
    stage(dir, 'eslint.config.mjs', 'export default [];\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "x"');
    assertEq(code, 0, `config files need no tests, stderr: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: command parsing (review regressions)');

  await test('command that only MENTIONS git commit — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['echo "use git commit -m msg"', 'git log --grep=commit', 'echo how to git commit']) {
      const { code } = runHook(dir, c);
      assertEq(code, 0, `mention must not gate: ${c}`);
    }
    cleanup(dir);
  });

  await test('commit followed by ; or && still gates — exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['git commit -m "x";', 'git commit -m "x"&&git push']) {
      const { code } = runHook(dir, c);
      assertEq(code, 2, `chained commit must gate: ${c}`);
    }
    cleanup(dir);
  });

  await test('flag-like words inside the message do not trigger -a — exit 0 for docs-only', () => {
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 1;\n');
    execSync('git add tracked.js && git commit -m "track" && git checkout -- . 2>/dev/null || true', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 2;\n');
    const { code } = runHook(dir, 'git commit -m "fix the -alpha bug"');
    assertEq(code, 0, 'message text must not flip the -a branch');
    cleanup(dir);
  });

  await test('git -C other-repo commit — exit 2 fail closed', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'git -C /somewhere/else commit -m "x"');
    assertEq(code, 2, 'commits aimed at another repo must fail closed');
    assert(stderr.includes('-C'), 'explains the -C rule');
    cleanup(dir);
  });

  await test('cd elsewhere && git commit — exit 2 fail closed', () => {
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'cd /somewhere/else && git commit -m "x"');
    assertEq(code, 2, 'directory-changing commits must fail closed');
    assert(stderr.includes('changes directory'), 'explains the cd rule');
    cleanup(dir);
  });

  await test('pathspec commit with nothing staged — exit 2 (bypass closed)', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    execSync('git add app.js && git commit -m "add"', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 2;\n');
    dropMarker(dir);
    const { code } = runHook(dir, 'git commit -m fix app.js');
    assertEq(code, 2, 'pathspec commits bypass staging and must be gated strictly');
    cleanup(dir);
  });

  await test('MULTI-LINE quoted mention — exit 0 (_lib.sh unification)', () => {
    // The gate's old line-based sed strip left the tail lines of a multi-line
    // quoted string looking unquoted; the shared hooks/_lib.sh strip is
    // multiline perl, same as the commit-language hook.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const { code } = runHook(dir, 'echo "todo list\ngit commit the fix later"');
    assertEq(code, 0, 'multi-line quoted mentions are not commits');
    cleanup(dir);
  });

  await test('quote character inside single quotes before a real commit — exit 2 (strip-ordering regression)', () => {
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

  await test('heredoc BODY mentioning git commit — exit 0 (gotchas-sweep regression)', () => {
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

  await test('commit inside interpreter-fed heredoc still gates — exit 2 (light-review finding)', () => {
    // A heredoc body piped INTO a shell is executed code — stripping it
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

  await test('real commit with heredoc message still gates — exit 2', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    dropMarker(dir);
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nfeat: thing\n\nBody here.\nEOF\n)"';
    const { code } = runHook(dir, cmd);
    assertEq(code, 2, 'the commit clause sits outside the heredoc body and must gate');
    cleanup(dir);
  });

  group('commit-gate: prefixed and wrapped spellings (hardening 2026-07-25)');

  await test('prefixed spellings still gate — command/env/path/subshell/group', () => {
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

  await test('interpreter-string commit — exit 2 asking for the plain form', () => {
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

  await test('interpreter string without a commit inside — exit 0', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    for (const c of ['sh -c "echo hi"', 'bash -c "git status"']) {
      const { code } = runHook(dir, c);
      assertEq(code, 0, `not a commit: ${c}`);
    }
    cleanup(dir);
  });

  group('commit-gate: wrapper detection reads command position (review 2026-07-25)');

  await test('a wrapped spelling inside DATA quotes does not block — grep pattern, --grep value', () => {
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
    // `git commit`, which is exactly what they were running — only rewording
    // the message escaped. A docs-only commit passing proves the message span
    // never reaches the wrapper test.
    const dir = mkRepo();
    stage(dir, 'README.md', '# docs\n');
    const { code, stderr } = runHook(dir, 'git commit -m "fix: detect sh -c \'git commit\' wrappers"');
    assertEq(code, 0, `the -m span is data, got: ${stderr}`);
    cleanup(dir);
  });

  await test('unquoted eval commit still gates — exit 2 (eval-peel regression)', () => {
    // `eval git commit -m x` executes the words essentially as written, but
    // eval was not peeled, so the clause scan never saw git in first position
    // and the whole gate was skipped.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'eval git commit -m "x"');
    assertEq(code, 2, `must gate, got: ${stderr}`);
    assert(stderr.includes('review'), `gated normally — the flags are readable: ${stderr}`);
    cleanup(dir);
  });

  await test('attached -c string still fails closed — exit 2 (no-space regression)', () => {
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
      const real = execSync(`command -v ${tool} || true`, { encoding: 'utf8', shell: '/bin/bash' }).trim();
      if (real) fs.symlinkSync(real, path.join(bin, tool));
    }
    fs.writeFileSync(path.join(bin, 'perl'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });
    const dir = mkRepo();
    const runBroken = (command) => spawnSync('bash', [HOOK], {
      input: JSON.stringify({ cwd: dir, tool_input: { command } }),
      env: { PATH: bin, HOME: os.homedir() },
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

  await test('GIT_DIR / --git-dir / --work-tree aimed elsewhere — exit 2 fail closed', () => {
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

  await test('the subcommand must be commit — log/show/diff with a commit argument pass', () => {
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
    execSync('git add tracked.js && git commit -m "track" --no-verify', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'tracked.js'), 'const x = 2;\n');
    stage(dir, 'README.md', '# docs\n');
    fs.writeFileSync(path.join(dir, '-a'), '');
    const { code, stderr } = runHook(dir, 'git commit -m "docs" -?', dir);
    assertEq(code, 0, `docs-only commit, glob left unexpanded, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: wiring (loader + settings)');

  const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');

  await test('loader routes safety:commit-gate to the script (colon spelling)', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const input = JSON.stringify({ cwd: dir, tool_input: { command: 'git commit -m "x"' } });
    const res = spawnSync('bash', [LOADER, 'safety:commit-gate'], {
      input,
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 60000,
    });
    assertEq(res.status, 2, 'the loader must reach the gate and propagate its block');
    assert((res.stderr || '').includes('workkit:review'), 'the gate answered, not the loader fail-open');
    cleanup(dir);
  });

  group('commit-gate: a quoted message never hides a pathspec (issue #25)');

  await test('quoted and unquoted pathspec commits gate identically', () => {
    // The quoted message used to be DELETED from the detection copy, leaving
    // -m to consume the pathspec — so the file list read as empty and the gate
    // skipped every check, review and tests included.
    for (const message of ['"docs"', 'docs']) {
      const dir = mkRepo();
      fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
      const { code, stderr } = runHook(dir, `git commit -m ${message} app.js`);
      assertEq(code, 2, `${message} form blocked, got: ${stderr}`);
      assert(stderr.includes('review'), `for the review reason, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a quoted message with nothing staged is still not a pathspec commit', () => {
    // The placeholder must not itself read as a file argument.
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'git commit -m "just a message"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a value-taking flag does not have its value read as a pathspec', () => {
    // Once quoted spans became visible tokens, any flag missing from the walk's
    // skip list had its value counted as a file — which forced a docs-only
    // commit to be gated as code and blocked for a missing review.
    for (const flag of ['--author "Jane Doe <j@d.c>"', '--date "2020-01-01"', '--trailer "Co-Authored-By: X <x@y.z>"']) {
      const dir = mkRepo();
      stage(dir, 'README.md', '# docs\n');
      const { code, stderr } = runHook(dir, `git commit -m "docs" ${flag}`);
      assertEq(code, 0, `${flag} allowed, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a short flag with its value attached does not swallow the pathspec', () => {
    // `-m"docs"` arrives as one token whose value is already attached, so it
    // must not consume the next token the way a bare `-m` does.
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m"docs" app.js');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  await test('an empty quote pair spliced into the command still gates', () => {
    // Deleting an empty span rejoins the text around it; a placeholder would
    // not, and `git com""mit` is a real command that must stay detectable.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git com""mit -m "x"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  group('commit-gate: CHANGELOG entry format');

  // The gate is the authority for the format: the docs/changelog-guard hook
  // sees only writes made through the tools, and everything reaches git here.
  const CHANGELOG = (...bullets) => [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    ...bullets.flatMap((b) => [b, '']),
  ].join('\n');
  const ISSUE = '[#4](https://github.com/o/r/issues/4)';

  await test('a staged essay entry blocks the commit', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG(`- **An essay entry.** ${new Array(60).fill('word').join(' ')}`));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 2, 'blocked');
    assert(stderr.includes('word-cap'), `names the rule, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a staged entry in the format commits', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} — Plugins install from settings.json.`));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a legacy entry the commit did not touch does not block', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.'));
    execSync('git commit -q -m "legacy" --no-verify', { cwd: dir, stdio: 'pipe' });
    stage(dir, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.', `- ${ISSUE} — A new entry.`));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a -am commit is judged from the working tree, which is what it carries', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG());
    execSync('git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe' });
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG('- An unstaged essay entry with no issue link.'));
    const { code, stderr } = runHook(dir, 'git commit -am "docs: changelog"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a CRLF CHANGELOG is judged, not waved through', () => {
    // The parser used to read a CRLF file as zero entries, so the gate passed
    // anything in it — a guard failing open in silence.
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG('- an essay entry with no issue link.').replace(/\n/g, '\r\n'));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a pathspec commit still has its CHANGELOG judged', () => {
    // Pathspec commits bypass staging, so the file list is unknowable; the gate
    // treats them strictly everywhere else and must here too.
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG('- an essay entry with no issue link.'));
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m docs CHANGELOG.md');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('CHANGELOG'), `for the CHANGELOG reason, got: ${stderr}`);
    cleanup(dir);
  });

  // The marker check compares timestamps, so reading an mtime must survive both
  // stat dialects. GNU's `-f` selects filesystem status, where `%m` is
  // undefined: `stat -f %m` prints `?` and EXITS 0 there, so a plain `||` chain
  // starting with the BSD spelling hands back a non-numeric string and every
  // comparison against it silently passes. Each PATH below offers one dialect
  // only, proving the helper picks the spelling that actually answers.
  await test('reads a file mtime under either stat dialect', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtime-'));
    const file = path.join(dir, 'f');
    fs.writeFileSync(file, 'x');
    const when = 1600000000;
    fs.utimesSync(file, when, when);

    const readWith = (dialect) => {
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statbin-'));
      // BSD: -c is unknown, so it errors out. GNU: -f is filesystem status,
      // which answers `?` for %m and exits 0 — the trap this helper avoids.
      const script = dialect === 'bsd'
        ? `#!/bin/sh\ncase "$1" in -c) echo "stat: illegal option" >&2; exit 1 ;; -f) echo ${when}; exit 0 ;; esac\nexit 1\n`
        : `#!/bin/sh\ncase "$1" in -f) echo '?'; exit 0 ;; -c) echo ${when}; exit 0 ;; esac\nexit 1\n`;
      fs.writeFileSync(path.join(binDir, 'stat'), script, { mode: 0o755 });
      const res = spawnSync('bash', ['-c',
        `. "${LIB}" && hook_file_mtime "${file}"`],
      { encoding: 'utf8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } });
      fs.rmSync(binDir, { recursive: true, force: true });
      return res.stdout.trim();
    };

    assertEq(readWith('gnu'), String(when), 'GNU: skips the `?` from -f and uses -c');
    assertEq(readWith('bsd'), String(when), 'BSD: falls past the unknown -c to -f');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('hooks.json registers the gate under PreToolUse Bash', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const bashEntries = settings.hooks.PreToolUse.filter((e) => e.matcher === 'Bash');
    const wired = bashEntries.some((e) => e.hooks.some((h) => h.command.includes('safety:commit-gate')));
    assert(wired, 'safety:commit-gate is registered on PreToolUse Bash');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
