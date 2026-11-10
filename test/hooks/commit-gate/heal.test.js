// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in hooks/mods/commit-gate.js: heal
// bookkeeping skips the review and new-file checks, and a heal arm whose tool fails or never starts
// is held by name; `jobRewrite` runs the real `changelog-job.sh rewrite`, whose answer is the kit's
// caller on the root's default branch. The shared prologue (repo, facts, texts) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  WORKFLOW_DIR, TEMPLATE, PREFIX, T, NOTICE, mkRepo, stage, gitRm, commit, proveTree,
  judge, denyOf, blocks, passes, realRewrite,
} = require('./helpers');
const { withSteps, withCloneStep, OLD_CHECKS } = require('../../lib/checks-template');
const { OPT_IN_SHAPES } = require('../../lib/git-repo');

// A repo with a committed settings.json carrying a version key: the bookkeeping
// arm only exempts an edit that touches nothing but that key, here its removal.
const mkStampedRepo = () => {
  const r = mkRepo();
  stage(r, '.workkit/settings.json', OPT_IN_SHAPES.retired);
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

// What the heal writes over any checks.yml: the kit's caller on main, the
// default branch the world's root names unless a case sets another.
const CALLER_JOB = '  checks:\n    uses: itw-creative-works/workkit/.github/workflows/ci.yml@main\n    secrets: inherit\n';
const healedChecks = () => {
  const caller = fs.readFileSync(TEMPLATE, 'utf8').replace('__DEFAULT_BRANCH__', 'main');
  assert(caller.includes(CALLER_JOB) && caller.includes('    branches: [main]\n'), `the caller calls ci.yml on main, got: ${caller}`);
  return caller;
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

const cases = async () => {
  group('commit-gate: heal bookkeeping skips review + new-file checks (issue #15)');

  await test('the version key removed alone, no marker: exit 0', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', OPT_IN_SHAPES.current);
    passes(await judge(r, 'chore(workflow): drop the version key'), '', 'the removal needs no review');
  });

  await test('settings edit beyond the version, no marker: exit 2', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', '{ "enabled": false }\n');
    blocks(await judge(r, 'chore: flip'), T.noReview, 'only the version key is bookkeeping');
  });

  await test('NEW settings.json (the opt-in commit), no marker: exit 2', async () => {
    const r = mkRepo({ optIn: false });
    stage(r, '.workkit/settings.json', OPT_IN_SHAPES.current);
    blocks(await judge(r, 'chore: opt in'), T.noReview, 'a first settings.json is not a stamp');
  });

  await test('the key removed + a source file, no marker: exit 2', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', OPT_IN_SHAPES.current);
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'chore: mixed'), T.noReview, 'any non-bookkeeping file restores the review requirement');
  });

  await test('the copy deleted and checks.yml rewritten by the heal, with or without the key removed, no marker: exit 0', async () => {
    for (const name of ['changelog-lint.cjs', 'changelog-lint.js']) {
      const r = mkVendoredRepo(name);
      gitRm(r, `.github/${name}`);
      assert(PUSH.test(healedChecks()) && !PUSH.test(oldChecks(`.github/${name}`)), 'the push trigger is in the diff');
      stage(r, CHECKS, healedChecks());
      proveTree(r);
      passes(await judge(r, 'chore(workflow): drop the linter copy'), NOTICE.proved, `${name}: the heal's two changes need no review or test file`);
      stage(r, '.workkit/settings.json', OPT_IN_SHAPES.current);
      proveTree(r);
      passes(await judge(r, 'chore(workflow): heal output'), NOTICE.proved, `${name}: and with the removal beside it`);
    }
  });

  await test('the copy deleted alone where no workflow ever ran it, no marker: exit 0', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    gitRm(r, '.github/changelog-lint.cjs');
    proveTree(r);
    passes(await judge(r, 'chore(workflow): drop the linter copy'), NOTICE.proved, 'nothing the commit leaves behind runs it');
  });

  await test('checks.yml rewritten but for a trailing newline, no marker: exit 2', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, `${healedChecks()}\n\n`);
    blocks(await judge(r, 'chore: heal plus blank lines'), T.noReview, 'byte for byte means the trailing newlines too');
  });

  await test('an older checks.yml replaced by the caller alone, whatever it held, no marker: exit 0', async () => {
    const olders = {
      'the last template': OLD_CHECKS,
      'a PR-only copy': PR_ONLY,
      'a copy with the kit clone step': withCloneStep(OLD_CHECKS),
      'a copy with steps of its own': withSteps(OLD_CHECKS, ['      - name: Install ffmpeg', '        run: sudo apt-get install -y ffmpeg']),
    };
    for (const [what, older] of Object.entries(olders)) {
      const r = mkStampedRepo();
      stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
      stage(r, CHECKS, older);
      commit(r);
      stage(r, CHECKS, healedChecks());
      proveTree(r);
      passes(await judge(r, 'chore(workflow): the kit\'s CI caller'), NOTICE.proved, `${what}: the heal's rewrite alone needs no review`);
    }
  });

  await test('a hand edit to the caller undone by the heal, no marker: exit 0', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    stage(r, CHECKS, `${healedChecks()}  extra:\n    uses: someone/else/.github/workflows/x.yml@main\n`);
    commit(r);
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    passes(await judge(r, 'chore(workflow): restore the caller'), NOTICE.proved, 'restoring the caller is the heal\'s output');
  });

  await test('the copy deleted while checks.yml still runs it, no marker: exit 2', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    blocks(await judge(r, 'chore: drop the copy'), T.noReview, 'a commit that breaks the CI job is not bookkeeping');
  });

  await test('the still-runs question hands the entry its texts on stdin as `names -`, never a /dev/stdin path', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    await judge(r, 'chore: drop the copy');
    const asked = r.calls.run.find((c) => c.argv.some((a) => a.endsWith('changelog-job.sh')) && c.argv.includes('names'));
    assert(asked !== undefined, 'the entry was asked');
    assertEq(asked.argv.slice(asked.argv.indexOf('names')).join(' '), 'names - .github/changelog-lint.cjs', 'the stdin marker, then the copy');
    assert(asked.init.stdin.includes('.github/changelog-lint.cjs'), 'the workflow texts ride on stdin');
  });

  await test('checks.yml rewritten with one more changed line, no marker: exit 2', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks().replace('branches: [main]', 'branches: [develop]'));
    blocks(await judge(r, 'chore: heal plus an edit'), T.noReview, 'only the heal\'s exact rewrite is bookkeeping');
  });

  await test('the linter copy deleted beside a source file, no marker: exit 2', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'chore: mixed'), T.newFiles('app.js'), 'any other file in the commit restores the full gate');
  });

  await test('a linter copy MODIFIED in place is not bookkeeping, no marker: exit 2', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs', { withChecks: false });
    stage(r, '.github/changelog-lint.cjs', `${VENDORED}// an edit\n`);
    blocks(await judge(r, 'chore: edit the copy'), T.noReview, 'an edited copy is not the heal\'s output');
  });

  await test('a linter copy ADDED is not bookkeeping, no marker: exit 2', async () => {
    const engine = fs.readFileSync(path.join(WORKFLOW_DIR, 'changelog', 'lint.js'), 'utf8');
    const nl = engine.indexOf('\n');
    const r = mkRepo();
    stage(r, '.github/changelog-lint.cjs',
      `${engine.slice(0, nl + 1)}// Vendored from the workflow core's changelog.js by standards.sh. The kit is the SSOT; edit it there. This copy is resynced on every heal.\n${engine.slice(nl + 1)}`);
    blocks(await judge(r, 'chore: a copy'), T.noReview, 'only the deletion is the heal\'s output');
  });

  group('commit-gate: a heal-output check whose tool fails is held by name');

  await test('a find that fails inside the linter-copy check is named with its stderr, never read as code: a git read fails there', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    r.failOn = (argv) => (path.basename(argv[0]) === 'git'
      && (argv.includes('ls-files') || argv.includes('checkout-index') || argv.includes('--diff-filter=D'))
      ? { exitCode: 128, stderr: 'fatal: the stub cannot read this folder\n' } : null);
    const deny = denyOf(await judge(r, 'chore(workflow): drop the linter copy'));
    const shape = new RegExp(`^${PREFIX}the linter copy check could not run: \`git [^\`]+\` exited 128 \\(fatal: the stub cannot read this folder\\)`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command and its stderr are named, got: ${deny}`);
    assert(!deny.includes('no review has run'), `never the review bounce: ${deny}`);
  });

  await test('a git that fails inside the version-stamp probe is named with its stderr, never read as a no', async () => {
    const r = mkStampedRepo();
    stage(r, '.workkit/settings.json', OPT_IN_SHAPES.current);
    r.failOn = (argv) => (path.basename(argv[0]) === 'git' && argv.includes('rev-parse') && argv.includes('--verify')
      && argv.includes('HEAD:.workkit/settings.json') ? { exitCode: 128, stderr: 'fatal: the stub index is corrupt\n' } : null);
    const deny = denyOf(await judge(r, 'chore(workflow): drop the version key'));
    const shape = new RegExp(`^${PREFIX}the version stamp check could not run: \`git [^\`]*rev-parse [^\`]*HEAD:\\.workkit/settings\\.json\` exited 128 \\(fatal: the stub index is corrupt\\)`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command, git's status and stderr, got: ${deny}`);
  });

  await test('a tool that did not start inside the linter-copy check holds the commit naming the check, the command and did not start', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    r.failOn = (argv) => (argv.some((a) => a.endsWith('changelog-job.sh')) && argv.includes('names')
      ? { isStarted: false, stderr: 'spawn bash ENOENT' } : null);
    const deny = denyOf(await judge(r, 'chore(workflow): drop the linter copy'));
    const shape = new RegExp(`^${PREFIX}the linter copy check could not run: \`[^\`]+\` did not start`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command and did not start, got: ${deny}`);
  });

  await test('a tool that started and ended with no exit code inside the linter-copy check holds the commit naming exited null, never a pass', async () => {
    const r = mkVendoredRepo('changelog-lint.cjs');
    gitRm(r, '.github/changelog-lint.cjs');
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    r.failOn = (argv) => (argv.some((a) => a.endsWith('changelog-job.sh')) && argv.includes('names')
      ? { exitCode: null, isStarted: true, stdout: '', stderr: '' } : null);
    const deny = denyOf(await judge(r, 'chore(workflow): drop the linter copy'));
    const shape = new RegExp(`^${PREFIX}the linter copy check could not run: \`[^\`]+\` exited null`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `the check, the command and exited null, got: ${deny}`);
  });

  await test('a first caller, where HEAD has no checks.yml, is the heal\'s output too, no marker: exit 0', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    commit(r);
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    passes(await judge(r, 'chore(workflow): the kit\'s CI caller'), NOTICE.proved, 'the caller added alone needs no review');
  });

  await test('a caller on another branch than the repo\'s default is not the heal\'s output, no marker: exit 2', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    commit(r);
    r.defaultBranch = 'trunk';
    stage(r, CHECKS, healedChecks());
    blocks(await judge(r, 'chore: a caller on main'), T.noReview, 'the rewrite names trunk, the staged file main');
  });

  await test('no default branch to read holds the commit naming the rewrite and the fix, never a pass or the review bounce', async () => {
    const r = mkStampedRepo();
    stage(r, 'package.json', '{ "scripts": { "test": "exit 0" } }\n');
    commit(r);
    r.defaultBranch = null;
    stage(r, CHECKS, healedChecks());
    proveTree(r);
    const deny = denyOf(await judge(r, 'chore(workflow): the kit\'s CI caller'));
    const shape = new RegExp(`^${PREFIX}the checks\\.yml rewrite check could not run: \`changelog-job\\.sh rewrite\` exited 2 \\(changelog-job\\.sh: no default branch: [^)]*git remote set-head origin -a\\)`);
    assert(deny !== null && shape.test(deny) && deny.endsWith(HELD), `held, naming the fix, got: ${deny}`);
  });

  group('changelog-job.sh rewrite: the caller, its branch the repo\'s');

  await test('`changelog-job.sh rewrite` prints the template on the root\'s default branch, and fails 2 naming the fix with none', () => {
    const on = realRewrite(undefined, 'trunk');
    assertEq(on.exitCode, 0, `exit 0, stderr: ${on.stderr}`);
    assertEq(on.stdout, fs.readFileSync(TEMPLATE, 'utf8').replace('__DEFAULT_BRANCH__', 'trunk'), 'the caller on trunk');
    const none = realRewrite(undefined, null);
    assertEq(none.exitCode, 2, 'no branch is 2');
    assertEq(none.stdout, '', 'and prints no caller');
    assert(none.stderr.includes('git remote set-head origin -a'), `it names the fix, got: ${none.stderr}`);
    assertEq(realRewrite(TEMPLATE, 'main').stdout, healedChecks(), 'a template named by path reads the same');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
