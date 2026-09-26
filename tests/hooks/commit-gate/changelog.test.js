//
// Tests for hooks/safety/commit-gate: the CHANGELOG entry format, and a Fixes #N
// commit staging its CHANGELOG entry.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath, pathWith, stubTool } = require('../../lib/platform');
const { skipWithoutDigest, LIB, mkRepo, stage, touchMarker, runHook, cleanup, CHANGELOG, ISSUE, ENTRY } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: CHANGELOG entry format');

  // The gate is the authority for the format: the docs/changelog-guard hook
  // sees only writes made through the tools, and everything reaches git here.
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
    stage(dir, 'CHANGELOG.md', CHANGELOG(`- ${ISSUE} - Plugins install from settings.json.`));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a legacy entry the commit did not touch does not block', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.'));
    execSync('git commit -q -m "legacy" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'CHANGELOG.md', CHANGELOG('- A legacy essay entry with no issue link.', `- ${ISSUE} - A new entry.`));
    const { code, stderr } = runHook(dir, 'git commit -m "docs: changelog"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a -am commit is judged from the working tree, which is what it carries', () => {
    const dir = mkRepo();
    stage(dir, 'CHANGELOG.md', CHANGELOG());
    execSync('git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG('- An unstaged essay entry with no issue link.'));
    const { code, stderr } = runHook(dir, 'git commit -am "docs: changelog"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a CRLF CHANGELOG is judged, not waved through', () => {
    // The parser used to read a CRLF file as zero entries, so the gate passed
    // anything in it: a guard failing open in silence.
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
      // which answers `?` for %m and exits 0: the trap this helper avoids.
      const arms = dialect === 'bsd'
        ? `case "$1" in -c) echo "stat: illegal option" >&2; exit 1 ;; -f) echo ${when}; exit 0 ;; esac`
        : `case "$1" in -f) echo '?'; exit 0 ;; -c) echo ${when}; exit 0 ;; esac`;
      stubTool(binDir, 'stat', ['#!/bin/sh', arms, 'exit 1']);
      const res = spawnSync(BASH, [...NO_RC, '-c',
        `. "${shellPath(LIB)}" && hook_file_mtime "${shellPath(file)}"`],
      { encoding: 'utf8', env: { ...process.env, PATH: pathWith(binDir) } });
      fs.rmSync(binDir, { recursive: true, force: true });
      return res.stdout.trim();
    };

    assertEq(readWith('gnu'), String(when), 'GNU: skips the `?` from -f and uses -c');
    assertEq(readWith('bsd'), String(when), 'BSD: falls past the unknown -c to -f');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  group('commit-gate: a Fixes #N commit stages its CHANGELOG entry');

  // Collapse on ship: the turn that closes an issue writes the entry the issue
  // closes against. Prose until now, and deterministically checkable.

  await test('a Fixes trailer with no CHANGELOG staged blocks', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
    execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    assert(stderr.includes('CHANGELOG'), `names the rule, got: ${stderr}`);
    assert(stderr.includes('Unreleased'), `and names the fix, got: ${stderr}`);
    cleanup(dir);
  });

  await test('the same commit with the entry staged passes', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG());
    execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    stage(dir, 'CHANGELOG.md', ENTRY);
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('Closes and Resolves are the same trailer', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
    execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    for (const word of ['Closes', 'Resolves', 'closes']) {
      const { code } = runHook(dir, `git commit -m "feat: a thing\n\n${word} #12"`);
      assertEq(code, 2, `${word} #N closes an issue too`);
    }
    cleanup(dir);
  });

  await test('no trailer: the commit is not asked for an entry', () => {
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ENTRY);
    execSync('git add CHANGELOG.md && git commit -q -m "seed" --no-verify', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing that closes nothing"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a repo that keeps no CHANGELOG.md is never asked for one', () => {
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    touchMarker(dir);
    const { code, stderr } = runHook(dir, 'git commit -m "feat: a thing\n\nFixes #4"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
