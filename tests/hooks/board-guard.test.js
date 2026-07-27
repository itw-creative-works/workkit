//
// Tests for hooks/docs:board-guard — the PostToolUse hook that enforces the
// document rules of the project-state spec v3: CLAUDE.md pointer doctrine and
// the AGENTS.md size budget.
//
// The hook reads JSON on stdin (tool_input.file_path), validates the written
// file, and exits 2 with a fix-list on stderr when it violates a rule.
// Board files are no longer a surface — work-item state lives in GitHub Issues.
// Plan files are no longer a surface either — a plan lives in its issue body.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'board-guard', 'run.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const runHook = (filePath, envOverride = {}) => {
  const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: { ...process.env, HOME: os.homedir(), ...envOverride },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const writeFile = (dir, content, name) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

const run = async () => {
  group('board-guard: scope');

  await test('unguarded file — silent exit 0', () => {
    const dir = mkTmp();
    const p = writeFile(dir, 'anything at all', 'README.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 0, 'unguarded files are ignored');
    assertEq(stderr, '', 'no output');
    cleanup(dir);
  });

  await test('PROGRESS.md / BOARD.md are no longer validated — exit 0', () => {
    const dir = mkTmp();
    for (const name of ['PROGRESS.md', 'BOARD.md']) {
      const p = writeFile(dir, '# whatever\n\n## Random\n- GO 1: anywhere\n', name);
      const { code, stderr } = runHook(p);
      assertEq(code, 0, `${name} is not a guard surface in v3`);
      assertEq(stderr, '', 'no output');
    }
    cleanup(dir);
  });

  await test('missing file_path in input — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'no file_path → fail open');
  });

  await test('file_path that does not exist — exit 0', () => {
    const { code } = runHook('/nonexistent/PROGRESS.md');
    assertEq(code, 0, 'missing file → fail open');
  });

  group('board-guard: CLAUDE.md pointer doctrine');

  await test('bare @AGENTS.md pointer — exit 0', () => {
    const dir = mkTmp();
    const p = writeFile(dir, '@AGENTS.md\n', 'CLAUDE.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 0, `pointer file passes, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('content-bearing CLAUDE.md — exit 2 POINTER DOCTRINE with convert recipe', () => {
    const dir = mkTmp();
    const p = writeFile(dir, '# My Project\n\nReal instructions here.\n@AGENTS.md\n', 'CLAUDE.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 2, 'content in CLAUDE.md must block');
    assert(stderr.includes('POINTER DOCTRINE'), 'names the violation');
    assert(stderr.includes('git mv'), 'carries the two-commit convert recipe');
    cleanup(dir);
  });

  await test('CLAUDE.md missing the import line entirely — exit 2', () => {
    const dir = mkTmp();
    const p = writeFile(dir, '\n', 'CLAUDE.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 2, 'pointer-less CLAUDE.md must block');
    assert(stderr.includes('missing the bare'), 'names the missing import');
    cleanup(dir);
  });

  group('board-guard: AGENTS.md size budget');

  const agentsLines = (n) => `# repo — overview\n${Array.from({ length: n - 1 }, (_, i) => `line ${i}`).join('\n')}\n`;

  await test('AGENTS.md at 250 lines — exit 0', () => {
    const dir = mkTmp();
    const p = writeFile(dir, agentsLines(250), 'AGENTS.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 0, `250 lines is within budget, stderr: ${stderr}`);
    cleanup(dir);
  });

  await test('AGENTS.md over 250 lines — exit 2 AGENTS BUDGET with offload instruction', () => {
    const dir = mkTmp();
    const p = writeFile(dir, agentsLines(251), 'AGENTS.md');
    const { code, stderr } = runHook(p);
    assertEq(code, 2, 'oversized AGENTS.md must block');
    assert(stderr.includes('AGENTS BUDGET'), 'names the violation');
    assert(stderr.includes('docs/'), 'tells the writer to offload detail to docs/');
    cleanup(dir);
  });

  group('board-guard: plans are no longer a surface');

  await test('markdown under plans/ passes silently — exit 0', () => {
    const dir = mkTmp();
    const d = path.join(dir, 'plans');
    fs.mkdirSync(d, { recursive: true });
    const p = path.join(d, 'thing.md');
    fs.writeFileSync(p, '# A proposal with no frontmatter\n\n- [ ] a checkbox\n');
    const { code, stderr } = runHook(p);
    assertEq(code, 0, 'plans left the repo — a plan lives in its issue body');
    assertEq(stderr, '', 'no output');
    cleanup(dir);
  });

  await test('ordinary markdown untouched — exit 0', () => {
    const dir = mkTmp();
    const p = writeFile(dir, 'anything - [ ] checkbox', 'notes.md');
    const { code } = runHook(p);
    assertEq(code, 0, 'ordinary markdown is ignored');
    cleanup(dir);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
