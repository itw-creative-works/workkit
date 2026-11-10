// Tests for workflow/changelog/changelog-job.sh's reads of the retired CHANGELOG
// linter copy: which copies there are and which workflow still runs one. Sourced
// directly: the heal and the commit gate both ask, and neither one's suite owns it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath, stubTool, joinPath } = require('../lib/platform');

const ROOT = path.join(__dirname, '..', '..');
const SEAM = shellPath(path.join(ROOT, 'workflow', 'changelog', 'changelog-job.sh'));
const USES = '    uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main';

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source the seam and run one line of shell in it, the way every caller does. */
const inSeam = (script, args = []) => {
  const res = spawnSync(
    BASH,
    [...NO_RC, '-c', `. ${JSON.stringify(SEAM)}\n${script}`, 'bash', ...args],
    { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE },
  );
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** Write `body` to a scratch file, run `script` in the seam over it, clean up. */
const overFile = (body, script) => {
  const dir = mkTmp('cl-job-');
  const file = path.join(dir, 'checks.yml');
  fs.writeFileSync(file, body);
  try {
    return inSeam(script, [shellPath(file)]);
  } finally {
    cleanup(dir);
  }
};

// A workflow's opening, its jobs: block last, for the folder cases to put a job under.
const JOBS = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n';

const cases = async () => {
  group('changelog-job.sh: sourcing it');

  await test('sourcing defines the functions and sets no variable', () => {
    const fns = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    assertEq(fns.code, 0, `it sources clean, stderr: ${fns.err}`);
    assertEq(fns.out, 'wk_checks_heal_rewrite wk_checks_template wk_default_branch wk_has_core_package wk_linter_copies '
      + 'wk_names_linter_copy wk_workflows_run_copy ', `the functions, got: ${fns.out}`);
    const vars = (first) => spawnSync(BASH, [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE }).stdout;
    assertEq(vars(`. ${JSON.stringify(SEAM)}`), vars(':'), 'the same variables as a shell that sourced nothing');
  });

  await test('the linter copies are named once, both of them', () => {
    const { code, out } = inSeam('wk_linter_copies');
    assertEq(code, 0, 'it answers');
    assertEq(out, '.github/changelog-lint.cjs\n.github/changelog-lint.js\n', 'the two names, one per line');
  });

  group('changelog-job.sh: what runs the copy');

  await test('a comment naming the copy is not a run of it; a run: line is', () => {
    const names = (text) => spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(SEAM)}\nwk_names_linter_copy`],
      { input: text, env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE }).status;
    assertEq(names('# changelog.js the heal vendors to .github/changelog-lint.js on every run.\njobs:\n'), 1,
      'a column-0 comment');
    assertEq(names('jobs:\n  x:\n    steps:\n      # node .github/changelog-lint.cjs was here\n      - run: npm test\n'), 1,
      'an indented comment');
    assertEq(names('jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n'), 0,
      'a run: line');
    assertEq(names('jobs:\r\n  x:\r\n    steps:\r\n      - run: node .github/changelog-lint.js\r\n'), 0,
      'a run: line in a CRLF file');
  });

  await test('`changelog-job.sh names -` reads the text from its own stdin; a file argument, the file', () => {
    const entry = (text, ...copy) => spawnSync(BASH, [...NO_RC, SEAM, 'names', '-', ...copy],
      { input: text, env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE });
    const runs = 'jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n';
    const hit = entry(runs, '.github/changelog-lint.cjs');
    assertEq(hit.status, 0, `a text naming the copy, stderr: ${hit.stderr}`);
    assertEq(entry(runs, '.github/changelog-lint.js').status, 1, 'a text naming another copy');
    assertEq(entry('jobs:\n  x:\n    steps:\n      - run: npm test\n').status, 1, 'a text naming no copy');
    assertEq(overFile(runs, `bash ${JSON.stringify(SEAM)} names "$1" .github/changelog-lint.cjs`).code, 0, 'a file argument still reads the file');
  });

  await test('a workflow folder runs a copy when any file in it names one', () => {
    const dir = mkTmp('cl-job-');
    const wf = path.join(dir, '.github', 'workflows');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'checks.yml'), `${JOBS}  changelog:\n${USES}\n`);
    const ask = (...copy) => inSeam('wk_workflows_run_copy "$@"', [shellPath(dir), ...copy]).code;
    assertEq(ask(), 1, 'a folder naming no copy');
    fs.writeFileSync(path.join(wf, 'lint.yml'), 'jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.js\n');
    assertEq(ask(), 0, 'a second workflow naming one');
    assertEq(ask('.github/changelog-lint.js'), 0, 'that copy, asked by name');
    assertEq(ask('.github/changelog-lint.cjs'), 1, 'the other copy, which nothing names');
    cleanup(dir);
    assertEq(ask(), 1, 'a repo with no workflow folder runs nothing');
  });

  await test('a tool that fails is 2, never a yes or a no', () => {
    const dir = mkTmp('cl-job-');
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    const unread = inSeam('find() { echo "find: stub" >&2; return 1; }\nwk_workflows_run_copy "$1"', [shellPath(dir)]);
    assertEq(unread.code, 2, 'a folder find could not read');
    assert(unread.err.includes('find: stub'), `find's stderr is left for the caller: ${unread.err}`);
    assertEq(inSeam('grep() { return 2; }\nwk_names_linter_copy <<<"jobs:"').code, 2, 'a grep that failed');
    cleanup(dir);
  });

  group('changelog-job.sh: the default branch the caller and branch protection share');

  // A repo whose origin/HEAD names trunk unless `originHead` is false, and a gh
  // on PATH answering `answer` to the REST read (no gh when it is null).
  const branchOf = ({ answer, originHead = true }) => {
    const dir = mkTmp('cl-job-branch-');
    const repo = path.join(dir, 'repo');
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(repo);
    fs.mkdirSync(bin);
    const git = (...args) => assertEq(spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).status, 0, `git ${args.join(' ')}`);
    git('init', '-q');
    git('remote', 'add', 'origin', 'https://example.invalid/acme/repo.git');
    if (originHead) git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    const log = path.join(dir, 'gh.log');
    if (answer !== null) {
      stubTool(bin, 'gh', ['#!/usr/bin/env bash', `printf '%s\\n' "$*" >> ${JSON.stringify(shellPath(log))}`,
        ...(answer === 'fail' ? ['exit 1'] : [`echo ${JSON.stringify(answer)}`])]);
    }
    const res = spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(SEAM)}\nwk_default_branch`], {
      cwd: repo, env: { PATH: joinPath(bin, SYSTEM_PATH), HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE,
    });
    const asked = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    cleanup(dir);
    return { code: res.status, branch: res.stdout, asked };
  };

  await test('GitHub\'s answer wins over origin/HEAD, read as branch protection reads it', () => {
    const { branch, asked } = branchOf({ answer: 'develop' });
    assertEq(branch, 'develop\n', 'GitHub\'s default branch');
    assertEq(asked, 'api repos/{owner}/{repo} --jq .default_branch\n', 'one REST read of the repo');
  });

  await test('no answer from GitHub (gh failing, empty, or absent): origin/HEAD\'s branch', () => {
    for (const answer of ['fail', '', null]) {
      assertEq(branchOf({ answer }).branch, 'trunk\n', `gh ${answer === null ? 'absent' : JSON.stringify(answer)}: origin/HEAD`);
    }
  });

  await test('neither GitHub nor origin/HEAD: a failure printing nothing, never a guessed main', () => {
    for (const answer of ['fail', '', null]) {
      const { code, branch } = branchOf({ answer, originHead: false });
      assertEq(code, 1, `gh ${answer === null ? 'absent' : JSON.stringify(answer)}: exit 1`);
      assertEq(branch, '', 'and no branch');
    }
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
