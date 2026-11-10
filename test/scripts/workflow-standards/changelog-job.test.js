// Tests for standards.sh: the retired CHANGELOG linter copy, and a checks.yml
// job running it; the caller itself is ./checks-caller.test.js.
// The shared prologue is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');
const { stubTool } = require('../../lib/platform');

const cases = async () => {
  group('standards.sh: the retired CHANGELOG linter copy');

  // What an earlier heal vendored: a shebang, the vendor header on line 2,
  // then the linter's body.
  const VENDORED_COPY = '#!/usr/bin/env node\n// Vendored from the workflow core\'s changelog.js by standards.sh. The kit is the SSOT; edit it there. This copy is resynced on every heal.\nconsole.log("lint");\n';
  const git = (repo, ...args) => spawnSync('git',
    ['-c', 'user.name=checks', '-c', 'user.email=checks@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
  const writeCopy = (repo, name, body) => {
    const file = path.join(repo, '.github', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };

  await test('a copy the kit vendored is removed, the deletion left unstaged like every heal output', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const js = writeCopy(repo, 'changelog-lint.js', VENDORED_COPY);
    git(repo, 'add', '.github/changelog-lint.cjs');
    git(repo, 'commit', '-q', '-m', 'the vendored copy');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(cjs), `the tracked copy is gone, got: ${output}`);
    assert(!fs.existsSync(js), `and so is the untracked legacy one, got: ${output}`);
    assertEq(git(repo, 'status', '--porcelain', '--', '.github/changelog-lint.cjs').stdout,
      ' D .github/changelog-lint.cjs\n', 'the deletion is in the working tree, never staged');
    assert(output.includes('changelog lint: removed .github/changelog-lint.cjs, CI runs the kit\'s workflow now; commit it'),
      `the tracked removal is reported, got: ${output}`);
    assert(output.includes('changelog lint: removed .github/changelog-lint.js'), `and the untracked one, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the removal runs once: a second heal finds nothing and says nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const once = runScript(repo, { pathPrefix: stub.binDir }).output;
    assert(once.includes('changelog lint: removed'), `the first heal removed it, got: ${once}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!output.includes('changelog lint'), `nothing to say the second time, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy without the vendor header is reported and kept', () => {
    for (const name of ['changelog-lint.cjs', 'changelog-lint.js']) {
      const repo = makeRepo();
      const stub = makeGhStub();
      const owned = '#!/usr/bin/env node\n// a linter someone here wrote\n';
      const file = writeCopy(repo, name, owned);
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(readFile(file), owned, `${name}: a file without the vendor header is left exactly as found`);
      assert(output.includes(`.github/${name} is not the kit's copy`), `${name}: and reported, got: ${output}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('a repo with no copy gets none, and hears nothing about it', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(path.join(repo, '.github', 'changelog-lint.cjs')), 'no copy is vendored');
    assert(!fs.existsSync(path.join(repo, '.github', 'changelog-lint.js')), 'under either name');
    assert(!output.includes('changelog lint'), `and the step is silent, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  group('standards.sh: a checks.yml job running the copy');

  // The caller's one job line: the kit's reusable workflow runs the checks.
  const CALLER = 'uses: itw-creative-works/workkit/.github/workflows/ci.yml@main';
  // checks.yml is the kit's caller now, naming no copy.
  const isCaller = (body) => body.includes(CALLER) && !body.includes('changelog-lint');
  // The job an earlier template installed, running a vendored copy by name.
  const nodeJob = (copy) => [
    '  changelog:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v5',
    '      - name: CHANGELOG entry format',
    '        run: |',
    '          if [ -f CHANGELOG.md ]; then',
    `            node ${copy} CHANGELOG.md --unreleased-only`,
    '          else',
    '            echo "no CHANGELOG.md, nothing to check"',
    '          fi',
  ].join('\n');

  // The heal replaces checks.yml before it removes the copy: the other order
  // finds the old job still naming the copy, keeps the copy, and leaves a repo
  // that needs a second heal.
  await test('one heal replaces a checks.yml running the copy with the caller and then removes the copy', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true });
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    git(repo, 'add', '.github');
    git(repo, 'commit', '-q', '-m', 'the vendored copy and the job running it');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(isCaller(readFile(file)), `checks.yml is the caller, got: ${readFile(file)}\n${output}`);
    assert(!fs.existsSync(cjs), `and the copy is gone in the same heal, got: ${output}`);
    assertEq(git(repo, 'status', '--porcelain', '--', '.github/changelog-lint.cjs').stdout,
      ' D .github/changelog-lint.cjs\n', 'the deletion is left unstaged');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy another workflow still runs is kept and reported, even once checks.yml is replaced', () => {
    const repo = makeRepo();
    const stub = makeGhStub({ repoRead: true });
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const head = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n';
    const checks = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(checks), { recursive: true });
    fs.writeFileSync(checks, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    const other = path.join(repo, '.github', 'workflows', 'release.yml');
    const owned = 'name: release\n\non:\n  push:\n\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n';
    fs.writeFileSync(other, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(isCaller(readFile(checks)), `the file the heal owns is the caller, got: ${readFile(checks)}\n${output}`);
    assertEq(readFile(cjs), VENDORED_COPY, 'the copy stays, since deleting it would break release.yml');
    assertEq(readFile(other), owned, 'and the workflow the heal does not own is untouched');
    assert(output.includes('changelog lint: kept .github/changelog-lint.cjs: a workflow under .github/workflows still runs it'),
      `the keep is reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy is kept when the workflows cannot be read, and the heal says why', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    stubTool(stub.binDir, 'find', ['#!/bin/bash', 'echo "find: stub" >&2', 'exit 1']);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(cjs), VENDORED_COPY, `nothing proves the copy unused, so it stays, got: ${output}`);
    assert(output.includes('changelog lint: kept .github/changelog-lint.cjs: .github/workflows could not be read'),
      `the keep names the unread folder, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
