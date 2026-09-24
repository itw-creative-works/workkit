//
// Tests for workflow/changelog-job.sh, the `changelog` job in a repo's
// checks.yml, read and rewritten.
//
// The file has its own suite because it has two consumers: the heal
// (standards.sh) writes the rewrite and the commit gate (through hooks/_lib.sh)
// proves a staged checks.yml is exactly it, and neither consumer's suite owns
// it. It is sourced DIRECTLY here, the way slug.sh is cased, and every case
// hands a function a hand-built file and reads what it printed.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../lib/platform');

const ROOT = path.join(__dirname, '..', '..');
const SEAM = shellPath(path.join(ROOT, 'workflow', 'changelog-job.sh'));
const TEMPLATE = path.join(ROOT, 'workflow', 'templates', 'github-workflows', 'checks.yml');
const USES = '    uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main';

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cl-job-'));
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

/** Source the seam and run one line of shell in it, the way every caller does. */
const inSeam = (script, args = []) => {
  const res = spawnSync(
    BASH,
    [...NO_RC, '-c', `. ${JSON.stringify(SEAM)}\n${script}`, 'bash', ...args],
    { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: 30000 },
  );
  assert(res.status !== null, `the shell finished (no timeout): ${res.error || ''}`);
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
};

/** Write `body` to a scratch file, run `fn` in the seam over it, clean up. */
const overFile = (body, script) => {
  const dir = mkTmp();
  const file = path.join(dir, 'checks.yml');
  fs.writeFileSync(file, body);
  try {
    return inSeam(script, [shellPath(file), shellPath(TEMPLATE)]);
  } finally {
    cleanup(dir);
  }
};

const block = (body) => overFile(body, 'wk_changelog_job_block "$1"');
const rewrite = (body) => overFile(body, 'wk_changelog_job_rewrite "$1" "$2"');

const OLD_HEADER = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
  + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
  + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
const templateHeader = () => {
  const lines = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
  const from = lines.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
  const to = lines.findIndex((l, i) => i > from && !l.startsWith('#'));
  return `${lines.slice(from, to).join('\n')}\n`;
};
const NODE_JOB = '  changelog:\n    runs-on: ubuntu-latest\n    steps:\n      # the vendored copy\n'
  + '      - run: node .github/changelog-lint.cjs CHANGELOG.md --unreleased-only\n';
const JOBS = 'name: checks\n\non:\n  pull_request:\n\njobs:\n';

const run = async () => {
  group('changelog-job.sh: sourcing it');

  await test('sourcing defines the functions and sets no variable', () => {
    const fns = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    assertEq(fns.code, 0, `it sources clean, stderr: ${fns.err}`);
    assertEq(fns.out, 'wk_changelog_job_block wk_changelog_job_rewrite wk_changelog_job_runs_copy '
      + 'wk_checks_header wk_checks_template wk_job_boundary wk_linter_copies wk_names_linter_copy wk_retired_checks_headers '
      + 'wk_workflows_run_copy ', `the functions, got: ${fns.out}`);
    const vars = (first) => spawnSync(BASH, [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: 20000 }).stdout;
    assertEq(vars(`. ${JSON.stringify(SEAM)}`), vars(':'), 'the same variables as a shell that sourced nothing');
  });

  await test('the linter copies are named once, both of them', () => {
    const { code, out } = inSeam('wk_linter_copies');
    assertEq(code, 0, 'it answers');
    assertEq(out, '.github/changelog-lint.cjs\n.github/changelog-lint.js\n', 'the two names, one per line');
  });

  group('changelog-job.sh: where a job ends');

  for (const next of ['  9job:', '  lint.v2:', 'concurrency:']) {
    await test(`a job ends at \`${next.trim()}\`, and blank lines and comments inside it do not end it`, () => {
      const job = '  changelog:\n    runs-on: ubuntu-latest\n\n  # a column-2 comment\n# a column-0 comment\n    steps:\n      - run: x';
      const { code, out } = block(`${JOBS}${job}\n${next}\n    runs-on: ubuntu-latest\n`);
      assertEq(code, 0, 'it answers');
      assertEq(out, `${job}\n`, `every line up to ${next.trim()} and none after`);
    });
  }

  group('changelog-job.sh: the rewrite');

  await test('lines closing the job at the end of the file are kept', () => {
    const tail = '\n  # the last word\n\n';
    const { code, out } = rewrite(`${JOBS}${NODE_JOB}${tail}`);
    assertEq(code, 0, 'it answers');
    assertEq(out, `${JOBS}  changelog:\n${USES}\n${tail}`, 'the blank lines and the comment after the job survive');
  });

  await test('the retired header is swapped on an exact match', () => {
    const { out } = rewrite(`# intro\n${OLD_HEADER}${JOBS}${NODE_JOB}`);
    assertEq(out, `# intro\n${templateHeader()}${JOBS}  changelog:\n${USES}\n`, 'the template\'s paragraph in its place');
  });

  await test('the older retired header, naming the .js copy, is swapped too', () => {
    const older = OLD_HEADER.replace('changelog-lint.cjs', 'changelog-lint.js');
    const { out } = rewrite(`${older}${JOBS}${NODE_JOB}`);
    assertEq(out, `${templateHeader()}${JOBS}  changelog:\n${USES}\n`, 'either wording is the retired header');
  });

  await test('a retired header is swapped even where the job already calls the kit\'s workflow', () => {
    const current = `${JOBS}  changelog:\n${USES}\n`;
    const { code, out } = rewrite(`${OLD_HEADER}${current}`);
    assertEq(code, 0, 'it answers');
    assertEq(out, `${templateHeader()}${current}`, 'the header swapped, the job untouched');
    const again = overFile(out, 'wk_changelog_job_rewrite "$1" "$2"').out;
    assertEq(again, out, 'and a second rewrite changes nothing');
  });

  await test('a changelog job of the repo\'s own is never replaced', () => {
    const own = `${JOBS}  changelog:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx my-own-lint\n`;
    const { code, out } = rewrite(own);
    assertEq(code, 0, 'it answers');
    assertEq(out, own, 'a job that runs no copy is not the heal\'s to rewrite');
  });

  await test('a near miss of the retired header is left alone', () => {
    const near = OLD_HEADER.replace('on every run.', 'on each run.');
    const { out } = rewrite(`${near}${JOBS}${NODE_JOB}`);
    assertEq(out, `${near}${JOBS}  changelog:\n${USES}\n`, 'the paragraph is not the retired one, so it stays');
  });

  await test('a CRLF file is rewritten and keeps its CRLF line endings', () => {
    const crlf = (s) => s.replace(/\n/g, '\r\n');
    const next = '\n  e2e:\n    runs-on: ubuntu-latest\n';
    const { code, out } = rewrite(crlf(`${OLD_HEADER}${JOBS}${NODE_JOB}${next}`));
    assertEq(code, 0, 'it answers');
    assertEq(out, crlf(`${templateHeader()}${JOBS}  changelog:\n${USES}\n${next}`),
      'header swapped, job rewritten, the next job intact, every line ending CRLF');
  });

  await test('an unreadable file is a non-zero status, not an empty answer', () => {
    const { code } = inSeam('wk_changelog_job_rewrite /nonexistent/checks.yml "$1"', [shellPath(TEMPLATE)]);
    assert(code !== 0, `the read failure is the function's status, got ${code}`);
  });

  group('changelog-job.sh: what runs the copy');

  for (const [cmd, want] of [
    ['node .github/changelog-lint.cjs CHANGELOG.md', 0],
    ['node ./.github/changelog-lint.js CHANGELOG.md', 0],
    ['node .workkit-kit/workflow/changelog.js CHANGELOG.md', 1],
  ]) {
    await test(`a job running \`${cmd}\` ${want === 0 ? 'runs' : 'does not run'} the copy`, () => {
      const { code } = overFile(`${JOBS}  changelog:\n    steps:\n      - run: ${cmd}\n`, 'wk_changelog_job_runs_copy "$1"');
      assertEq(code, want, 'the answer is the status');
    });
  }

  await test('a comment naming the copy is not a run of it; a run: line is', () => {
    const names = (text) => spawnSync(BASH, [...NO_RC, '-c', `. ${JSON.stringify(SEAM)}\nwk_names_linter_copy`],
      { input: text, env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: 20000 }).status;
    assertEq(names('# changelog.js the heal vendors to .github/changelog-lint.js on every run.\njobs:\n'), 1,
      'a column-0 comment');
    assertEq(names('jobs:\n  x:\n    steps:\n      # node .github/changelog-lint.cjs was here\n      - run: npm test\n'), 1,
      'an indented comment');
    assertEq(names('jobs:\n  x:\n    steps:\n      - run: node .github/changelog-lint.cjs CHANGELOG.md\n'), 0,
      'a run: line');
    assertEq(names('jobs:\r\n  x:\r\n    steps:\r\n      - run: node .github/changelog-lint.js\r\n'), 0,
      'a run: line in a CRLF file');
  });

  await test('a workflow folder runs a copy when any file in it names one', () => {
    const dir = mkTmp();
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

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(module.exports);
