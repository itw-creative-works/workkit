// Tests for `modCase(folder)` from the door: a host suite's one case that runs
// `claude plugin test <folder>`, passing on exit 0, failing with the failed tests'
// names and the exit code, its output past its deadline, or a claude found that does
// not start; skipped with no claude on PATH; a missing folder fails the suite.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('./lib/harness');
const {
  joinPath, basePathWithout, which, NODE_DIR, IS_WINDOWS,
} = require('./lib/platform');
const { failuresOf, marksOf, totalsOf } = require('./lib/run-lists');
const { MOD_FILES, mkWorld, claudeStub } = require('./lib/runner-world');

const DOOR = path.join(__dirname, 'lib', 'harness.js');

// A scratch plugin repo whose host suite, test/mods.test.js, calls modCase on the repo itself.
const pluginWorld = () => {
  const w = mkWorld();
  w.write({
    ...MOD_FILES,
    'test/mods.test.js': `const { modCase } = require(${JSON.stringify(DOOR)});\nmodCase(${JSON.stringify(w.root)});\n`,
  });
  return { ...w, name: `claude plugin test (${path.basename(w.root)})` };
};

// The failure message the run lists under the case `name`.
const messageOf = (output, name) => failuresOf(output).split(name)[1] || '';

// A PATH whose one claude is what `make` puts at the path it is given, beside node's own folder.
const pathWithClaude = (make) => {
  const tmp = mkTmp('mod-case-broken-');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  make(path.join(bin, 'claude'));
  return joinPath(bin, basePathWithout(tmp, 'claude'), NODE_DIR);
};
// A PATH whose one claude is a file holding `lines` with `mode`.
const pathWithClaudeFile = (lines, mode) => pathWithClaude((file) => fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode }));

describe('modCase: the tool\'s exit decides the case', () => {
  test('a claude that prints 2 pass and 0 fail and exits 0: one passed case named for the folder, the tool started with plugin test <folder>', () => {
    const w = pluginWorld();
    const claude = claudeStub({ lines: [' 2 pass', ' 0 fail'] });
    const { code, output } = w.run([], { bins: [claude.bin] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `the one case, got: ${output}`).toEqual([`✓ ${w.name}`]);
    expect(totalsOf(output), `one case counted, got: ${output}`).toMatch(/^1 passed, 0 failed/);
    const args = claude.args();
    expect(args && args.slice(0, 2), `started with plugin test, got: ${JSON.stringify(args)}`).toEqual(['plugin', 'test']);
    expect(fs.realpathSync(args[2]), 'the folder handed to it').toBe(fs.realpathSync(w.root));
  });

  test('a claude that prints (fail) alpha [3ms] and exits 1: the case fails, its message naming alpha', () => {
    const w = pluginWorld();
    const claude = claudeStub({ lines: ['(fail) alpha [3ms]', ' 0 pass', ' 1 fail'], code: 1 });
    const { code, output } = w.run([], { bins: [claude.bin] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
    expect(messageOf(output, w.name), `the message names the failed test, got: ${output}`).toContain('alpha');
  });

  test('a claude that exits 3 with no (fail) line: the case fails, its message holding the exit code 3', () => {
    const w = pluginWorld();
    const claude = claudeStub({ lines: ['broke before any test ran'], code: 3 });
    const { code, output } = w.run([], { bins: [claude.bin] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
    expect(messageOf(output, w.name), `the message holds the exit code, got: ${output}`).toContain('exited with code 3');
  });

  // The tool is ended before the suite's own deadline, so its output reaches the case's message.
  test('a claude that prints a line and never ends, under a short TEST_DEADLINE: the case fails, its message holding timed out and that line', (t) => {
    const w = pluginWorld();
    const claude = claudeStub({ lines: ['still testing alpha'], hang: true });
    t.after(claude.release);
    const { code, output } = w.run([], { bins: [claude.bin], env: { TEST_DEADLINE: '12' } });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
    const message = messageOf(output, w.name);
    expect(message, `the message says it timed out, got: ${output}`).toContain('timed out');
    expect(message, `the message holds the tool's line, got: ${output}`).toContain('still testing alpha');
  });
});

describe('modCase: the folder', () => {
  test('a host suite calling modCase on a folder that does not exist, a claude on the PATH: the run fails naming that folder', () => {
    const w = mkWorld();
    const missing = path.join(w.root, 'no-such-dir');
    w.write({ 'test/mods.test.js': `const { modCase } = require(${JSON.stringify(DOOR)});\nmodCase(${JSON.stringify(missing)});\n` });
    const claude = claudeStub({ lines: [' 1 pass', ' 0 fail'] });
    const { code, output } = w.run([], { bins: [claude.bin] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(output, 'the output names the missing folder').toContain(missing);
    expect(claude.started(), 'claude never started').toBe(false);
  });
});

describe('modCase: finding claude', () => {
  test('a PATH with no claude: the case is skipped with no claude binary on PATH, and the run exits 0', () => {
    const w = pluginWorld();
    // node's own folder beside the built PATH, so the runner's node is the real one on either platform.
    const PATH = joinPath(basePathWithout(mkTmp('mod-case-noclaude-'), 'claude'), NODE_DIR);
    expect(which('claude', PATH), 'the fixture PATH holds no claude').toBe(null);
    const { code, output } = w.run([], { env: { PATH } });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output)[0], `the case's skip line, got: ${output}`).toBe(`⊘ ${w.name}: no claude binary on PATH`);
    expect(totalsOf(output), `one case skipped, none passed or failed, got: ${output}`).toMatch(/^0 passed, 0 failed, 1 case skipped/);
  });

  // On Windows a raw start finds only claude.exe, so this .cmd is the npm-installed claude it never found.
  test('a claude on PATH only as a script (a claude.cmd on Windows): the case passes', () => {
    const w = pluginWorld();
    const tmp = mkTmp('mod-case-script-');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    if (IS_WINDOWS) {
      fs.writeFileSync(path.join(bin, 'claude.cmd'), ['@echo off', 'echo 2 pass', 'echo 0 fail', 'exit /b 0', ''].join('\r\n'));
    } else {
      fs.writeFileSync(path.join(bin, 'claude'), ['#!/bin/sh', "echo ' 2 pass'", "echo ' 0 fail'", 'exit 0', ''].join('\n'), { mode: 0o755 });
    }
    const { code, output } = w.run([], { env: { PATH: joinPath(bin, basePathWithout(tmp, 'claude'), NODE_DIR) } });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `the one case passed, got: ${output}`).toEqual([`✓ ${w.name}`]);
  });

  test(
    'a claude on PATH that is a file without the execute bit: the case fails, its message starting claude did not start:',
    { skip: IS_WINDOWS && 'Windows starts a file by its extension, not an execute bit' },
    () => {
      const w = pluginWorld();
      const PATH = pathWithClaudeFile(['#!/bin/sh', 'exit 0'], 0o644);
      const { code, output } = w.run([], { env: { PATH } });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
      expect(messageOf(output, w.name), `the message, got: ${output}`).toMatch(/^: claude did not start:/);
    },
  );

  test(
    'an executable claude on PATH whose #! line names a program that does not exist: the case fails, its message starting claude did not start:',
    { skip: IS_WINDOWS && 'Windows reads no #! line' },
    () => {
      const w = pluginWorld();
      const PATH = pathWithClaudeFile([`#!${path.join(mkTmp('mod-case-noprog-'), 'no-such-program')}`, 'exit 0'], 0o755);
      const { code, output } = w.run([], { env: { PATH } });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
      expect(messageOf(output, w.name), `the message, got: ${output}`).toMatch(/^: claude did not start:/);
    },
  );

  test(
    'a claude on PATH that is a link to a file that does not exist: the case fails, its message starting claude did not start:',
    { skip: IS_WINDOWS && 'a link on Windows needs a privilege the run may not have' },
    () => {
      const w = pluginWorld();
      const PATH = pathWithClaude((file) => fs.symlinkSync(path.join(mkTmp('mod-case-nolink-'), 'no-such-file'), file));
      const { code, output } = w.run([], { env: { PATH } });
      expect(code, `exit 1, got: ${output}`).toBe(1);
      expect(marksOf(output), `the one case failed, got: ${output}`).toEqual([`✗ ${w.name}`]);
      expect(messageOf(output, w.name), `the message, got: ${output}`).toMatch(/^: claude did not start:/);
    },
  );
});
