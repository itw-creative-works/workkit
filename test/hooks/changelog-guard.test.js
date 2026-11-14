// Tests for docs:changelog-guard's logic, changelogGuardVerdict(path,
// lintResult) in hooks/mods/changelog-guard.js. The lint result is the real
// linter's, run the way the module runs it (`node lint.js <file>
// --added-only`), so judging only what a change added is proved end to end.
// The rules are test/scripts/changelog.test.js's; the wiring cases (no
// file_path, a file that is gone, the registration) are
// test/mods/post-tool-use.test.ts.

const path = require('path');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { mods, textOf, runResult } = require('../lib/mods-inputs');

const LINTER = path.join(__dirname, '..', '..', 'workflow', 'changelog', 'lint.js');
const ISSUE = '[#4](https://github.com/o/r/issues/4)';

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const doc = (...bullets) => ['# Changelog', '', '## [Unreleased]', '', '### Added', '', ...bullets.flatMap((b) => [b, ''])].join('\n');

/** The linter's run on `file`, as the process.run result the module receives. */
const lint = (file) => {
  const res = spawnSync(process.execPath, [LINTER, file, '--added-only'], { cwd: path.dirname(file), encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return runResult({ exitCode: res.status, stdout: res.stdout || '', stderr: res.stderr || '' });
};
const verdict = (file, result = lint(file)) => textOf(mods('changelog-guard').changelogGuardVerdict(file, result));

/** A repo whose committed CHANGELOG is `initial`, so diffs are genuine. */
const mkRepo = (initial) => {
  const dir = mkTmp('clg-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), initial);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
};

const append = (dir, line) => {
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}${line}\n`);
  return file;
};

describe('changelog-guard: scope', () => {
  test('a file that is not a CHANGELOG is ignored', () => {
    const failing = runResult({ exitCode: 1, stderr: 'issue-link: no issue link\n' });
    expect(verdict('/w/repo/README.md', failing), 'the path decides, whatever a lint said').toBe('');
  });
});

describe('changelog-guard: judging', () => {
  test('a new entry in the format passes', () => {
    const dir = mkRepo(doc());
    const file = append(dir, `- ${ISSUE} - Plugins install from settings.json.`);
    expect(verdict(file), 'passes').toBe('');
    cleanup(dir);
  });

  test('a new essay entry blocks with exit 2 and names the rule', () => {
    const dir = mkRepo(doc());
    const file = append(dir, `- **Plugins are installed from a declaration.** ${new Array(60).fill('word').join(' ')}`);
    const out = verdict(file);
    expect(out.includes('issue-link'), `names the rule, got: ${out}`).toBeTruthy();
    expect(out.includes('word-cap'), `names every broken rule at once, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });

  // Adopting the format must never bounce a repo for its history.
  test('a legacy entry the write did not touch does not block', () => {
    const dir = mkRepo(doc('- A legacy essay entry with no issue link at all.'));
    const file = append(dir, `- ${ISSUE} - A properly formatted new entry.`);
    expect(verdict(file), 'passes').toBe('');
    cleanup(dir);
  });

  test('a correct entry in a keepachangelog file with a link footer passes', () => {
    const dir = mkRepo(['# Changelog', '', '## [Unreleased]', '', '### Added', '', '[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD', ''].join('\n'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('[Unreleased]:', `- ${ISSUE} - A correct new entry.\n\n[Unreleased]:`));
    expect(verdict(file), 'passes').toBe('');
    cleanup(dir);
  });

  // With no git to ask, everything is new: a first CHANGELOG is still judged.
  test('a CHANGELOG outside git is judged in full', () => {
    const dir = mkTmp('clg-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('- An essay entry with no issue link.'));
    expect(verdict(file).length > 0, 'blocked').toBeTruthy();
    cleanup(dir);
  });
});

describe('changelog-guard.js: linterPath', () => {
  test('linterPath is the plugin\'s workflow/changelog/lint.js, and WORKFLOW_DIR wins over <pluginRoot>/workflow', () => {
    const { linterPath } = mods('changelog-guard');
    expect(linterPath({}, '/k'), 'the plugin root\'s engine').toBe('/k/workflow/changelog/lint.js');
    expect(linterPath({ WORKFLOW_DIR: '/e' }, '/k'), 'WORKFLOW_DIR names another engine').toBe('/e/changelog/lint.js');
  });
});
