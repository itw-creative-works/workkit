// Tests for workflow/changelog/changelog-job.sh, the `changelog` job in a repo's
// checks.yml, read and rewritten. Sourced directly: the heal writes the job, the
// commit gate checks it, and neither consumer's suite owns it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');
const { BASH, SYSTEM_PATH, NO_RC, shellPath } = require('../lib/platform');
const { openingLines, TOP_THREE } = require('../lib/checks-template');

const ROOT = path.join(__dirname, '..', '..');
const SEAM = shellPath(path.join(ROOT, 'workflow', 'changelog', 'changelog-job.sh'));
const TEMPLATE = path.join(ROOT, 'workflow', 'templates', 'github-workflows', 'checks.yml');
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

/** Write `body` to a scratch file, run `fn` in the seam over it and `template`, clean up. */
const overFile = (body, script, template = TEMPLATE) => {
  const dir = mkTmp('cl-job-');
  const file = path.join(dir, 'checks.yml');
  fs.writeFileSync(file, body);
  try {
    return inSeam(script, [shellPath(file), shellPath(template)]);
  } finally {
    cleanup(dir);
  }
};

const block = (body) => overFile(body, 'wk_changelog_job_block "$1"');
const rewrite = (body, template) => overFile(body, 'wk_changelog_job_rewrite "$1" "$2"', template);

const OLD_HEADER = '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,\n'
  + '# appended once at the end of `jobs:`. Its linter is the copy of the kit\'s\n'
  + '# changelog.js the heal vendors to .github/changelog-lint.cjs on every run.\n';
const templateHeader = () => {
  const lines = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
  const from = lines.findIndex((l) => l.startsWith('# The `changelog` job is the only job'));
  const to = lines.findIndex((l, i) => i > from && !l.startsWith('#'));
  return `${lines.slice(from, to).join('\n')}\n`;
};
const templateFirstLines = () => openingLines(fs.readFileSync(TEMPLATE, 'utf8'));
// The shipped template with its opening sentence rewrapped to `top`, in a scratch folder.
const rewrappedTemplate = (top) => {
  const dir = mkTmp('cl-job-');
  const file = path.join(dir, 'checks.yml');
  fs.writeFileSync(file, `${top}${fs.readFileSync(TEMPLATE, 'utf8').slice(templateFirstLines().length)}`);
  return { dir, file };
};
const TOP_ONE = '# Checks (workflow spec): the test gate that runs on every pull request and every push to the default branch.\n';
const RETIRED_FIRST_LINES = [
  '# Checks (workflow spec): the test gate that runs on every pull request.',
  '# Checks (workflow spec) \u2014 the test gate that runs on every pull request.',
  '# Checks (workflow spec) - the test gate that runs on every pull request.',
];
const SECOND_LINE = '# Making it a REQUIRED check is a repo setting (branch protection / ruleset)\n';
const NODE_JOB = '  changelog:\n    runs-on: ubuntu-latest\n    steps:\n      # the vendored copy\n'
  + '      - run: node .github/changelog-lint.cjs CHANGELOG.md --unreleased-only\n';
// The push trigger is already here, so these cases see only the changelog job.
const JOBS = 'name: checks\n\non:\n  pull_request:\n  push:\n\njobs:\n';

const cases = async () => {
  group('changelog-job.sh: sourcing it');

  await test('sourcing defines the functions and sets no variable', () => {
    const fns = inSeam("compgen -A function | grep '^wk_' | sort | tr '\\n' ' '");
    assertEq(fns.code, 0, `it sources clean, stderr: ${fns.err}`);
    assertEq(fns.out, 'wk_changelog_job_block wk_changelog_job_rewrite wk_changelog_job_runs_copy '
      + 'wk_checks_clone_block wk_checks_clone_line wk_checks_clone_step '
      + 'wk_checks_header wk_checks_heal_rewrite wk_checks_push_trigger wk_checks_template wk_checks_top wk_checks_top_count wk_job_boundary wk_linter_copies wk_names_linter_copy wk_retired_checks_first_lines wk_retired_checks_headers '
      + 'wk_workflows_run_copy ', `the functions, got: ${fns.out}`);
    const vars = (first) => spawnSync(BASH, [...NO_RC, '-c', `${first}\ncompgen -v | sort`],
      { env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()) }, encoding: 'utf8', timeout: SPAWN_DEADLINE }).stdout;
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

  group('changelog-job.sh: the template\'s opening sentence');

  await test('wk_checks_top prints the shipped template\'s first two lines, and the count is 2', () => {
    const top = inSeam('wk_checks_top "$1"', [shellPath(TEMPLATE)]);
    assertEq(top.code, 0, `it answers, stderr: ${top.err}`);
    assertEq(top.out, templateFirstLines(), 'the opening sentence, byte for byte');
    assertEq(top.out.split('\n').length - 1, 2, `the shipped sentence wraps to two lines, got: ${top.out}`);
    const count = inSeam('wk_checks_top_count "$1"', [shellPath(TEMPLATE)]);
    assertEq(count.code, 0, `the count answers, stderr: ${count.err}`);
    assertEq(count.out.trim(), '2', 'how many lines it is');
  });

  for (const [n, top] of [[3, TOP_THREE], [1, TOP_ONE]]) {
    await test(`a template whose opening sentence wraps to ${n} line${n === 1 ? '' : 's'} gets ${n}, and nothing past it`, () => {
      const { dir, file } = rewrappedTemplate(top);
      try {
        const got = inSeam('wk_checks_top "$1"', [shellPath(file)]);
        assertEq(got.code, 0, `it answers, stderr: ${got.err}`);
        assertEq(got.out, top, 'the rewrapped sentence, not the comment line after it');
        assertEq(openingLines(fs.readFileSync(file, 'utf8')), top, 'and the rule this suite counts by agrees');
        const count = inSeam('wk_checks_top_count "$1"', [shellPath(file)]);
        assertEq(count.out.trim(), String(n), 'the count follows the wrap');
      } finally {
        cleanup(dir);
      }
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

  await test('a retired first line, in any of its three spellings, becomes the template\'s opening sentence', () => {
    for (const retired of RETIRED_FIRST_LINES) {
      const { code, out } = rewrite(`${retired}\n${SECOND_LINE}${OLD_HEADER}${JOBS}${NODE_JOB}`);
      assertEq(code, 0, `it answers for: ${retired}`);
      assertEq(out, `${templateFirstLines()}${SECOND_LINE}${templateHeader()}${JOBS}  changelog:\n${USES}\n`,
        `the template's opening sentence in place of: ${retired}`);
    }
  });

  await test('a file already starting with the template\'s opening sentence keeps it byte for byte', () => {
    const current = `${templateFirstLines()}${SECOND_LINE}${JOBS}  changelog:\n${USES}\n`;
    const { code, out } = rewrite(current);
    assertEq(code, 0, 'it answers');
    assertEq(out, current, 'nothing doubled, nothing changed');
  });

  await test('a near miss of a retired first line is left alone', () => {
    const near = RETIRED_FIRST_LINES[0].replace('every pull request', 'each pull request');
    const { out } = rewrite(`${near}\n${SECOND_LINE}${JOBS}${NODE_JOB}`);
    assertEq(out, `${near}\n${SECOND_LINE}${JOBS}  changelog:\n${USES}\n`, 'the line is not a retired one, so it stays');
  });

  await test('a CRLF file gets the template\'s opening sentence with CRLF endings', () => {
    const crlf = (s) => s.replace(/\n/g, '\r\n');
    const { code, out } = rewrite(crlf(`${RETIRED_FIRST_LINES[0]}\n${SECOND_LINE}${JOBS}${NODE_JOB}`));
    assertEq(code, 0, 'it answers');
    assertEq(out, crlf(`${templateFirstLines()}${SECOND_LINE}${JOBS}  changelog:\n${USES}\n`),
      'both new lines end CRLF, as does every other line');
  });

  await test('a template rewrapped to three lines: the retired first line becomes those three, once', () => {
    const { dir, file } = rewrappedTemplate(TOP_THREE);
    try {
      const rest = `${SECOND_LINE}${JOBS}  changelog:\n${USES}\n`;
      const { code, out } = rewrite(`${RETIRED_FIRST_LINES[0]}\n${rest}`, file);
      assertEq(code, 0, 'it answers');
      assertEq(out, `${openingLines(fs.readFileSync(file, 'utf8'))}${rest}`, 'the three lines in place of the retired one, the rest byte for byte');
      assertEq(rewrite(out, file).out, out, 'and a second rewrite changes nothing');
    } finally {
      cleanup(dir);
    }
  });

  await test('an unreadable file is a non-zero status, not an empty answer', () => {
    const { code } = inSeam('wk_changelog_job_rewrite /nonexistent/checks.yml "$1"', [shellPath(TEMPLATE)]);
    assert(code !== 0, `the read failure is the function's status, got ${code}`);
  });

  group('changelog-job.sh: what runs the copy');

  for (const [cmd, want] of [
    ['node .github/changelog-lint.cjs CHANGELOG.md', 0],
    ['node ./.github/changelog-lint.js CHANGELOG.md', 0],
    ['node .workkit-kit/workflow/changelog/changelog.js CHANGELOG.md', 1],
  ]) {
    await test(`a job running \`${cmd}\` ${want === 0 ? 'runs' : 'does not run'} the copy`, () => {
      const { code } = overFile(`${JOBS}  changelog:\n    steps:\n      - run: ${cmd}\n`, 'wk_changelog_job_runs_copy "$1"');
      assertEq(code, want, 'the answer is the status');
    });
  }

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
    assertEq(overFile(`${JOBS}  changelog:\n${USES}\n`, 'grep() { return 2; }\nwk_changelog_job_runs_copy "$1"').code, 2,
      'a job the grep could not read');
    cleanup(dir);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
