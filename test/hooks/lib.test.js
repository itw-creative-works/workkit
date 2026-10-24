/* eslint-disable no-console */
// Tests for hooks/_lib.sh, the helper library the scripts and the dotfiles hooks
// source: one group per helper, from the platform seam and hook_sha1 through
// hook_jq, the test package and the marker paths. The suite and package records are test/hooks/lib-record.test.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, skipSuite, selfRun, summary,
} = require('../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC,
  shellPath, digestTool, stubTool, crlfJq, systemPathWith,
} = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { runLib } = require('../lib/hook-lib');

const SHA1_ABC = 'a9993e364706816aba3e25717850c26c9cd0d89d';

// A tool this machine has, by absolute path, through the platform seam: the
// digest lookups ask SYSTEM_PATH, the world the shims below are built against.

// A PATH world holding exactly one digest tool, under the name given.
const digestWorld = (name, real) => {
  const dir = mkTmp('lib-sha1-');
  // Under the name the case is asking about, which is the whole point: the tool
  // this machine ships, wearing the other machine's spelling.
  stubTool(dir, name, ['#!/bin/bash', `exec "${shellPath(real)}" "$@"`]);
  return dir;
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

  await test('Git Bash asks for real symlinks once, however often the seam is sourced', () => {
    const seam = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));
    // The seed is set in the shell, never in the env: a real MSYS runtime reads
    // MSYS at start, and `noglob` changes how it parses bash's own command line.
    const win = runLib(`MSYS=noglob; . "${seam}"; . "${seam}"; printf '%s' "$MSYS"`, { OSTYPE: 'msys' });
    assertEq(win.stdout, 'noglob winsymlinks:nativestrict', `appended once to the list, got: ${win.stdout}|${win.stderr}`);
    const mac = runLib('printf "%s" "${MSYS-unset}"', { OSTYPE: 'darwin24' });
    assertEq(mac.stdout, 'unset', `macOS sets nothing, got: ${mac.stdout}`);
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
    // A caller that asks a question (`jq -e`, `jq empty`) reads the status and
    // nothing else, and a wrapper ending in a pipe would answer every one of
    // them yes. hook_issues_building in hooks/lib/snapshot.sh leans on it: a
    // failed read there is its `|| return 2`.
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
    // A jq that fails on a stream's tail has already written the first value's
    // answer, so a `|| printf <default>` would hand back the two stuck
    // together. The default is for silence alone.
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

  group('_lib.sh: the test package');

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

  await test('wk_has_test_script: a package.json that defines scripts.test, and nothing else', () => {
    const root = mkTmp('lib-testscript-');
    for (const d of ['tested', 'bare', 'none']) fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, 'tested', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    fs.writeFileSync(path.join(root, 'bare', 'package.json'), JSON.stringify({ name: 'bare', scripts: { lint: 'x' } }));
    const ask = (d) => runLib(`wk_has_test_script "${shellPath(path.join(root, d))}"`).code;
    assertEq(ask('tested'), 0, 'a package.json with a test script answers yes');
    assertEq(ask('bare'), 1, 'a package.json without a test script answers no');
    assertEq(ask('none'), 1, 'a folder with no package.json answers no');
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('an empty scripts.test is no script', () => {
    const root = mkTmp('lib-emptyscript-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: '' } }));
    assertEq(runLib(`wk_has_test_script "${shellPath(root)}"`).code, 1, 'wk_has_test_script answers no');
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

  await test('hook_review_full_marker_path is the full-panel marker dir plus the sha of the root', () => {
    const out = runLib('hook_review_full_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-review-full-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', () => {
    const out = runLib('hook_triage_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-triage-marker', sha1('/repos/thing'))),
      `got: ${out.stdout}|${out.stderr}`);
  });

  await test('wk_suite_marker_path is the suite marker dir plus the sha of the root', () => {
    const out = runLib('wk_suite_marker_path /repos/thing', { TMPDIR: shellPath(TMP) });
    assertEq(out.stdout.trim(),
      shellPath(path.join(TMP, 'claude-suite-marker', sha1('/repos/thing'))),
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
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
