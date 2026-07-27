//
// Tests for hooks/docs:changelog-guard — the PostToolUse hook that holds a
// CHANGELOG entry to its format at write time.
//
// The rules themselves are tested in tests/scripts/changelog.test.js (their one
// home is workflow/changelog.js). These tests cover what the HOOK owns: which
// files it looks at, that it blocks with exit 2, and that it judges only what a
// change added.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'changelog-guard', 'run.sh');
// Point the hook at THIS checkout's engine rather than the installed symlink,
// so the suite tests the code under review (same override the standards suite uses).
const WORKFLOW_DIR = path.join(__dirname, '..', '..', 'workflow');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clg-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const ISSUE = '[#4](https://github.com/o/r/issues/4)';

const doc = (...bullets) => [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  ...bullets.flatMap((b) => [b, '']),
].join('\n');

const runHook = (filePath) => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } }),
    env: { ...process.env, HOME: os.homedir(), WORKFLOW_DIR },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

/** A repo whose committed CHANGELOG is `initial`, so diffs are genuine. */
const mkRepo = (initial) => {
  const dir = mkTmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), initial);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
};

const append = (dir, line) => {
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}${line}\n`);
  return file;
};

const run = async () => {
  group('changelog-guard: scope');

  await test('a file that is not a CHANGELOG is ignored', () => {
    const dir = mkTmp();
    const file = path.join(dir, 'README.md');
    fs.writeFileSync(file, '- an essay bullet with no issue link whatsoever.\n');
    const { code, stderr } = runHook(file);
    assertEq(code, 0, 'exit 0');
    assertEq(stderr, '', 'silent');
    cleanup(dir);
  });

  await test('no file_path in the input — fail open', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
      env: { ...process.env, HOME: os.homedir(), WORKFLOW_DIR },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'exit 0');
  });

  await test('a CHANGELOG that no longer exists — fail open', () => {
    const dir = mkTmp();
    const { code } = runHook(path.join(dir, 'CHANGELOG.md'));
    assertEq(code, 0, 'exit 0');
    cleanup(dir);
  });

  group('changelog-guard: judging');

  await test('a new entry in the format passes', () => {
    const dir = mkRepo(doc());
    const file = append(dir, `- ${ISSUE} — Plugins install from settings.json.`);
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a new essay entry blocks with exit 2 and names the rule', () => {
    const dir = mkRepo(doc());
    const file = append(dir, `- **Plugins are installed from a declaration.** ${new Array(60).fill('word').join(' ')}`);
    const { code, stderr } = runHook(file);
    assertEq(code, 2, 'exit 2 blocks the write');
    assert(stderr.includes('issue-link'), `names the rule, got: ${stderr}`);
    assert(stderr.includes('word-cap'), `names every broken rule at once, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a legacy entry the write did not touch does not block', () => {
    // Adopting the format must never bounce a repo for its history.
    const dir = mkRepo(doc('- A legacy essay entry with no issue link at all.'));
    const file = append(dir, `- ${ISSUE} — A properly formatted new entry.`);
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a correct entry in a keepachangelog file with a link footer passes', () => {
    // The footer used to attach to the entry above it, so the hook bounced
    // correct work naming a rule the author had not broken.
    const dir = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD',
      '',
    ].join('\n'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(
      '[Unreleased]:',
      `- ${ISSUE} — A correct new entry.\n\n[Unreleased]:`,
    ));
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(dir);
  });

  await test('hooks.json registers the hook under PostToolUse Edit|Write', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entries = settings.hooks.PostToolUse.filter((e) => e.matcher === 'Edit|Write');
    assert(
      entries.some((e) => e.hooks.some((h) => h.command.includes('docs:changelog-guard'))),
      'docs:changelog-guard is wired',
    );
  });

  await test('a CHANGELOG outside git is judged in full', () => {
    // With no git to ask, everything is new — a first CHANGELOG is still held
    // to the format rather than slipping through unjudged.
    const dir = mkTmp();
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('- An essay entry with no issue link.'));
    assertEq(runHook(file).code, 2, 'blocked');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;
