// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: heal bookkeeping skips the review and new-file
// checks, and a heal arm whose read fails is held by name; `jobRewrite` runs
// the real wk_changelog_job_rewrite. Each case ports the HEAD case its name
// quotes; the failing find is a failing git read now. Plus the rewrite entry,
// `changelog-job.sh rewrite a b`, against wk_changelog_job_rewrite, run in bash.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const { mkTmp } = require('../../lib/scratch');
const {
  WORKFLOW_DIR, JOB, TEMPLATE, PREFIX, T, NOTICE, mkRepo, stage, write, gitRm, unlink, commit, proveTree,
  judge, denyOf, blocks, passes, realRewrite,
} = require('./helpers');

// A repo with a committed settings.json: the stamp arm only exempts an edit
// that touches nothing but the version key.
const mkStampedRepo = () => {
  const r = mkRepo();
  stage(r, '.workkit/settings.json', '{ "version": 6, "enabled": true }\n');
  commit(r);
  return r;
};

// A repo whose last heal vendored the linter: the copy is committed, and so is
// the checks.yml an earlier template installed, whose changelog job runs that
// copy under the retired header paragraph.
const OLD_HEADER = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
  + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
  + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
const CHECKS_BODY = 'name: checks\n\non:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
const oldChecks = (copy) => `${OLD_HEADER}${CHECKS_BODY}  changelog:\n    runs-on: ubuntu-latest\n    steps:\n`
  + `      - uses: actions/checkout@v5\n      - name: CHANGELOG entry format\n        run: node ${copy} CHANGELOG.md --unreleased-only\n`;
const PR_ONLY = `${CHECKS_BODY}  changelog:\n    uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main\n`;

const scratchFile = (text) => {
  const file = path.join(mkTmp('cg-heal-'), 'checks.yml');
  fs.writeFileSync(file, text);
  return file;
};

// The heal's push trigger over a body, the heal's own answer.
const withPushTrigger = (body) => {
  const res = spawnSync(BASH, [...NO_RC, '-c', '. "$1"\nwk_checks_push_trigger "$2"', 'bash', shellPath(JOB), shellPath(scratchFile(body))],
    { encoding: 'utf8', timeout: 30000 });
  assertEq(res.status, 0, `wk_checks_push_trigger answers, stderr: ${res.stderr}`);
  return res.stdout;
};
// What the heal writes over it: the template's header paragraph, its one-line
// job, and the push trigger the PR-only body lacks.
const healedChecks = () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
  const from = template.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
  const to = template.findIndex((l, i) => i > from && !l.startsWith('#'));
  return withPushTrigger(`${template.slice(from, to).join('\n')}\n${PR_ONLY}`);
};
const PUSH = /^ {2}push:/m;
const CHECKS = '.github/workflows/checks.yml';
const VENDORED = '#!/usr/bin/env node\n// Vendored from the workflow core\'s changelog.js by standards.sh.\n';
const mkVendoredRepo = (name, { withChecks = true } = {}) => {
  const r = mkStampedRepo();
  stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
  stage(r, `.github/${name}`, VENDORED);
  if (withChecks) stage(r, CHECKS, oldChecks(`.github/${name}`));
  commit(r);
  return r;
};

const HELD = '. Its answer is unknown, so the commit is held; fix what failed, then commit.';

const run = async () => {
  group('commit-gate: heal bookkeeping skips review + new-file checks (issue #15)');

  await test('ports "version stamp alone, no marker: exit 0"', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    passes(await judge(r, 'git commit -m "chore(workflow): stamp"'), '', 'a stamp commit needs no review');
  });

  await test('ports "settings edit beyond the version, no marker: exit 2"', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": false }\n');
    blocks(await judge(r, 'git commit -m "chore: flip"'), T.noReview, 'only the version key is bookkeeping');
  });

  await test('ports "NEW settings.json (the opt-in commit), no marker: exit 2"', async () => {
    const r = mkRepo({ optIn: false });
    stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    blocks(await judge(r, 'git commit -m "chore: opt in"'), T.noReview, 'a first settings.json is not a stamp');
  });

  await test('ports "stamp + a source file, no marker: exit 2 (full gate restored)"', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "chore: mixed"'), T.noReview, 'any non-bookkeeping file restores the review requirement');
  });

  await test('ports "the copy deleted and checks.yml rewritten by the heal, with or without the stamp, no marker: exit 0"', async () => {
    for (const name of ['changelog-lint.cjs', 'changelog-lint.js']) {
      const r = mkVendoredRepo(name);
      gitRm(r, `.github/${name}`);
      assert(PUSH.test(healedChecks()) && !PUSH.test(oldChecks(`.github/${name}`)), 'the push trigger is in the diff');
      stage(r, CHECKS, healedChecks());
      proveTree(r);
      passes(await judge(r, 'git commit -m "chore(workflow): drop the linter copy"'), NOTICE.proved, `${name}: the heal's two changes need no review or test file`);
      stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
      proveTree(r);
      passes(await judge(r, 'git commit -m "chore(workflow): heal output"'), NOTICE.proved, `${name}: and with the stamp beside it`);
    }
  });

  await test('ports "the copy deleted alone where no workflow ever ran it, no marker: exit 0"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    gitRm(r, '.github/changelog-lint.cjs');
    proveTree(r);
    passes(await judge(r, 'git commit -m "chore(workflow): drop the linter copy"'), NOTICE.proved, 'nothing the commit leaves behind runs it');
  });

  await test('ports "under -a, the heal\'s unstaged deletion and rewrite are bookkeeping too: exit 0"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    unlink(r, '.github/changelog-lint.cjs');
    write(r, CHECKS, healedChecks());
    proveTree(r);
    passes(await judge(r, 'git commit -a -m "chore(workflow): drop the linter copy"'), NOTICE.proved, '-a stages exactly the heal\'s output');
  });

  await test('ports "under -a with autocrlf, a CRLF working tree carrying the heal\'s rewrite is bookkeeping: exit 0"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    r.autocrlf = true;
    unlink(r, '.github/changelog-lint.cjs');
    write(r, CHECKS, healedChecks().replace(/\n/g, '\r\n'));
    proveTree(r);
    passes(await judge(r, 'git commit -a -m "chore(workflow): drop the linter copy"'), NOTICE.proved, 'the CRLF file commits as the heal\'s exact rewrite');
  });

  await test('ports "checks.yml rewritten but for a trailing newline, no marker: exit 2"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, `${healedChecks()}\n\n`);
    blocks(await judge(r, 'git commit -m "chore: heal plus blank lines"'), T.noReview, 'byte for byte means the trailing newlines too');
  });

  await test('ports "a header-only swap above a job already in the uses: form, no marker: exit 0"', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    const current = healedChecks();
    const header = current.slice(0, current.indexOf('name: checks'));
    stage(r, CHECKS, current.replace(header, OLD_HEADER.replace('changelog-lint.cjs', 'changelog-lint.js')));
    commit(r);
    stage(r, CHECKS, current);
    proveTree(r);
    passes(await judge(r, 'git commit -m "chore(workflow): the header comment"'), NOTICE.proved, 'the heal\'s header swap alone needs no review');
  });

  await test('ports "the push trigger added alone to a PR-only checks.yml, no marker: exit 0"', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    stage(r, CHECKS, PR_ONLY);
    commit(r);
    const healed = withPushTrigger(PR_ONLY);
    assert(PUSH.test(healed) && !PUSH.test(PR_ONLY), `the trigger is in the diff, got: ${healed}`);
    stage(r, CHECKS, healed);
    proveTree(r);
    passes(await judge(r, 'git commit -m "chore(workflow): run checks on a push"'), NOTICE.proved, 'the heal\'s push trigger alone needs no review');
  });

  await test('ports "the copy deleted while checks.yml still runs it, no marker: exit 2"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    blocks(await judge(r, 'git commit -m "chore: drop the copy"'), T.noReview, 'a commit that breaks the CI job is not bookkeeping');
  });

  await test('ports "checks.yml rewritten with one more changed line, no marker: exit 2"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks().replace('runs-on: ubuntu-latest', 'runs-on: macos-14'));
    blocks(await judge(r, 'git commit -m "chore: heal plus an edit"'), T.noReview, 'only the heal\'s exact rewrite is bookkeeping');
  });

  await test('ports "the linter copy deleted beside a source file, no marker: exit 2"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m "chore: mixed"'), T.newFiles('app.js'), 'any other file in the commit restores the full gate');
  });

  await test('ports "a linter copy MODIFIED in place is not bookkeeping, no marker: exit 2"', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    stage(r, '.github/changelog-lint.cjs', `${VENDORED}// an edit\n`);
    blocks(await judge(r, 'git commit -m "chore: edit the copy"'), T.noReview, 'an edited copy is not the heal\'s output');
  });

  await test('ports "a linter copy ADDED is not bookkeeping, no marker: exit 2"', async () => {
    const engine = fs.readFileSync(path.join(WORKFLOW_DIR, 'changelog', 'changelog.js'), 'utf8');
    const nl = engine.indexOf('\n');
    const r = mkRepo();
    stage(r, '.github/changelog-lint.cjs',
      `${engine.slice(0, nl + 1)}// Vendored from the workflow core's changelog.js by standards.sh. The kit is the SSOT; edit it there. This copy is resynced on every heal.\n${engine.slice(nl + 1)}`);
    blocks(await judge(r, 'git commit -m "chore: a copy"'), T.noReview, 'only the deletion is the heal\'s output');
  });

  group('commit-gate: a heal-output check whose tool fails is held by name');

  await test('ports "a find that fails inside the linter-copy check is named with its stderr, never read as code": a git read fails there', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    r.failOn = (argv) => (path.basename(argv[0]) === 'git'
      && (argv.includes('ls-files') || argv.includes('checkout-index') || argv.includes('--diff-filter=D'))
      ? { exitCode: 128, stderr: 'fatal: the stub cannot read this folder\n' } : null);
    const deny = denyOf(await judge(r, 'git commit -m "chore(workflow): drop the linter copy"'));
    const shape = new RegExp(`^${PREFIX}the linter copy check could not run: \`git [^\`]+\` exited 128 \\(fatal: the stub cannot read this folder\\)`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command and its stderr are named, got: ${deny}`);
    assert(!deny.includes('no review has run'), `never the review bounce: ${deny}`);
  });

  await test('ports "a git that fails inside the version-stamp probe is named with its stderr, never read as a no"', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', '{ "version": 7, "enabled": true }\n');
    r.failOn = (argv) => (path.basename(argv[0]) === 'git' && argv.includes('rev-parse') && argv.includes('--verify')
      && argv.includes('HEAD:.workkit/settings.json') ? { exitCode: 128, stderr: 'fatal: the stub index is corrupt\n' } : null);
    const deny = denyOf(await judge(r, 'git commit -m "chore(workflow): stamp"'));
    const shape = new RegExp(`^${PREFIX}the version stamp check could not run: \`git [^\`]*rev-parse [^\`]*HEAD:\\.workkit/settings\\.json\` exited 128 \\(fatal: the stub index is corrupt\\)`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command, git's status and stderr, got: ${deny}`);
  });

  group('changelog-job.sh rewrite: the entry over wk_changelog_job_rewrite');

  await test('given the run of `changelog-job.sh rewrite a b` and `wk_changelog_job_rewrite a b`: the same text', () => {
    for (const body of [oldChecks('.github/changelog-lint.cjs'), PR_ONLY]) {
      const a = scratchFile(body);
      const entry = spawnSync(BASH, [...NO_RC, shellPath(JOB), 'rewrite', shellPath(a), shellPath(TEMPLATE)], { encoding: 'utf8', timeout: 30000 });
      const fn = realRewrite(a, TEMPLATE);
      assert(fn !== null && fn !== body, 'the function rewrites the file');
      assertEq(entry.status, 0, `the entry exits 0, stderr: ${entry.stderr}`);
      assertEq(entry.stdout, fn, 'and prints the function\'s text byte for byte');
    }
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
