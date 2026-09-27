/* eslint-disable no-console */
//
// Tests for hooks/_lib.sh, the helper library every hook sources: one group per
// helper, from the platform seam and hook_sha1 through hook_jq, the manager
// config, the changelog linter path, the notice, the deadline wait, the
// test-path shapes and the marker paths.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skip, testUnless, skipSuite, selfRun, summary,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, SYSTEM_BASH, SYSTEM_PATH, NO_RC, NO_EXEC_BIT,
  shellPath, which, digestTool, stubTool, crlfJq, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const LIB = shellPath(path.join(__dirname, '..', '..', 'hooks', '_lib.sh'));
const SHA1_ABC = 'a9993e364706816aba3e25717850c26c9cd0d89d';

// A tool this machine has, by absolute path, through the platform seam: the
// DIGEST lookups ask SYSTEM_PATH, the world the shims below are built against,
// so a case can ask what the helper does where only `sha1sum` exists without
// needing a GNU machine to ask it on. Everything else asks the session's own
// PATH, since jq is a Homebrew install on the Mac and a winget one under Git
// Bash: neither is in /usr/bin.

// A PATH world holding exactly one digest tool, under the name given.
const digestWorld = (name, real) => {
  const dir = mkTmp('lib-sha1-');
  // Under the NAME the case is asking about, which is the whole point: the tool
  // this machine ships, wearing the other machine's spelling.
  stubTool(dir, name, ['#!/bin/bash', `exec "${shellPath(real)}" "$@"`]);
  return dir;
};

// Run a snippet with hooks/_lib.sh sourced. bash is spawned by absolute path so
// a case can hand over a PATH holding nothing at all.
const runLib = (snippet, env = {}) => {
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${LIB}"\n${snippet}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const run = async () => {
  const real = digestTool(SYSTEM_PATH);
  if (!real) {
    skipSuite('this machine has neither shasum nor sha1sum, so no digest world can be built');
  }

  group('_lib.sh: hook_sha1');

  await test('a world with only shasum: the hex digest of stdin, no filename', () => {
    const world = digestWorld('shasum', real);
    const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
    assertEq(out.stdout.trim(), SHA1_ABC, `the sha1 of abc, got: ${out.stdout}|${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  await test('a world with only sha1sum: the same digest, same shape', () => {
    const world = digestWorld('sha1sum', real);
    const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
    assertEq(out.stdout.trim(), SHA1_ABC, `the sha1 of abc, got: ${out.stdout}|${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  await test('a world with neither: non-zero, one line on stderr, never an empty key', () => {
    const world = mkTmp('lib-nosha-');
    const out = runLib("key=$(printf '%s' abc | hook_sha1); printf 'rc=%s key=[%s]' \"$?\" \"$key\"",
      { PATH: world });
    assert(out.stdout.includes('key=[]'), `no key at all, got: ${out.stdout}`);
    assert(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`);
    assert(/shasum/.test(out.stderr) && /sha1sum/.test(out.stderr),
      `the line names both spellings, got: ${out.stderr}`);
    assertEq(out.stderr.trim().split('\n').length, 1, `one line, got: ${out.stderr}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  group('_lib.sh: the platform seam');

  await test('OSTYPE answers with no uname on PATH: msys is Windows', () => {
    const out = runLib('hook_is_windows && echo win; hook_is_macos && echo mac; hook_is_linux && echo linux',
      { OSTYPE: 'msys', PATH: '' });
    assertEq(out.stdout.trim(), 'win', `Git Bash reads as Windows and nothing else, got: ${out.stdout}`);
  });

  await test('OSTYPE linux-gnu is Linux, darwin is macOS, each exclusive', () => {
    const linux = runLib('hook_is_linux && echo linux; hook_is_windows && echo win; hook_is_macos && echo mac',
      { OSTYPE: 'linux-gnu', PATH: '' });
    assertEq(linux.stdout.trim(), 'linux', `got: ${linux.stdout}`);
    const mac = runLib('hook_is_macos && echo mac; hook_is_windows && echo win; hook_is_linux && echo linux',
      { OSTYPE: 'darwin24', PATH: '' });
    assertEq(mac.stdout.trim(), 'mac', `got: ${mac.stdout}`);
  });

  await test('an OSTYPE this split does not know falls back to uname -s', () => {
    // The reference reading is taken in a shell started exactly as the helper's
    // is: under Git Bash the answer depends on the environment the shell
    // carries (MSYS_NT without MSYSTEM set, MINGW64_NT with it), so a reading
    // from anywhere else would be comparing two different questions.
    const uname = runLib('uname -s').stdout.trim();
    const out = runLib('hook_uname_s; printf "%s" "$HOOK_UNAME_S"', { OSTYPE: 'plan9' });
    assertEq(out.stdout.trim(), uname, `the shell's own answer, got: ${out.stdout}`);
  });

  await test('the reading is cached: a set HOOK_UNAME_S is never re-probed', () => {
    const out = runLib('hook_is_linux && echo linux', { HOOK_UNAME_S: 'Linux', PATH: '' });
    assertEq(out.stdout.trim(), 'linux', `the cache decides, got: ${out.stdout}`);
  });

  group('_lib.sh: hook_jq');

  // A jq that writes CRLF, as the winget build does on Windows: the platform
  // seam builds it, since the standards suite asks the same machine the same
  // question about the engine's own `wk_jq`.
  const crlfWorld = () => {
    const dir = mkTmp('lib-crlf-jq-');
    crlfJq(dir);
    return dir;
  };

  await test('hook_jq strips the carriage returns of a text-mode jq, on every line', () => {
    // jq's own output proves the stub; hook_jq's is the same lines with nothing
    // left on them, which is the engine's wk_jq answering through the pointer.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    const filter = `printf '%s' '{"v":["a","b","c"]}' |`;
    assertEq(runLib(`${filter} jq -r '.v[]'`, env).stdout, 'a\r\nb\r\nc\r\n', 'the stub jq writes CRLF');
    assertEq(runLib(`${filter} hook_jq -r '.v[]'`, env).stdout, 'a\nb\nc\n', 'hook_jq hands on LF');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('hook_jq hands back jq\'s own exit status, never the strip\'s', () => {
    // A caller that asks a QUESTION (`jq -e`, `jq empty`) reads the status and
    // nothing else, and a wrapper ending in a pipe would answer every one of
    // them yes. safety/release-taken leans on it: `patterns=$(hook_jq ...) ||
    // patterns=""` is how it survives a package.json it cannot read.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    const ask = (json) => runLib(`printf '%s' '${json}' | hook_jq -e '.v' >/dev/null; printf '%s' "$?"`, env).stdout;
    assertEq(ask('{"v":true}'), '0', 'a true answer is 0');
    assertEq(ask('{"v":false}'), '1', '`-e` says false with 1');
    assertEq(runLib(`printf 'not json' | hook_jq . >/dev/null 2>&1; printf '%s' "$?"`, env).stdout, '5',
      'a parse failure is jq\'s own 5');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('hook_jq_default takes the default only when jq answered nothing', () => {
    // A stream jq gets THROUGH before it fails on the tail: it has written the
    // first value's answer by then, so the `|| printf <default>` this replaces
    // handed back the two stuck together. The default is for silence alone.
    const severed = `printf '%s' '{"v":"kept"}{' |`;
    assertEq(runLib(`${severed} hook_jq_default 'fallen-back' -r '.v'`).stdout, 'kept',
      'the answer jq did write, and nothing appended to it');
    assertEq(runLib(`printf 'not json' | hook_jq_default 'fallen-back' -r '.v'`).stdout, 'fallen-back',
      'nothing written at all is what the default is for');
    assertEq(runLib(`printf '%s' '{"v":"here"}' | hook_jq_default 'fallen-back' -r '.v'`).stdout, 'here',
      'and a clean read is just the answer');
  });

  await test('hook_jq_default answers through the engine, CRLF and all', () => {
    // The body is wk_jq_default's, so the strip and the silent status come with
    // it: a text-mode jq's `\r` never reaches the caller, and a failed read is
    // still exit 0, since a read carrying a default has decided that already.
    const dir = crlfWorld();
    const env = { PATH: systemPathWith(dir) };
    assertEq(runLib(`printf '%s' '{"v":"x"}' | hook_jq_default 'd' -r '.v'`, env).stdout, 'x',
      'no carriage return rides along');
    assertEq(runLib(`printf 'not json' | hook_jq_default 'd' -r '.v' >/dev/null; printf '%s' "$?"`, env).stdout, '0',
      'the status is the default\'s, not jq\'s');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  group('_lib.sh: hook_manager_config');

  // The three layers are read from files, so the case plants its own and points
  // the MACHINE layer at one of them: the developer's real ~/.workkit is never
  // part of an answer here. jq and git are the real ones, since what is being
  // asked is which FILE was read.
  const jq = which('jq');
  await testUnless(!jq, 'this machine has no jq, and the config is read with it')(
    'a settings file in a cwd that is no git repo is not the repo layer', () => {
      // No git root, no repo layer. The file a non-repo cwd carries is the
      // MACHINE's own state (on Windows the user profile holds it and every
      // temp directory sits under that profile), and read as the repo layer it
      // overrides the machine's own config with itself.
      const dir = mkTmp('lib-manager-');
      const ladder = path.join(dir, 'ladder.json');
      fs.writeFileSync(ladder, JSON.stringify({ tiers: { fast: 'ladder-fast' } }));
      const user = path.join(dir, 'user-settings.json');
      fs.writeFileSync(user, JSON.stringify({ manager: { tiers: { frontier: 'machine-frontier' } } }));
      const cwd = path.join(dir, 'not-a-repo');
      fs.mkdirSync(path.join(cwd, '.workkit'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.workkit', 'settings.json'),
        JSON.stringify({ version: 1, manager: { tiers: { workhorse: 'from-a-non-repo' } } }));

      const ask = () => runLib(
        `hook_manager_config "${shellPath(ladder)}" "${shellPath(cwd)}"; printf '%s' "$HOOK_MANAGER_CONFIG"`,
        { PATH: systemPathWith(path.dirname(jq)), MANAGER_USER_SETTINGS: shellPath(user) },
      ).stdout;

      const outside = ask();
      assert(!outside.includes('from-a-non-repo'),
        `the file in a directory that is no repo is no repo layer, got: ${outside}`);
      assert(outside.includes('machine-frontier'),
        `and the machine layer is still taken outside a repo, got: ${outside}`);

      // The control: the same file, one `git init` later, IS that repo's layer.
      spawnSync('git', ['init', '-q', cwd], { encoding: 'utf8' });
      const inside = ask();
      assert(inside.includes('from-a-non-repo'),
        `a repo's own settings file is still read, got: ${inside}`);
      fs.rmSync(dir, { recursive: true, force: true });
    });

  group('_lib.sh: hook_changelog_linter');

  // Both callers fail OPEN when this answers nothing, so a resolution that
  // walks to the wrong folder would disable the CHANGELOG checks in silence.
  // No WORKFLOW_DIR: the answer is the engine beside the hooks, found from the
  // file that defines the helper.
  await test('with no WORKFLOW_DIR it names the engine\'s own changelog.js', () => {
    const out = runLib('hook_changelog_linter',
      { PATH: systemPathWith(path.dirname(process.execPath)) });
    // The shell answers in its own spelling (`pwd -P` resolves the links, the
    // climb out of lib/ stays textual), so the expected path is spelled the way
    // the shell would, as the cases below do, and the climb is collapsed here.
    const engine = shellPath(fs.realpathSync(path.join(__dirname, '..', '..', 'workflow', 'changelog.js')));
    assertEq(out.code, 0, `it resolves, got: ${out.stdout}|${out.stderr}`);
    assertEq(path.posix.normalize(out.stdout.trim()), engine, `got: ${out.stdout}`);
  });

  group('_lib.sh: hook_redirect_word');

  // One judgment per word, spelled the way a guard's walk hands it over: the
  // quote strip has already turned a quoted span into `_hookq_`.
  const redirectVerdicts = (words) => runLib(`for w in ${words.map((w) => `'${w}'`).join(' ')}; do `
    + 'printf \'%s=%s\\n\' "$w" "$(hook_redirect_word "$w" || echo no)"; done');

  await test('a bare operator hands its target to the next word', () => {
    const words = ['>', '>>', '<', '<<<', '&>', '&>>', '>|', '2>', '2>>', '0<', '<<'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=bare`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test('an attached operator carries its target', () => {
    const words = ['2>&1', '>file', '2>>err', '&>all', '0<in', '3>&-', '<<<msg', '>_hookq_'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=attached`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test('a plain argument or a quoted placeholder is no redirect', () => {
    const words = ['app.js', '-m', '-', '2', '_hookq_', 'a>b', '&'];
    const out = redirectVerdicts(words);
    assertEq(out.stdout.trim(), words.map((w) => `${w}=no`).join('\n'), `got: ${out.stdout}|${out.stderr}`);
  });

  await test("hook_fold_redirect_amp: a redirect's & is folded, a clause separator is kept", () => {
    const out = runLib("hook_fold_redirect_amp 'git clean 2>&1 -f &>/dev/null <&3 & ls && pwd'");
    assertEq(out.stdout, 'git clean 2>1 -f >/dev/null <3 & ls && pwd', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_redirect_span: 2 for bare, 1 for attached, 0 for no redirect, and exit 0 always', () => {
    const words = { '>': 2, '2>': 2, '<<<': 2, '2>&1': 1, '>file': 1, '2>1': 1, 'app.js': 0, 'a>b': 0, '_hookq_': 0 };
    const out = runLib(`for w in ${Object.keys(words).map((w) => `'${w}'`).join(' ')}; do `
      + 'n=$(hook_redirect_span "$w"); printf \'%s=%s:%s\\n\' "$w" "$n" "$?"; done');
    assertEq(out.stdout.trim(), Object.entries(words).map(([w, n]) => `${w}=${n}:0`).join('\n'),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_find_git_commit: a redirect between git and its subcommand never hides it', () => {
    for (const cmd of ['git 2>&1 commit -m "x"', 'git > /tmp/o commit -m "x"', 'git -C . 2>/dev/null commit -m "x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_COMMIT_CLAUSE"`);
      assert(/commit/.test(out.stdout), `${cmd} is a commit clause, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a redirect between an interpreter and its -c string never hides it', () => {
    for (const cmd of ['bash 2>&1 -c "git commit -m x"', 'sh > /tmp/o -c "git commit -m x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_WRAPPED_COMMIT"`);
      assertEq(out.stdout, '1', `${cmd} wraps a commit, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a quoted redirect target is counted, so the right span is judged', () => {
    for (const [cmd, want] of [
      ['bash > "out file" -c "git commit -m x"', '1'],
      ['bash > "git commit" -c "echo hi"', '0'],
      ['> "git commit" bash -c "echo hi"', '0'],
    ]) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_WRAPPED_COMMIT"`);
      assertEq(out.stdout, want, `${cmd}, got: ${out.stdout}|${out.stderr}`);
    }
  });

  await test('hook_find_git_commit: a redirect before the command word never ends the peel', () => {
    for (const cmd of ['2>&1 git commit -m "x"', '> /tmp/out git commit -m "x"']) {
      const out = runLib(`hook_find_git_commit '${cmd}'; printf '%s' "$HOOK_COMMIT_CLAUSE"`);
      assert(/git commit/.test(out.stdout), `${cmd} is a commit clause, got: ${out.stdout}|${out.stderr}`);
    }
  });

  group('_lib.sh: hook_pretool_notice');

  await test('prints the two-field JSON a PreToolUse hook exiting 0 is heard by', () => {
    const out = runLib("hook_pretool_notice 'a line: with \"quotes\"'");
    assertEq(out.code, 0, `it prints, got: ${out.stderr}`);
    const parsed = JSON.parse(out.stdout);
    assertEq(Object.keys(parsed).sort().join(','), 'hookSpecificOutput,systemMessage', 'two top-level fields');
    assertEq(parsed.systemMessage, 'a line: with "quotes"', 'the message, escaped by jq');
    assertEq(JSON.stringify(parsed.hookSpecificOutput),
      JSON.stringify({ hookEventName: 'PreToolUse', additionalContext: 'a line: with "quotes"' }),
      'the model hears the same line, and nothing decides the call');
  });

  group('_lib.sh: hook_wait_deadline and hook_end_tree');

  await test('a child still running at a 1s deadline: returns 1, and the child is ended', () => {
    const out = runLib('sleep 30 & pid=$!; hook_wait_deadline "$pid" 1; rc=$?; wait "$pid" 2>/dev/null; '
      + 'if kill -0 "$pid" 2>/dev/null; then alive=1; else alive=0; fi; printf \'rc=%s alive=%s\' "$rc" "$alive"');
    assertEq(out.stdout, 'rc=1 alive=0', `the deadline ended it, got: ${out.stdout}|${out.stderr}`);
  });

  await test('a quick child: returns 0 and leaves its exit status to wait', () => {
    const out = runLib('(exit 3) & pid=$!; hook_wait_deadline "$pid" 5; rc=$?; wait "$pid"; '
      + 'printf \'rc=%s status=%s\' "$rc" "$?"');
    assertEq(out.stdout, 'rc=0 status=3', `it ended in time, got: ${out.stdout}|${out.stderr}`);
  });

  group('_lib.sh: the test-path shapes');

  await test('hook_is_test_name: the basename shapes, at any depth, and nothing else', () => {
    const cases = ['a.test.js', 'src/a.spec.ts', 'pkg/a_test.go', 'tests/helpers.js', 'test/run.js', 'lib/x.js'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_test_name "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'a.test.js,src/a.spec.ts,pkg/a_test.go', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_is_test_path: a test name, or any test folder, the top level included', () => {
    const cases = ['a.test.js', 'tests/helpers.js', 'test/run.js', '__tests__/x.js', 'pkg/__tests__/x.js',
      'pkg/test/x.js', 'lib/x.js', 'contest/x.js', 'testing/x.js'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_test_path "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','),
      'a.test.js,tests/helpers.js,test/run.js,__tests__/x.js,pkg/__tests__/x.js,pkg/test/x.js', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_is_code_path: a code extension, never a test path, a config file or the attic', () => {
    const cases = ['lib/x.js', 'run.sh', 'a/b.tsx', 'tool.py', 'README.md', 'data.json', 'a.test.js', 'tests/helpers.js',
      'eslint.config.js', '_attic/old.js', 'pkg/_attic/old.sh'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_is_code_path "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'lib/x.js,run.sh,a/b.tsx,tool.py', `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_has_code_ext: the code extensions, read off the basename alone', () => {
    const cases = ['x.js', 'x.cjs', 'x.mjs', 'x.ts', 'x.jsx', 'x.tsx', 'run.sh', 'rc.zsh', 'tool.py', 'gem.rb',
      'README.md', 'data.json', 'x.json.bak', 'Makefile'];
    const out = runLib(`for p in ${cases.join(' ')}; do hook_has_code_ext "$p" && echo "$p"; done; true`);
    assertEq(out.stdout.trim().split('\n').join(','), 'x.js,x.cjs,x.mjs,x.ts,x.jsx,x.tsx,run.sh,rc.zsh,tool.py,gem.rb',
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_test_package_dir: the nearest package declaring a test script, below the root', () => {
    const root = mkTmp('lib-pkgdir-');
    for (const d of ['pkg/src/deep', 'pkg/bare/src', 'other', 'node_modules/x']) fs.mkdirSync(path.join(root, d), { recursive: true });
    const tested = JSON.stringify({ scripts: { test: 'node --test' } });
    for (const d of ['', 'pkg', 'node_modules/x']) fs.writeFileSync(path.join(root, d, 'package.json'), tested);
    fs.writeFileSync(path.join(root, 'pkg', 'bare', 'package.json'), '{"name":"bare"}');
    const ask = (p) => runLib(`hook_test_package_dir "${shellPath(root)}" "${p}"`).stdout.trim();
    assertEq(ask('pkg/src/deep/a.js'), 'pkg', 'a file under a package with a script names it');
    assertEq(ask('pkg/bare/src/a.js'), 'pkg', 'a package without a script never hides the tested one above it');
    assertEq(ask('other/x.js'), '', 'a file under no package names nothing');
    assertEq(ask('app.js'), '', "a file at the root names nothing, the root's own package included");
    assertEq(ask('node_modules/x/index.js'), '', 'a vendored package names nothing, script or not');
    fs.rmSync(root, { recursive: true, force: true });
  });

  group('_lib.sh: the marker paths');

  const sha1 = (text) => spawnSync(BASH, [...NO_RC, '-c', `printf '%s' "$1" | "${shellPath(real)}"`, 'sh', text],
    { encoding: 'utf8' }).stdout.split(' ')[0];

  // TMPDIR is handed over explicitly: the marker lives under whatever temp dir
  // the session has, which is the seam the two guard suites move.
  const TMP = mkTmp('lib-marker-');

  await test('hook_review_marker_path is the review marker dir plus the sha of the root', () => {
    const out = runLib('hook_review_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-review-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', () => {
    const out = runLib('hook_triage_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-triage-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_session_marker is the named dir plus the session id with every non-alphanumeric as _', () => {
    const out = runLib('hook_session_marker workkit-thing "ab-12/c.d e"', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(), `${shellPath(TMP)}/workkit-thing/ab_12_c_d_e`, `got: ${out.stdout}|${out.stderr}`);
  });

  await test('no digest tool: a marker path is refused, never half-built', () => {
    const world = mkTmp('lib-nosha-');
    const out = runLib('p=$(hook_review_marker_path /repos/thing); printf \'rc=%s p=[%s]\' "$?" "$p"',
      { PATH: world });
    assert(out.stdout.includes('p=[]'), `no path at all, got: ${out.stdout}`);
    assert(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`);
    fs.rmSync(world, { recursive: true, force: true });
  });

  group('_lib.sh: the marker scripts');

  for (const [script, fn, dir] of [
    ['review-marker.sh', 'hook_review_marker_path', 'claude-review-marker'],
    ['triage-marker.sh', 'hook_triage_marker_path', 'claude-triage-marker'],
  ]) {
    await test(`scripts/${script} exists, is executable, and parses`, () => {
      const file = path.join(__dirname, '..', '..', 'scripts', script);
      assert(fs.existsSync(file), `missing ${file}`);
      if (IS_WINDOWS) skip(`${script} carries the executable bit`, NO_EXEC_BIT);
      else assert((fs.statSync(file).mode & 0o111) !== 0, `${script} is executable`);
      const parsed = spawnSync(BASH, [...NO_RC, '-n', shellPath(file)], { encoding: 'utf8' });
      assertEq(parsed.status, 0, `${script} parses, got: ${parsed.stderr}`);
      const text = fs.readFileSync(file, 'utf8');
      assert(text.includes(fn), `${script} keys through ${fn}, never its own spelling`);
      assert(!text.includes(`${dir}/`), `${script} never spells the marker path itself`);
    });
  }
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
