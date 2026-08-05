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
const msgOf = (stdout) => JSON.parse(stdout).systemMessage;

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

  group('session: the closing lines');

  await test('the context ends with the owner resume line', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const ctx = ctxOf(runHook(repo).stdout);
    assertEq(
      ctx.split('\n').pop(),
      'Owner: state carried over — say "continue" and this session resumes the queue above.',
      'the last line is addressed to the owner',
    );
    cleanup(repo);
  });

  await test('the context carries the manager duty line', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(
      ctx.includes('Manager: open your first reply after a restart or compaction with this state in plain words.'),
      'the first reply after a restart opens with the state',
    );
    cleanup(repo);
  });

  await test('the owner hears it — the resume line rides the visible channel too', () => {
    const repo = mkRepo({ session: filled(['#12 — the board sweep, mid-build']) });
    const { stdout } = runHook(repo);
    assertEq(
      msgOf(stdout),
      'workkit: state carried over — say "continue" to resume the session queue',
      'the systemMessage is the owner line',
    );
    cleanup(repo);
  });

  await test('a rule separates the file body from the closing lines', () => {
    const repo = mkRepo({ session: filled(['#12 — mid-build']) });
    const lines = ctxOf(runHook(repo).stdout).split('\n');
    const rule = lines.indexOf('---');
    assert(rule > 0, 'the injection carries a --- rule');
    assert(lines.findIndex((l) => l.includes('#12 — mid-build')) < rule,
      'the file body is above the rule');
    assert(lines.findIndex((l) => l.startsWith('Manager:')) > rule,
      'the closing lines are below it');
    cleanup(repo);
  });

  await test('a silent path says nothing on either channel', () => {
    const repo = mkRepo({ session: filled([]) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'no JSON at all — no context and no systemMessage');
    cleanup(repo);
  });

  await test('the closing lines follow the oversize warning, owner last', () => {
    const many = Array.from({ length: 45 }, (_, i) => `note ${i}`);
    const repo = mkRepo({ session: filled(many) });
    const ctx = ctxOf(runHook(repo).stdout);
    assert(/queue, not a journal/.test(ctx), 'the warning is still there');
    assert(ctx.indexOf('queue, not a journal') < ctx.indexOf('Manager: open your first reply'),
      'the warning comes before the closing lines');
    assert(ctx.trimEnd().endsWith('resumes the queue above.'), 'the owner line is still last');
    cleanup(repo);
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

  await test('a header-only session.md — silent, and the closing lines do not leak', () => {
    const repo = mkRepo({ session: filled([]) });
    const { code, stdout } = runHook(repo);
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'headings alone say nothing — not even the owner line');
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
