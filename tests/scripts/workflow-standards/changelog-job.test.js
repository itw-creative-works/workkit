//
// Tests for standards.sh: the retired CHANGELOG linter copy and the changelog
// job in checks.yml.
// The shared prologue (the repo and gh-stub factories, runScript, the constants) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { WORKFLOW_DIR, cleanup, makeRepo, makeGhStub, readFile, runScript } = require('./helpers');

const run = async () => {
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

  group('standards.sh: the changelog job in checks.yml');

  // The job line the template carries: CI lints through the kit's reusable workflow.
  const USES = 'uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main';
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

  await test('a freshly installed checks.yml carries the job', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(path.join(repo, '.github', 'workflows', 'checks.yml'));
    assert(/^ {2}changelog:$/m.test(body), `the job is defined, got: ${body}`);
    assert(body.includes(`  changelog:\n    ${USES}\n`), `and calls the kit's workflow, got: ${body}`);
    assert(!body.includes('changelog-lint'), 'no vendored copy is named anywhere');
    assert(output.includes('changelog job is already in'), `no second append, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a checks.yml healed before this standard gains the job, keeping its own edits', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const owned = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n  test:\n    runs-on: macos-14\n    steps:\n      - run: npm test\n';
    fs.writeFileSync(file, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    const body = readFile(file);
    assert(body.startsWith(owned), 'every line the repo owned survives, in place');
    assert(/^ {2}changelog:$/m.test(body), `the job is appended, got: ${body}`);
    assert(body.endsWith(`  changelog:\n    ${USES}\n`), `calling the kit's workflow, got: ${body}`);
    assert(output.includes('checks: added the changelog job'), `reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the job is added once: a second heal appends nothing', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n');
    runScript(repo, { pathPrefix: stub.binDir });
    const once = readFile(file);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), once, 'idempotent');
    assert(output.includes('changelog job is already in'), `seen as present, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a job running a vendored copy is rewritten in place to call the kit\'s workflow, once', () => {
    for (const copy of ['.github/changelog-lint.cjs', '.github/changelog-lint.js']) {
      const repo = makeRepo();
      const stub = makeGhStub();
      const file = path.join(repo, '.github', 'workflows', 'checks.yml');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
      const tail = '\n\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run lint\n';
      fs.writeFileSync(file, `${head}${nodeJob(copy)}${tail}`);
      const { output } = runScript(repo, { pathPrefix: stub.binDir });
      assertEq(readFile(file), `${head}  changelog:\n    ${USES}${tail}`,
        `${copy}: only the changelog job changed, and the job after it survives`);
      assert(output.includes('checks: the changelog job in .github/workflows/checks.yml now calls the kit\'s workflow; commit it'),
        `${copy}: reported, got: ${output}`);
      const once = readFile(file);
      const again = runScript(repo, { pathPrefix: stub.binDir }).output;
      assertEq(readFile(file), once, `${copy}: idempotent`);
      assert(!again.includes('now calls the kit\'s workflow'), `${copy}: no second rewrite, got: ${again}`);
      assert(again.includes('changelog job is already in'), `${copy}: seen as current, got: ${again}`);
      cleanup(repo); cleanup(stub.dir);
    }
  });

  await test('the job ends at the next job whatever its id, and the comment above that job stays', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    const tail = '\n\n  # end to end, on every pull request\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run e2e\n  lint.v2:\n    runs-on: ubuntu-latest\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}${tail}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}${tail}`,
      `the e2e and lint.v2 jobs and the comment above them survive, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('the retired header comment is replaced by the template\'s own, with the job', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const oldHeader = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
      + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
      + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
    // The template's current paragraph: the anchor line through its last comment line.
    const template = readFile(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml')).split('\n');
    const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
    const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
    const newHeader = `${template.slice(from, to).join('\n')}\n`;
    assert(from !== -1 && newHeader !== oldHeader, 'the template carries a different paragraph');
    const intro = '# Checks: the repo\'s own words.\n#\n';
    const body = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    fs.writeFileSync(file, `${intro}${oldHeader}${body}${nodeJob('.github/changelog-lint.cjs')}\n`);
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${intro}${newHeader}${body}  changelog:\n    ${USES}\n`,
      'the old paragraph is swapped for the template\'s, and nothing else in the header moves');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a retired header above a job already in the uses: form is swapped on its own, once', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const older = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
      + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
      + '# changelog.js the heal vendors to .github/changelog-lint.js on every run.\n';
    const template = readFile(path.join(WORKFLOW_DIR, 'templates', 'github-workflows', 'checks.yml')).split('\n');
    const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
    const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
    const newHeader = `${template.slice(from, to).join('\n')}\n`;
    const body = `name: checks\n\non:\n  pull_request:\n\njobs:\n  changelog:\n    ${USES}\n`;
    fs.writeFileSync(file, `${older}${body}`);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${newHeader}${body}`, `the header swapped and the job untouched, got: ${output}`);
    assert(output.includes('checks: the header comment in .github/workflows/checks.yml now describes the kit\'s workflow; commit it'),
      `reported, got: ${output}`);
    const again = runScript(repo, { pathPrefix: stub.binDir }).output;
    assertEq(readFile(file), `${newHeader}${body}`, 'a second heal changes nothing');
    assert(!again.includes('now describes the kit\'s workflow'), `and says nothing of it, got: ${again}`);
    assert(again.includes('changelog job is already in'), `seen as current, got: ${again}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a comment naming the copy does not hold the copy in place', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const other = path.join(repo, '.github', 'workflows', 'release.yml');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, 'name: release\n# the old linter lived at .github/changelog-lint.cjs\non:\n  push:\n');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assert(!fs.existsSync(cjs), `a comment is not a run, so the copy is removed, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a job that is the last one in the file is rewritten to the end', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}\n`, 'the old job is replaced whole');
    cleanup(repo); cleanup(stub.dir);
  });

  // The heal rewrites the job BEFORE it removes the copy: the other order finds
  // the old job still naming the copy, keeps the copy, and leaves a repo that
  // needs a second heal.
  await test('one heal rewrites a job running the copy and then removes the copy', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    fs.writeFileSync(file, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    git(repo, 'add', '.github');
    git(repo, 'commit', '-q', '-m', 'the vendored copy and the job running it');
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), `${head}  changelog:\n    ${USES}\n`, `the job calls the kit's workflow, got: ${output}`);
    assert(!fs.existsSync(cjs), `and the copy is gone in the same heal, got: ${output}`);
    assertEq(git(repo, 'status', '--porcelain', '--', '.github/changelog-lint.cjs').stdout,
      ' D .github/changelog-lint.cjs\n', 'the deletion is left unstaged');
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a copy another workflow still runs is kept and reported, even once checks.yml is rewritten', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const cjs = writeCopy(repo, 'changelog-lint.cjs', VENDORED_COPY);
    const head = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';
    const checks = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(checks), { recursive: true });
    fs.writeFileSync(checks, `${head}${nodeJob('.github/changelog-lint.cjs')}\n`);
    const other = path.join(repo, '.github', 'workflows', 'release.yml');
    const owned = 'name: release\n\non:\n  push:\n\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n';
    fs.writeFileSync(other, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(checks), `${head}  changelog:\n    ${USES}\n`, `the job the heal owns is rewritten, got: ${output}`);
    assertEq(readFile(cjs), VENDORED_COPY, 'the copy stays, since deleting it would break release.yml');
    assertEq(readFile(other), owned, 'and the workflow the heal does not own is untouched');
    assert(output.includes('changelog lint: kept .github/changelog-lint.cjs: a workflow under .github/workflows still runs it'),
      `the keep is reported, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  await test('a workflow that does not end in its jobs: block is described, never rewritten', () => {
    const repo = makeRepo();
    const stub = makeGhStub();
    const file = path.join(repo, '.github', 'workflows', 'checks.yml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const owned = 'name: checks\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n\nconcurrency:\n  group: checks\n';
    fs.writeFileSync(file, owned);
    const { output } = runScript(repo, { pathPrefix: stub.binDir });
    assertEq(readFile(file), owned, 'a layout the script cannot reason about is left exactly as found');
    assert(output.includes('does not end in its jobs: block'), `says so, got: ${output}`);
    assert(output.includes(USES), `and names the line to add by hand, got: ${output}`);
    cleanup(repo); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
