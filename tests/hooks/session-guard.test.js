//
// Tests for hooks/docs:session-guard — the PostToolUse hook that holds
// `.workkit/session.md` to the shape of a queue: short bullets, few lines.
//
// Every case runs the real hook against a fixture file. The hook reads nothing
// but the written file, so there is nothing to stub: the whole surface is the
// path it was handed and the two caps.
//

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'docs', 'session-guard', 'run.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'session-guard-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

/** A session.md (or any other name/dir) holding `content`, returning its path. */
const mkFile = (content, { dir = W, name = 'session.md' } = {}) => {
  const root = mkTmp();
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  const file = path.join(root, dir, name);
  fs.writeFileSync(file, content);
  return file;
};

const runHook = (filePath) => {
  const res = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath } }),
    env: { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

/** The template's shape, with `bullets` as its Active entries. */
const doc = (bullets) => [
  '# Session',
  '',
  '## Active',
  ...bullets,
  '',
  '## Queue',
  '',
  '## Notes',
  '',
].join('\n');

const notes = (n) => Array.from({ length: n }, (_, i) => `- #${i} — a queued entry.`);

const run = async () => {
  group('session-guard: the line cap');

  await test('a session.md left over 40 content lines is bounced, count named', () => {
    const file = mkFile(doc(notes(45)));
    const { code, stderr } = runHook(file);
    assertEq(code, 2, 'exit 2 blocks the write');
    assert(stderr.includes('45 content lines'), `names the count, got: ${stderr}`);
    assert(stderr.includes('40'), `names the cap, got: ${stderr}`);
    assert(/queue, not a journal/.test(stderr), `says what the file is, got: ${stderr}`);
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('at the cap there is no bounce', () => {
    const file = mkFile(doc(notes(40)));
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    assertEq(stderr, '', 'silent');
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('headings, blockquotes, comments and blank lines do not count', () => {
    // Exactly 40 content lines beside the scaffolding: ANY scaffolding line
    // wrongly counted makes 41 and bounces, so a weakened exclusion regex
    // fails here, not just in the drift case.
    const file = mkFile([
      '# Session',
      '',
      '<!-- a seeded note about what this file is for -->',
      '',
      '## Active',
      ...notes(40),
      '',
      '## Queue',
      '',
      '> This file is a queue, not a journal.',
      '',
      '### A sub-heading',
      '',
      '## Notes',
      '',
    ].join('\n'));
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(path.dirname(path.dirname(file)));
  });

  group('session-guard: the bullet cap');

  await test('a bullet over 350 chars is bounced, with its length and its head', () => {
    const long = `- #126 the entry that would not stop ${'x'.repeat(400)}`;
    const file = mkFile(doc([long, '- #12 — a short one.']));
    const { code, stderr } = runHook(file);
    assertEq(code, 2, 'exit 2 blocks the write');
    assert(stderr.includes(`${long.length} chars`), `names the length ${long.length}, got: ${stderr}`);
    assert(stderr.includes('350'), `names the cap, got: ${stderr}`);
    assert(stderr.includes('#126 the entry that would not stop'), `names the offending bullet, got: ${stderr}`);
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('a bullet at 350 chars passes', () => {
    const at = `- ${'x'.repeat(348)}`;
    assertEq(at.length, 350, 'the fixture is exactly at the cap');
    const file = mkFile(doc([at]));
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('an indented `*` bullet is judged too', () => {
    const file = mkFile(doc([`  * ${'y'.repeat(400)}`]));
    assertEq(runHook(file).code, 2, 'exit 2 blocks the write');
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('a long line that is not a bullet is not judged as one', () => {
    const file = mkFile(doc([`#126 ${'z'.repeat(400)}`]));
    const { code, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    cleanup(path.dirname(path.dirname(file)));
  });

  group('session-guard: scope');

  await test('an under-cap session.md passes silently', () => {
    const file = mkFile(doc(notes(6)));
    const { code, stdout, stderr } = runHook(file);
    assertEq(code, 0, `exit 0, got: ${stderr}`);
    assertEq(stdout, '', 'says nothing');
    assertEq(stderr, '', 'silent');
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('another file in .workkit is ignored, however long', () => {
    const file = mkFile(doc(notes(60)), { name: 'inbox.md' });
    assertEq(runHook(file).code, 0, 'exit 0');
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('a session.md outside .workkit is ignored, however long', () => {
    const file = mkFile(doc(notes(60)), { dir: 'docs' });
    assertEq(runHook(file).code, 0, 'exit 0');
    cleanup(path.dirname(path.dirname(file)));
  });

  await test('a session.md that no longer exists — fail open', () => {
    const dir = mkTmp();
    assertEq(runHook(path.join(dir, W, 'session.md')).code, 0, 'exit 0');
    cleanup(dir);
  });

  await test('no file_path in the input — fail open', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: {} }),
      env: { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'exit 0');
  });

  await test('hooks.json registers the hook under PostToolUse Edit|Write', () => {
    const settings = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const entries = settings.hooks.PostToolUse.filter((e) => e.matcher === 'Edit|Write');
    assert(
      entries.some((e) => e.hooks.some((h) => h.command.includes('docs:session-guard'))),
      'docs:session-guard is wired',
    );
  });

  await test('the caps and the content-line regex agree with the docs:session hook', () => {
    // The bar lives in two places by design (each hook reads its own file with
    // no shared library); this case is what keeps them from drifting.
    const guard = fs.readFileSync(HOOK, 'utf8');
    const session = fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'docs', 'session', 'run.sh'), 'utf8');
    const regexOf = (src) => (src.match(/grep -cvE '([^']+)'/) || [])[1];
    assert(regexOf(guard), 'the guard counts content lines with a grep -cvE');
    assertEq(regexOf(guard), regexOf(session), 'the same content-line regex in both hooks');
    assertEq((session.match(/LIGHT_BAR=(\d+)/) || [])[1], '40', "docs:session's bar is 40");
    assertEq((guard.match(/MAX_CONTENT_LINES=(\d+)/) || [])[1], '40', "the guard's line cap is 40");
    assertEq((guard.match(/MAX_BULLET_CHARS=(\d+)/) || [])[1], '350', "the guard's bullet cap is 350");
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
