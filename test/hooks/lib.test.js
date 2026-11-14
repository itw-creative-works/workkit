/* eslint-disable no-console */
// Tests for hooks/_lib.sh, the helper library the scripts and the dotfiles hooks
// source: one group per helper, from the platform seam and hook_sha1 through
// hook_jq, the test package and the marker paths. The suite and package records are test/hooks/lib-record.test.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, before, expect, mkTmp,
} = require('../lib/harness');
const {
  BASH, SYSTEM_PATH, NO_RC,
  shellPath, digestTool, stubTool, crlfJq, systemPathWith,
} = require('../lib/platform');
const { runLib } = require('../lib/hook-lib');
const { mods } = require('../lib/mods-inputs');
const { scratchWorkflowHome, agedFile } = require('../lib/workflow-home');

const SHA1_ABC = 'a9993e364706816aba3e25717850c26c9cd0d89d';

// A tool this machine has, by absolute path, through the platform seam: the
// digest lookups ask SYSTEM_PATH, the world the shims below are built against.
const real = digestTool(SYSTEM_PATH);

// A PATH world holding exactly one digest tool, under the name given.
const digestWorld = (name, tool) => {
  const dir = mkTmp('lib-sha1-');
  // Under the name the case is asking about, which is the whole point: the tool
  // this machine ships, wearing the other machine's spelling.
  stubTool(dir, name, ['#!/bin/bash', `exec "${shellPath(tool)}" "$@"`]);
  return dir;
};

describe('_lib.sh', { skip: !real && 'this machine has neither shasum nor sha1sum, so no digest world can be built' }, () => {
  describe('_lib.sh: hook_sha1', () => {
    test('a world with only shasum: the hex digest of stdin, no filename', () => {
      const world = digestWorld('shasum', real);
      const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
      expect(out.stdout.trim(), `the sha1 of abc, got: ${out.stdout}|${out.stderr}`).toBe(SHA1_ABC);
      fs.rmSync(world, { recursive: true, force: true });
    });

    test('a world with only sha1sum: the same digest, same shape', () => {
      const world = digestWorld('sha1sum', real);
      const out = runLib("printf '%s' abc | hook_sha1", { PATH: world });
      expect(out.stdout.trim(), `the sha1 of abc, got: ${out.stdout}|${out.stderr}`).toBe(SHA1_ABC);
      fs.rmSync(world, { recursive: true, force: true });
    });

    test('a world with neither: non-zero, one line on stderr, never an empty key', () => {
      const world = mkTmp('lib-nosha-');
      const out = runLib("key=$(printf '%s' abc | hook_sha1); printf 'rc=%s key=[%s]' \"$?\" \"$key\"",
        { PATH: world });
      expect(out.stdout.includes('key=[]'), `no key at all, got: ${out.stdout}`).toBeTruthy();
      expect(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`).toBeTruthy();
      expect(/shasum/.test(out.stderr) && /sha1sum/.test(out.stderr),
        `the line names both spellings, got: ${out.stderr}`).toBeTruthy();
      expect(out.stderr.trim().split('\n').length, `one line, got: ${out.stderr}`).toBe(1);
      fs.rmSync(world, { recursive: true, force: true });
    });
  });

  describe('_lib.sh: the platform seam', () => {
    test('OSTYPE answers with no uname on PATH: msys is Windows', () => {
      const out = runLib('hook_is_windows && echo win; hook_is_macos && echo mac; hook_is_linux && echo linux',
        { OSTYPE: 'msys', PATH: '' });
      expect(out.stdout.trim(), `Git Bash reads as Windows and nothing else, got: ${out.stdout}`).toBe('win');
    });

    test('OSTYPE linux-gnu is Linux, darwin is macOS, each exclusive', () => {
      const linux = runLib('hook_is_linux && echo linux; hook_is_windows && echo win; hook_is_macos && echo mac',
        { OSTYPE: 'linux-gnu', PATH: '' });
      expect(linux.stdout.trim(), `got: ${linux.stdout}`).toBe('linux');
      const mac = runLib('hook_is_macos && echo mac; hook_is_windows && echo win; hook_is_linux && echo linux',
        { OSTYPE: 'darwin24', PATH: '' });
      expect(mac.stdout.trim(), `got: ${mac.stdout}`).toBe('mac');
    });

    test('an OSTYPE this split does not know falls back to uname -s', () => {
      // The reference reading is taken in a shell started exactly as the helper's
      // is: under Git Bash the answer depends on the environment the shell
      // carries (MSYS_NT without MSYSTEM set, MINGW64_NT with it), so a reading
      // from anywhere else would be comparing two different questions.
      const uname = runLib('uname -s').stdout.trim();
      const out = runLib('hook_uname_s; printf "%s" "$HOOK_UNAME_S"', { OSTYPE: 'plan9' });
      expect(out.stdout.trim(), `the shell's own answer, got: ${out.stdout}`).toBe(uname);
    });

    test('Git Bash asks for real symlinks once, however often the seam is sourced', () => {
      const seam = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));
      // The seed is set in the shell, never in the env: a real MSYS runtime reads
      // MSYS at start, and `noglob` changes how it parses bash's own command line.
      const win = runLib(`MSYS=noglob; . "${seam}"; . "${seam}"; printf '%s' "$MSYS"`, { OSTYPE: 'msys' });
      expect(win.stdout, `appended once to the list, got: ${win.stdout}|${win.stderr}`).toBe('noglob winsymlinks:nativestrict');
      const mac = runLib('printf "%s" "${MSYS-unset}"', { OSTYPE: 'darwin24' });
      expect(mac.stdout, `macOS sets nothing, got: ${mac.stdout}`).toBe('unset');
    });

    test('the reading is cached: a set HOOK_UNAME_S is never re-probed', () => {
      const out = runLib('hook_is_linux && echo linux', { HOOK_UNAME_S: 'Linux', PATH: '' });
      expect(out.stdout.trim(), `the cache decides, got: ${out.stdout}`).toBe('linux');
    });
  });

  describe('_lib.sh: hook_jq', () => {
    // A jq that writes CRLF, as the winget build does on Windows: the platform
    // seam builds it, since the standards suite asks the same machine the same
    // question about the engine's own `wk_jq`.
    const crlfWorld = () => {
      const dir = mkTmp('lib-crlf-jq-');
      crlfJq(dir);
      return dir;
    };

    test('hook_jq strips the carriage returns of a text-mode jq, on every line', () => {
      // jq's own output proves the stub; hook_jq's is the same lines with nothing
      // left on them, which is the engine's wk_jq answering through the pointer.
      const dir = crlfWorld();
      const env = { PATH: systemPathWith(dir) };
      const filter = `printf '%s' '{"v":["a","b","c"]}' |`;
      expect(runLib(`${filter} jq -r '.v[]'`, env).stdout, 'the stub jq writes CRLF').toBe('a\r\nb\r\nc\r\n');
      expect(runLib(`${filter} hook_jq -r '.v[]'`, env).stdout, 'hook_jq hands on LF').toBe('a\nb\nc\n');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('hook_jq hands back jq\'s own exit status, never the strip\'s', () => {
      // A caller that asks a question (`jq -e`, `jq empty`) reads the status and
      // nothing else, and a wrapper ending in a pipe would answer every one of
      // them yes. wk_issues_building in workflow/lib/hold.sh leans on the engine's
      // wk_jq status this answers through: a failed read there is its `|| return 2`.
      const dir = crlfWorld();
      const env = { PATH: systemPathWith(dir) };
      const ask = (json) => runLib(`printf '%s' '${json}' | hook_jq -e '.v' >/dev/null; printf '%s' "$?"`, env).stdout;
      expect(ask('{"v":true}'), 'a true answer is 0').toBe('0');
      expect(ask('{"v":false}'), '`-e` says false with 1').toBe('1');
      expect(runLib(`printf 'not json' | hook_jq . >/dev/null 2>&1; printf '%s' "$?"`, env).stdout,
        'a parse failure is jq\'s own 5').toBe('5');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('hook_jq_default takes the default only when jq answered nothing', () => {
      // A jq that fails on a stream's tail has already written the first value's
      // answer, so a `|| printf <default>` would hand back the two stuck
      // together. The default is for silence alone.
      const severed = `printf '%s' '{"v":"kept"}{' |`;
      expect(runLib(`${severed} hook_jq_default 'fallen-back' -r '.v'`).stdout,
        'the answer jq did write, and nothing appended to it').toBe('kept');
      expect(runLib(`printf 'not json' | hook_jq_default 'fallen-back' -r '.v'`).stdout,
        'nothing written at all is what the default is for').toBe('fallen-back');
      expect(runLib(`printf '%s' '{"v":"here"}' | hook_jq_default 'fallen-back' -r '.v'`).stdout,
        'and a clean read is just the answer').toBe('here');
    });

    test('hook_jq_default answers through the engine, CRLF and all', () => {
      // The body is wk_jq_default's, so the strip and the silent status come with
      // it: a text-mode jq's `\r` never reaches the caller, and a failed read is
      // still exit 0, since a read carrying a default has decided that already.
      const dir = crlfWorld();
      const env = { PATH: systemPathWith(dir) };
      expect(runLib(`printf '%s' '{"v":"x"}' | hook_jq_default 'd' -r '.v'`, env).stdout,
        'no carriage return rides along').toBe('x');
      expect(runLib(`printf 'not json' | hook_jq_default 'd' -r '.v' >/dev/null; printf '%s' "$?"`, env).stdout,
        'the status is the default\'s, not jq\'s').toBe('0');
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('_lib.sh: the test package', () => {
    test('hook_test_package_dir: the nearest package declaring a test script, below the root', () => {
      const root = mkTmp('lib-pkgdir-');
      for (const d of ['pkg/src/deep', 'pkg/bare/src', 'other', 'node_modules/x']) fs.mkdirSync(path.join(root, d), { recursive: true });
      const tested = JSON.stringify({ scripts: { test: 'node --test' } });
      for (const d of ['', 'pkg', 'node_modules/x']) fs.writeFileSync(path.join(root, d, 'package.json'), tested);
      fs.writeFileSync(path.join(root, 'pkg', 'bare', 'package.json'), '{"name":"bare"}');
      const ask = (p) => runLib(`hook_test_package_dir "${shellPath(root)}" "${p}"`).stdout.trim();
      expect(ask('pkg/src/deep/a.js'), 'a file under a package with a script names it').toBe('pkg');
      expect(ask('pkg/bare/src/a.js'), 'a package without a script never hides the tested one above it').toBe('pkg');
      expect(ask('other/x.js'), 'a file under no package names nothing').toBe('');
      expect(ask('app.js'), "a file at the root names nothing, the root's own package included").toBe('');
      expect(ask('node_modules/x/index.js'), 'a vendored package names nothing, script or not').toBe('');
      fs.rmSync(root, { recursive: true, force: true });
    });

    test('wk_has_test_script: a package.json that defines scripts.test, and nothing else', () => {
      const root = mkTmp('lib-testscript-');
      for (const d of ['tested', 'bare', 'none']) fs.mkdirSync(path.join(root, d));
      fs.writeFileSync(path.join(root, 'tested', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
      fs.writeFileSync(path.join(root, 'bare', 'package.json'), JSON.stringify({ name: 'bare', scripts: { lint: 'x' } }));
      const ask = (d) => runLib(`wk_has_test_script "${shellPath(path.join(root, d))}"`).code;
      expect(ask('tested'), 'a package.json with a test script answers yes').toBe(0);
      expect(ask('bare'), 'a package.json without a test script answers no').toBe(1);
      expect(ask('none'), 'a folder with no package.json answers no').toBe(1);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test('an empty scripts.test is no script', () => {
      const root = mkTmp('lib-emptyscript-');
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: '' } }));
      expect(runLib(`wk_has_test_script "${shellPath(root)}"`).code, 'wk_has_test_script answers no').toBe(1);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe('_lib.sh: the marker paths', () => {
    const sha1 = (text) => spawnSync(BASH, [...NO_RC, '-c', `printf '%s' "$1" | "${shellPath(real)}"`, 'sh', text],
      { encoding: 'utf8' }).stdout.split(' ')[0];

    // TMPDIR is handed over explicitly: a session marker lives under whatever
    // temp dir the session has.
    let TMP;
    // So are HOME and WORKFLOW_HOME: every other marker lives under the workflow
    // home's markers folder, never the machine's.
    let HOME;
    let MARKERS;
    before(() => {
      TMP = mkTmp('lib-marker-');
      HOME = scratchWorkflowHome('lib-marker-home-');
      MARKERS = path.join(HOME.workflowHome, 'markers');
    });

    test('hook_review_marker_path is the review marker dir plus the sha of the root', () => {
      const out = runLib('hook_review_marker_path /repos/thing', HOME.env);
      expect(out.stdout.trim(), `got: ${out.stdout}|${out.stderr}`)
        .toBe(shellPath(path.join(MARKERS, 'claude-review-marker', sha1('/repos/thing'))));
    });

    test('hook_review_full_marker_path is the full-panel marker dir plus the sha of the root', () => {
      const out = runLib('hook_review_full_marker_path /repos/thing', HOME.env);
      expect(out.stdout.trim(), `got: ${out.stdout}|${out.stderr}`)
        .toBe(shellPath(path.join(MARKERS, 'claude-review-full-marker', sha1('/repos/thing'))));
    });

    test('hook_triage_marker_path is the triage marker dir plus the sha of the anchor', () => {
      const out = runLib('hook_triage_marker_path /repos/thing', HOME.env);
      expect(out.stdout.trim(), `got: ${out.stdout}|${out.stderr}`)
        .toBe(shellPath(path.join(MARKERS, 'claude-triage-marker', sha1('/repos/thing'))));
    });

    test('wk_suite_marker_path is the suite marker dir plus the sha of the root', () => {
      const out = runLib('wk_suite_marker_path /repos/thing', HOME.env);
      expect(out.stdout.trim(), `got: ${out.stdout}|${out.stderr}`)
        .toBe(shellPath(path.join(MARKERS, 'claude-suite-marker', sha1('/repos/thing'))));
    });

    test('the shell and JS key rules name the same file under the workflow home, for every marker kind', async () => {
      const kinds = [
        ['hook_review_marker_path', 'reviewMarkerPath'],
        ['hook_review_full_marker_path', 'reviewFullMarkerPath'],
        ['hook_triage_marker_path', 'triageMarkerPath'],
        ['wk_suite_marker_path', 'suiteMarkerPath'],
        ['wk_pkg_marker_path', 'pkgMarkerPath'],
      ];
      for (const [shellRule, jsRule] of kinds) {
        const shell = runLib(`${shellRule} /repos/thing`, HOME.env).stdout.trim();
        expect(shell.startsWith(`${shellPath(MARKERS)}/`), `${shellRule} is under the markers folder, got: ${shell}`).toBeTruthy();
        expect(await mods('markers')[jsRule]('/repos/thing', shellPath(HOME.workflowHome)), `${jsRule} names the file ${shellRule} does`).toBe(shell);
      }
    });

    test('the shell and JS rules name the same cache folder and the same snapshot folder under the scratch HOME', async () => {
      const cache = runLib('wk_cache_dir', HOME.env);
      expect(mods('log').cacheDirOf(HOME.env), `cacheDirOf names the folder wk_cache_dir does: ${cache.stderr}`).toBe(cache.stdout.trim());
      const snap = runLib('hook_snapshot_dir /repos/thing', HOME.env);
      expect(await mods('snapshot').snapshotPath('/repos/thing', HOME.env), `snapshotPath names the folder hook_snapshot_dir does: ${snap.stderr}`)
        .toBe(snap.stdout.trim());
    });

    test('writing a marker sweeps the markers folder: a file 8 days old goes, one 6 days old stays', () => {
      const { workflowHome, env } = scratchWorkflowHome('lib-sweep-home-');
      const aged = (kind, name, days) => agedFile(path.join(workflowHome, 'markers', kind, name), days);
      const old = aged('claude-review-marker', 'old', 8);
      const oldOtherKind = aged('claude-suite-marker', 'old', 8);
      const young = aged('claude-review-marker', 'young', 6);
      const out = runLib('_hook_write_marker "$(hook_review_marker_path /repos/thing)"', env);
      expect(out.code, `the marker is written, got: ${out.stderr}`).toBe(0);
      expect(!fs.existsSync(old), 'the 8-day-old sibling is swept').toBeTruthy();
      expect(!fs.existsSync(oldOtherKind), 'and so is an 8-day-old file of another kind').toBeTruthy();
      expect(fs.existsSync(young), 'the 6-day-old sibling is kept').toBeTruthy();
    });

    test('hook_session_marker is the named dir plus the session id with every non-alphanumeric as _', () => {
      const out = runLib('hook_session_marker workkit-thing "ab-12/c.d e"', { TMPDIR: shellPath(TMP) });
      expect(out.stdout.trim(), `got: ${out.stdout}|${out.stderr}`).toBe(`${shellPath(TMP)}/workkit-thing/ab_12_c_d_e`);
    });

    test('no digest tool: a marker path is refused, never half-built', () => {
      const world = mkTmp('lib-nosha-');
      const out = runLib('p=$(hook_review_marker_path /repos/thing); printf \'rc=%s p=[%s]\' "$?" "$p"',
        { PATH: world });
      expect(out.stdout.includes('p=[]'), `no path at all, got: ${out.stdout}`).toBeTruthy();
      expect(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`).toBeTruthy();
      fs.rmSync(world, { recursive: true, force: true });
    });
  });
});
