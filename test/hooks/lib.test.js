/* eslint-disable no-console */
// Tests for the engine's shell library under workflow/lib/: one group per
// helper, the digest, the platform seam, wk_jq, the test package and the marker
// path's refusal. The suite and package records are test/hooks/lib-record.test.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const {
  SYSTEM_PATH, shellPath, digestTool, stubTool, crlfJq, systemPathWith,
} = require('../lib/platform');
const { runLib } = require('../lib/hook-lib');

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

describe('the engine\'s shell library', { skip: !real && 'this machine has neither shasum nor sha1sum, so no digest world can be built' }, () => {
  describe('the digest, wk_sha1', () => {
    test('a world with only shasum: the hex digest of stdin, no filename', () => {
      const world = digestWorld('shasum', real);
      const out = runLib("printf '%s' abc | wk_sha1", { PATH: world });
      expect(out.stdout.trim(), `the sha1 of abc, got: ${out.stdout}|${out.stderr}`).toBe(SHA1_ABC);
      fs.rmSync(world, { recursive: true, force: true });
    });

    test('a world with only sha1sum: the same digest, same shape', () => {
      const world = digestWorld('sha1sum', real);
      const out = runLib("printf '%s' abc | wk_sha1", { PATH: world });
      expect(out.stdout.trim(), `the sha1 of abc, got: ${out.stdout}|${out.stderr}`).toBe(SHA1_ABC);
      fs.rmSync(world, { recursive: true, force: true });
    });

    test('a world with neither: non-zero, one line on stderr, never an empty key', () => {
      const world = mkTmp('lib-nosha-');
      const out = runLib("key=$(printf '%s' abc | wk_sha1); printf 'rc=%s key=[%s]' \"$?\" \"$key\"",
        { PATH: world });
      expect(out.stdout.includes('key=[]'), `no key at all, got: ${out.stdout}`).toBeTruthy();
      expect(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`).toBeTruthy();
      expect(/shasum/.test(out.stderr) && /sha1sum/.test(out.stderr),
        `the line names both spellings, got: ${out.stderr}`).toBeTruthy();
      expect(out.stderr.trim().split('\n').length, `one line, got: ${out.stderr}`).toBe(1);
      fs.rmSync(world, { recursive: true, force: true });
    });
  });

  describe('the platform seam', () => {
    test('Git Bash asks for real symlinks once, however often the seam is sourced', () => {
      const seam = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'platform.sh'));
      // The seed is set in the shell, never in the env: a real MSYS runtime reads
      // MSYS at start, and `noglob` changes how it parses bash's own command line.
      const win = runLib(`MSYS=noglob; . "${seam}"; . "${seam}"; printf '%s' "$MSYS"`, { OSTYPE: 'msys' });
      expect(win.stdout, `appended once to the list, got: ${win.stdout}|${win.stderr}`).toBe('noglob winsymlinks:nativestrict');
      const mac = runLib('printf "%s" "${MSYS-unset}"', { OSTYPE: 'darwin24' });
      expect(mac.stdout, `macOS sets nothing, got: ${mac.stdout}`).toBe('unset');
    });
  });

  describe('wk_jq', () => {
    // A jq that writes CRLF, as the winget build does on Windows: the platform
    // seam builds it, since the standards suite asks the same machine the same
    // question through the heal.
    const crlfWorld = () => {
      const dir = mkTmp('lib-crlf-jq-');
      crlfJq(dir);
      return dir;
    };

    test('wk_jq strips the carriage returns of a text-mode jq, on every line', () => {
      // jq's own output proves the stub; wk_jq's is the same lines with nothing
      // left on them.
      const dir = crlfWorld();
      const env = { PATH: systemPathWith(dir) };
      const filter = `printf '%s' '{"v":["a","b","c"]}' |`;
      expect(runLib(`${filter} jq -r '.v[]'`, env).stdout, 'the stub jq writes CRLF').toBe('a\r\nb\r\nc\r\n');
      expect(runLib(`${filter} wk_jq -r '.v[]'`, env).stdout, 'wk_jq hands on LF').toBe('a\nb\nc\n');
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('wk_jq hands back jq\'s own exit status, never the strip\'s', () => {
      // A caller that asks a question (`jq -e`, `jq empty`) reads the status and
      // nothing else, and a wrapper ending in a pipe would answer every one of
      // them yes.
      const dir = crlfWorld();
      const env = { PATH: systemPathWith(dir) };
      const ask = (json) => runLib(`printf '%s' '${json}' | wk_jq -e '.v' >/dev/null; printf '%s' "$?"`, env).stdout;
      expect(ask('{"v":true}'), 'a true answer is 0').toBe('0');
      expect(ask('{"v":false}'), '`-e` says false with 1').toBe('1');
      expect(runLib(`printf 'not json' | wk_jq . >/dev/null 2>&1; printf '%s' "$?"`, env).stdout,
        'a parse failure is jq\'s own 5').toBe('5');
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('the test package', () => {
    test('wk_has_test_script: a package.json that defines scripts.test, and nothing else', () => {
      const root = mkTmp('lib-testscript-');
      for (const d of ['tested', 'bare', 'none']) fs.mkdirSync(path.join(root, d));
      fs.writeFileSync(path.join(root, 'tested', 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
      fs.writeFileSync(path.join(root, 'bare', 'package.json'), JSON.stringify({ name: 'bare', scripts: { lint: 'x' } }));
      const ask = (d) => runLib(`wk_has_test_script "${shellPath(path.join(root, d))}"`, {}, ['suite.sh']).code;
      expect(ask('tested'), 'a package.json with a test script answers yes').toBe(0);
      expect(ask('bare'), 'a package.json without a test script answers no').toBe(1);
      expect(ask('none'), 'a folder with no package.json answers no').toBe(1);
      fs.rmSync(root, { recursive: true, force: true });
    });

    test('an empty scripts.test is no script', () => {
      const root = mkTmp('lib-emptyscript-');
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: '' } }));
      expect(runLib(`wk_has_test_script "${shellPath(root)}"`, {}, ['suite.sh']).code, 'wk_has_test_script answers no').toBe(1);
      fs.rmSync(root, { recursive: true, force: true });
    });
  });

  describe('the marker path', () => {
    test('no digest tool: wk_marker_path refuses, never a half-built path', () => {
      const world = mkTmp('lib-nosha-');
      const out = runLib('p=$(wk_marker_path claude-review-marker /repos/thing); printf \'rc=%s p=[%s]\' "$?" "$p"',
        { PATH: world });
      expect(out.stdout.includes('p=[]'), `no path at all, got: ${out.stdout}`).toBeTruthy();
      expect(!out.stdout.includes('rc=0'), `and says so, got: ${out.stdout}`).toBeTruthy();
      fs.rmSync(world, { recursive: true, force: true });
    });
  });
});
