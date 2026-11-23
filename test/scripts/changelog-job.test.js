// Tests for workflow/changelog/job.js run as a program: the retired CHANGELOG
// linter copies, whether a workflow text runs one, and checks.yml as the heal
// writes it. Started by path: the heal and the commit gate both ask it.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { SYSTEM_PATH, shellPath, stubTool, joinPath } = require('../lib/platform');

const ROOT = path.join(__dirname, '..', '..');
const JOB = path.join(ROOT, 'workflow', 'changelog', 'job.js');
const HOME = mkTmp('cl-job-home-');

/** `node job.js <args>`: its exit code, stdout and stderr. */
const job = (args, { input, cwd, env = { PATH: SYSTEM_PATH, HOME } } = {}) => {
  const res = spawnSync(process.execPath, [JOB, ...args], { cwd, input, env, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  expect(res.status !== null, `the job finished (no timeout): ${res.error || ''}`).toBeTruthy();
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

describe('changelog-job: the program', () => {
  test('no mode, an unknown one, or names with no file: the usage line on stderr and 64', () => {
    for (const args of [[], ['bogus'], ['names']]) {
      const { code, out, err } = job(args);
      expect(code, `${JSON.stringify(args)}: exit 64, stderr: ${err}`).toBe(64);
      expect(out, `${JSON.stringify(args)}: nothing on stdout`).toBe('');
      expect(err.startsWith('changelog-job: usage: '), `${JSON.stringify(args)}: the usage line, got: ${err}`).toBeTruthy();
    }
  });

  test('copies names the linter copies, both of them, one per line', () => {
    const { code, out, err } = job(['copies']);
    expect(code, `it answers, stderr: ${err}`).toBe(0);
    expect(out, 'the two names').toBe('.github/changelog-lint.cjs\n.github/changelog-lint.js\n');
  });
});

describe('changelog-job names: what runs the copy', () => {
  test('a comment naming the copy is not a run of it; a run: line is', () => {
    const names = (text) => job(['names', '-'], { input: text }).code;
    expect(names('# changelog.js the heal vendors to .github/changelog-lint.js on every run.\njobs:\n'), 'a column-0 comment').toBe(1);
    expect(names('jobs:\n  x:\n    steps:\n      # node .github/changelog-lint.cjs was here\n      - run: npm test\n'), 'an indented comment').toBe(1);
    expect(names('jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n'), 'a run: line').toBe(0);
    expect(names('jobs:\r\n  x:\r\n    steps:\r\n      - run: node .github/changelog-lint.js\r\n'), 'a run: line in a CRLF file').toBe(0);
  });

  test('`names -` reads the text from its own stdin; a file argument, the file; a copy argument asks for that copy alone', () => {
    const runs = 'jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n';
    const hit = job(['names', '-', '.github/changelog-lint.cjs'], { input: runs });
    expect(hit.code, `a text naming the copy, stderr: ${hit.err}`).toBe(0);
    expect(job(['names', '-', '.github/changelog-lint.js'], { input: runs }).code, 'a text naming another copy').toBe(1);
    expect(job(['names', '-'], { input: 'jobs:\n  x:\n    steps:\n      - run: npm test\n' }).code, 'a text naming no copy').toBe(1);
    const dir = mkTmp('cl-job-');
    const file = path.join(dir, 'checks.yml');
    fs.writeFileSync(file, runs);
    expect(job(['names', file, '.github/changelog-lint.cjs'], { input: '' }).code, 'a file argument reads the file').toBe(0);
    cleanup(dir);
  });

  test('an input it cannot read is its own code, never a yes or a no: names 2, rewrite 1', () => {
    const dir = mkTmp('cl-job-');
    const missing = path.join(dir, 'missing.yml');
    const names = job(['names', missing]);
    expect(names.code, `an unread file is 2, stderr: ${names.err}`).toBe(2);
    expect(names.err.startsWith('changelog-job: cannot read '), `it says so, got: ${names.err}`).toBeTruthy();
    cleanup(dir);
    const w = branchWorld({ answer: 'develop' });
    const rewrite = job(['rewrite', missing], { cwd: w.repo, env: w.env });
    expect(rewrite.code, `an unread template is 1, stderr: ${rewrite.err}`).toBe(1);
    expect(rewrite.out, 'and prints no caller').toBe('');
    cleanup(w.dir);
  });
});

// A template naming the default branch twice, for the rewrite to fill in.
const TEMPLATE = 'on:\n  push:\n    branches: [__DEFAULT_BRANCH__]\n# runs on __DEFAULT_BRANCH__\n';
const filled = (branch) => TEMPLATE.split('__DEFAULT_BRANCH__').join(branch);

/**
 * A repo whose origin/HEAD names trunk unless `originHead` is false, and a gh
 * on PATH answering `answer` to the REST read (no gh when it is null).
 */
function branchWorld({ answer, originHead = true }) {
  const dir = mkTmp('cl-job-branch-');
  const repo = path.join(dir, 'repo');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  const git = (...args) => expect(spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).status, `git ${args.join(' ')}`).toBe(0);
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://example.invalid/acme/repo.git');
  if (originHead) git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
  const log = path.join(dir, 'gh.log');
  if (answer !== null) {
    stubTool(bin, 'gh', ['#!/usr/bin/env bash', `printf '%s\\n' "$*" >> ${JSON.stringify(shellPath(log))}`,
      ...(answer === 'fail' ? ['exit 1'] : [`echo ${JSON.stringify(answer)}`])]);
  }
  const template = path.join(dir, 'checks.yml');
  fs.writeFileSync(template, TEMPLATE);
  const asked = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '');
  return { dir, repo, template, asked, env: { PATH: joinPath(bin, SYSTEM_PATH), HOME } };
}

/** `rewrite <template>` at a branchWorld's repo. */
const rewriteAt = (opts) => {
  const w = branchWorld(opts);
  const res = job(['rewrite', w.template], { cwd: w.repo, env: w.env });
  const asked = w.asked();
  cleanup(w.dir);
  return { ...res, asked };
};

describe('changelog-job rewrite: the default branch the caller and branch protection share', () => {
  test('GitHub\'s answer wins over origin/HEAD, read as branch protection reads it, at every placeholder', () => {
    const { code, out, err, asked } = rewriteAt({ answer: 'develop' });
    expect(code, `exit 0, stderr: ${err}`).toBe(0);
    expect(out, 'the template on GitHub\'s default branch').toBe(filled('develop'));
    expect(asked, 'one REST read of the repo').toBe('api repos/{owner}/{repo} --jq .default_branch\n');
  });

  test('no answer from GitHub (gh failing, empty, or absent): origin/HEAD\'s branch', () => {
    for (const answer of ['fail', '', null]) {
      const { out, err } = rewriteAt({ answer });
      expect(out, `gh ${answer === null ? 'absent' : JSON.stringify(answer)}: origin/HEAD, stderr: ${err}`).toBe(filled('trunk'));
    }
  });

  test('neither GitHub nor origin/HEAD: 2 naming the fix, never a guessed main', () => {
    for (const answer of ['fail', '', null]) {
      const what = `gh ${answer === null ? 'absent' : JSON.stringify(answer)}`;
      const { code, out, err } = rewriteAt({ answer, originHead: false });
      expect(code, `${what}: exit 2`).toBe(2);
      expect(out, `${what}: and no caller`).toBe('');
      expect(err.startsWith('changelog-job: no default branch: ') && err.includes('git remote set-head origin -a'),
        `${what}: the line names the fix, got: ${err}`).toBeTruthy();
    }
  });
});
