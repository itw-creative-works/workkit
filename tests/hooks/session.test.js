//
// Tests for hooks/docs:session — the SessionStart hook that hands a session
// back its own `.workkit/session.md`.
//
// Every case runs the real hook against a fixture repo. The hook reaches no
// network and reads nothing outside the repo it is given, so there is nothing
// to stub: the whole surface is the file, the committed settings.json, and the
// light bar.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'session', 'run.sh');
const TEMPLATE = path.join(__dirname, '..', '..', 'workflow', 'templates', 'session.md');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'session-hook-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/**
 * A git repo that has opted in, optionally holding a session.md.
 * `optedIn: false` leaves out the committed settings.json; `enabled: false`
 * writes the project-level no.
 */
const mkRepo = ({ session, optedIn = true, enabled = true } = {}) => {
  const dir = mkTmp();
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  if (optedIn) {
    fs.writeFileSync(path.join(dir, W, 'settings.json'), JSON.stringify({ version: 1, enabled }));
  }
  if (session !== undefined) {
    fs.writeFileSync(path.join(dir, W, 'session.md'), session);
  }
  return dir;
};

const runHook = (cwd, source = 'startup') => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ cwd, source, hook_event_name: 'SessionStart' }),
    env: { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const ctxOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.additionalContext;

const filled = (lines) => [
  '# Session',
  '',
  '## Active',
  ...lines.map((l) => `- ${l}`),
  '',
  '## Queue',
  '',
  '## Notes',
  '',
].join('\n');

const run = async () => {
  group('session: the file is injected when it has content');

  await test('a non-empty session.md is handed back, with the path named', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    const ctx = ctxOf(stdout);
    assert(ctx.includes('#12 — the board sweep, mid-build'), 'the content is in the context');
    assert(ctx.includes(`${W}/session.md`), 'the preamble names the file');
    assertEq(JSON.parse(stdout).hookSpecificOutput.hookEventName, 'SessionStart', 'correct event name');
    cleanup(repo);
  });

  await test('a compaction gets it too — every source, not just startup', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const { stdout } = runHook(repo, 'compact');
    assert(ctxOf(stdout).includes('#12 — mid-build'), 'injected after a compaction');
    cleanup(repo);
  });

  await test('a session opened in a subdirectory finds the repo root', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const { stdout } = runHook(sub);
    assert(ctxOf(stdout).includes('#12 — mid-build'), 'resolved from the subdirectory');
    cleanup(repo);
  });

  await test('hooks.json registers the hook under SessionStart, for every source', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entry = settings.hooks.SessionStart
      .find((e) => e.hooks.some((h) => h.command.includes('docs:session')));
    assert(entry, 'docs:session is wired');
    assert(!entry.matcher, 'no matcher — a compacted session is the case it exists for');
  });

  group('session: silence');

  await test('no session.md at all — silent exit 0', () => {
    const repo = mkRepo();
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'says nothing');
    cleanup(repo);
  });

  await test('an empty session.md — silent', () => {
    const repo = mkRepo({ session: '' });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'says nothing');
    cleanup(repo);
  });

  await test('the shipped template, untouched — headings and notes only, silent', () => {
    const repo = mkRepo({ session: fs.readFileSync(TEMPLATE, 'utf8') });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'a freshly seeded file counts zero content lines');
    cleanup(repo);
  });

  await test('a repo that never opted in — silent, even with content', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']), optedIn: false });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no committed settings.json means no injection');
    cleanup(repo);
  });

  await test('a repo that turned the workflow off — silent', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']), enabled: false });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'enabled: false is a deliberate no');
    cleanup(repo);
  });

  await test('no cwd in the payload — silent', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ source: 'startup' }),
      env: { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'exit 0');
    assertEq(res.stdout || '', '', 'says nothing');
  });

  group('session: the light bar');

  await test('past ~40 content lines the injection says it is a queue, not a journal', () => {
    const many = Array.from({ length: 45 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const { stdout } = runHook(repo);
    const ctx = ctxOf(stdout);
    assert(ctx.includes('note 44'), 'the content is still handed back');
    assert(/queue, not a journal/.test(ctx), 'the warning is appended');
    assert(ctx.includes('45 content lines'), 'the warning counts content lines only');
    cleanup(repo);
  });

  await test('at the bar there is no warning', () => {
    const many = Array.from({ length: 40 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(!/queue, not a journal/.test(ctx), '40 lines is still light');
    cleanup(repo);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
