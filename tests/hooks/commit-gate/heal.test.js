//
// Tests for hooks/safety/commit-gate: heal bookkeeping skips the review and
// new-file checks (issue #15).
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { SYSTEM_BASH } = require('../../lib/platform');
const { skipWithoutDigest, WORKFLOW_DIR, mkRepo, stage, stageDeep, runHook, cleanup } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: heal bookkeeping skips review + new-file checks (issue #15)');

  // A repo with a committed settings.json: the stamp arm only exempts an EDIT
  // that touches nothing but the version key.
  const mkStampedRepo = () => {
    const dir = mkRepo();
    stageDeep(dir, '.workkit/settings.json', '{ "version": 6, "enabled": true }\n');
    execSync('git commit -m "opt in"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    return dir;
  };

  await test('version stamp alone, no marker: exit 0', () => {
    const dir = mkStampedRepo();
    stage(dir, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    const { code, stderr } = runHook(dir, 'git commit -m "chore(workflow): stamp"');
    assertEq(code, 0, `a stamp commit needs no review, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('settings edit beyond the version, no marker: exit 2', () => {
    const dir = mkStampedRepo();
    stage(dir, '.workkit/settings.json', '{ "version": 7, "enabled": false }\n');
    const { code } = runHook(dir, 'git commit -m "chore: flip"');
    assertEq(code, 2, 'only the version key is bookkeeping: an enabled flip gets the full gate');
    cleanup(dir);
  });

  await test('NEW settings.json (the opt-in commit), no marker: exit 2', () => {
    const dir = mkRepo();
    stageDeep(dir, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    const { code } = runHook(dir, 'git commit -m "chore: opt in"');
    assertEq(code, 2, 'a first settings.json is not a stamp');
    cleanup(dir);
  });

  await test('stamp + a source file, no marker: exit 2 (full gate restored)', () => {
    const dir = mkStampedRepo();
    stage(dir, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code } = runHook(dir, 'git commit -m "chore: mixed"');
    assertEq(code, 2, 'any non-bookkeeping file restores the review requirement');
    cleanup(dir);
  });

  // A repo whose last heal vendored the linter: the copy is committed, and so
  // is the checks.yml an earlier template installed, whose changelog job runs
  // that copy under the retired header paragraph. `withChecks: false` is a
  // repo whose workflows never named the copy.
  const OLD_HEADER = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
    + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
    + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
  const CHECKS_BODY = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
  const oldChecks = (copy) => `${OLD_HEADER}${CHECKS_BODY}  changelog:\n    runs-on: ubuntu-latest\n    steps:\n`
    + `      - uses: actions/checkout@v5\n      - name: CHANGELOG entry format\n        run: node ${copy} CHANGELOG.md --unreleased-only\n`;
  // What the heal writes over it: the template's header paragraph and its one-line job.
  const healedChecks = () => {
    const template = fs.readFileSync(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml'), 'utf8').split('\n');
    const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
    const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
    return `${template.slice(from, to).join('\n')}\n${CHECKS_BODY}  changelog:\n`
      + '    uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main\n';
  };
  const CHECKS = '.github/workflows/checks.yml';
  const mkVendoredRepo = (name, { withChecks = true } = {}) => {
    const dir = mkStampedRepo();
    // A test script makes checks 1 and 5 live; the suite itself passes.
    stage(dir, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    stageDeep(dir, `.github/${name}`, '#!/usr/bin/env node\n// Vendored from the workflow core\'s changelog.js by standards.sh.\n');
    if (withChecks) stageDeep(dir, CHECKS, oldChecks(`.github/${name}`));
    execSync('git commit -q -m "base"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    return dir;
  };

  await test('the copy deleted and checks.yml rewritten by the heal, with or without the stamp, no marker: exit 0', () => {
    for (const name of ['changelog-lint.cjs', 'changelog-lint.js']) {
      const dir = mkVendoredRepo(name);
      execSync(`git rm -q .github/${name}`, { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
      stage(dir, CHECKS, healedChecks());
      const heal = runHook(dir, 'git commit -m "chore(workflow): drop the linter copy"');
      assertEq(heal.code, 0, `${name}: the heal's two changes need no review or test file, stderr: ${heal.stderr}`);
      stage(dir, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
      const withStamp = runHook(dir, 'git commit -m "chore(workflow): heal output"');
      assertEq(withStamp.code, 0, `${name}: and with the stamp beside it, stderr: ${withStamp.stderr}`);
      cleanup(dir);
    }
  });

  await test('the copy deleted alone where no workflow ever ran it, no marker: exit 0', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    execSync('git rm -q .github/changelog-lint.cjs', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    const { code, stderr } = runHook(dir, 'git commit -m "chore(workflow): drop the linter copy"');
    assertEq(code, 0, `nothing the commit leaves behind runs it, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('under -a, the heal\'s unstaged deletion and rewrite are bookkeeping too: exit 0', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs');
    fs.rmSync(path.join(dir, '.github', 'changelog-lint.cjs'));
    fs.writeFileSync(path.join(dir, CHECKS), healedChecks());
    const { code, stderr } = runHook(dir, 'git commit -a -m "chore(workflow): drop the linter copy"');
    assertEq(code, 0, `-a stages exactly the heal's output, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('under -a with autocrlf, a CRLF working tree carrying the heal\'s rewrite is bookkeeping: exit 0', () => {
    // Git for Windows checks files out CRLF and commits them LF: the blob the
    // commit carries is what is compared, never the working tree's bytes.
    const dir = mkVendoredRepo('changelog-lint.cjs');
    execSync('git config core.autocrlf true', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    fs.rmSync(path.join(dir, '.github', 'changelog-lint.cjs'));
    fs.writeFileSync(path.join(dir, CHECKS), healedChecks().replace(/\n/g, '\r\n'));
    const { code, stderr } = runHook(dir, 'git commit -a -m "chore(workflow): drop the linter copy"');
    assertEq(code, 0, `the CRLF file commits as the heal's exact rewrite, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('checks.yml rewritten but for a trailing newline, no marker: exit 2', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs');
    execSync('git rm -q .github/changelog-lint.cjs', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, CHECKS, `${healedChecks()}\n\n`);
    const { code } = runHook(dir, 'git commit -m "chore: heal plus blank lines"');
    assertEq(code, 2, 'byte for byte means the trailing newlines too');
    cleanup(dir);
  });

  await test('a header-only swap above a job already in the uses: form, no marker: exit 0', () => {
    const dir = mkStampedRepo();
    stage(dir, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    const current = healedChecks();
    const header = current.slice(0, current.indexOf('name: checks'));
    stageDeep(dir, CHECKS, current.replace(header, OLD_HEADER.replace('changelog-lint.cjs', 'changelog-lint.js')));
    execSync('git commit -q -m "base"', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, CHECKS, current);
    const { code, stderr } = runHook(dir, 'git commit -m "chore(workflow): the header comment"');
    assertEq(code, 0, `the heal's header swap alone needs no review, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('the copy deleted while checks.yml still runs it, no marker: exit 2', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs');
    execSync('git rm -q .github/changelog-lint.cjs', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    const { code } = runHook(dir, 'git commit -m "chore: drop the copy"');
    assertEq(code, 2, 'a commit that breaks the CI job is not bookkeeping');
    cleanup(dir);
  });

  await test('checks.yml rewritten with one more changed line, no marker: exit 2', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs');
    execSync('git rm -q .github/changelog-lint.cjs', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, CHECKS, healedChecks().replace('runs-on: ubuntu-latest', 'runs-on: macos-14'));
    const { code } = runHook(dir, 'git commit -m "chore: heal plus an edit"');
    assertEq(code, 2, 'only the heal\'s exact rewrite is bookkeeping');
    cleanup(dir);
  });

  await test('the linter copy deleted beside a source file, no marker: exit 2', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    execSync('git rm -q .github/changelog-lint.cjs', { cwd: dir, stdio: 'pipe', shell: SYSTEM_BASH });
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code } = runHook(dir, 'git commit -m "chore: mixed"');
    assertEq(code, 2, 'any other file in the commit restores the full gate');
    cleanup(dir);
  });

  await test('a linter copy MODIFIED in place is not bookkeeping, no marker: exit 2', () => {
    const dir = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    stage(dir, '.github/changelog-lint.cjs', '#!/usr/bin/env node\n// Vendored from the workflow core\'s changelog.js by standards.sh.\n// an edit\n');
    const { code } = runHook(dir, 'git commit -m "chore: edit the copy"');
    assertEq(code, 2, 'an edited copy is not the heal\'s output');
    cleanup(dir);
  });

  await test('a linter copy ADDED is not bookkeeping, no marker: exit 2', () => {
    // The exact shape the heal used to vendor, byte for byte with the engine,
    // so no content check can be what bounces it.
    const engine = fs.readFileSync(path.join(WORKFLOW_DIR, 'changelog.js'), 'utf8');
    const nl = engine.indexOf('\n');
    const dir = mkRepo();
    stageDeep(dir, '.github/changelog-lint.cjs',
      `${engine.slice(0, nl + 1)}// Vendored from the workflow core's changelog.js by standards.sh. The kit is the SSOT; edit it there. This copy is resynced on every heal.\n${engine.slice(nl + 1)}`);
    const { code } = runHook(dir, 'git commit -m "chore: a copy"');
    assertEq(code, 2, 'only the deletion is the heal\'s output: a copy in the tree gets the full gate');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
