// Tests for workflow/lib/changelog.sh, the one home of the CHANGELOG check the
// commit gate and the npm wrapper share: wk_changelog_lint runs the engine's own
// linter, or the one under WORKFLOW_DIR. Sourced directly, as both callers do.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp, SPAWN_DEADLINE,
} = require('../lib/harness');
const {
  SYSTEM_BASH, NO_RC, shellPath, systemPathWith,
} = require('../lib/platform');

// The gate and the npm wrapper both lint through this one function, sourced
// from the workflow lib, so a resolution that walks to the wrong folder would
// take the CHANGELOG check out of both at once.
const CHANGELOG_LIB = shellPath(path.join(__dirname, '..', '..', 'workflow', 'lib', 'changelog.sh'));
const lint = (root, env = {}) => {
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${CHANGELOG_LIB}"\nwk_changelog_lint "$1" CHANGELOG.md`, 'bash', shellPath(root)], {
    env: { PATH: systemPathWith(path.dirname(process.execPath)), HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

// A repo whose committed CHANGELOG has an empty [Unreleased], and whose working
// copy carries one entry of <words> words.
const changelogRepo = (words) => {
  const dir = mkTmp('changelog-lint-');
  const head = '# Changelog\n\n## [Unreleased]\n\n### Added\n\n';
  const gitIn = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  gitIn('init', '-q');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), head);
  gitIn('add', '-A');
  gitIn('commit', '-q', '-m', 'seed');
  const entry = `- [#4](https://github.com/o/r/issues/4) - ${new Array(words - 1).fill('word').join(' ')} end.\n`;
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `${head}${entry}`);
  return dir;
};

describe('workflow/lib/changelog.sh: wk_changelog_lint resolves the linter', () => {
  test("with no WORKFLOW_DIR it runs the engine's own lint.js", () => {
    const long = lint(changelogRepo(62));
    expect(long.code, `a 62-word entry fails, got: ${long.stdout}|${long.stderr}`).toBe(1);
    expect(long.stderr.startsWith('the CHANGELOG entry does not match the format (see docs/project-state.md). '),
      `with the shared message, got: ${long.stderr}`).toBeTruthy();
    expect(long.stderr.includes('[word-cap] 62 words (max 50)'), `and the real linter's line, got: ${long.stderr}`).toBeTruthy();
    const short = lint(changelogRepo(20));
    expect(short.code, `a 20-word entry passes, got: ${short.stdout}|${short.stderr}`).toBe(0);
  });

  test('WORKFLOW_DIR names the engine whose linter it runs', () => {
    const engine = mkTmp('changelog-lint-engine-');
    const argvFile = path.join(engine, 'argv.json');
    fs.mkdirSync(path.join(engine, 'changelog'));
    fs.writeFileSync(path.join(engine, 'changelog', 'lint.js'), [
      `require('fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));`,
      "console.error('the stand-in linter said no');",
      'process.exit(1);',
    ].join('\n'));
    const out = lint(changelogRepo(20), { WORKFLOW_DIR: shellPath(engine) });
    expect(out.code, `the stand-in's failure is the answer, got: ${out.stdout}|${out.stderr}`).toBe(1);
    expect(out.stderr.includes('the stand-in linter said no'), `its words reach the message, got: ${out.stderr}`).toBeTruthy();
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
    expect(argv[0].replace(/\\/g, '/').endsWith('/CHANGELOG.md'), `it was handed the repo's CHANGELOG, got: ${argv}`).toBeTruthy();
    expect(JSON.stringify(argv.slice(1)), 'judging only the added lines').toBe('["--added-only"]');
  });
});

describe('workflow/lib/changelog.sh: wk_changelog_lint with nothing to run', () => {
  test('no node, or no linter: exit 0 with one line saying the linter did not run, never the format refusal', () => {
    const noNode = lint(changelogRepo(62), { PATH: systemPathWith() });
    const noLinter = lint(changelogRepo(62), { WORKFLOW_DIR: shellPath(mkTmp('changelog-lint-empty-')) });
    for (const [label, out] of [['no node', noNode], ['no linter', noLinter]]) {
      expect(out.code, `${label}: the check stands aside, got: ${out.stdout}|${out.stderr}`).toBe(0);
      const lines = out.stderr.split('\n').filter(Boolean);
      expect(lines.length, `${label}: one stderr line, got: ${out.stderr}`).toBe(1);
      expect(lines[0].includes('did not run'), `${label}: saying the linter did not run, got: ${lines[0]}`).toBeTruthy();
      expect(!out.stderr.includes('does not match the format'), `${label}: never the refusal, got: ${out.stderr}`).toBeTruthy();
    }
  });
});
