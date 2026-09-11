// docs/checkpoint hook: the compaction line fires the workkit:checkpoint skill
// deterministically (issue #238), and the second fire in one session asks for a
// delta instead of a whole-chat pass.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'docs', 'checkpoint', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const MARKER_DIR = 'claude-checkpoint-marker';

let tmp;
const freshTmp = () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
  return tmp;
};

const runHook = (input, env = {}, bin = 'bash') => {
  const res = spawnSync(bin, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, TMPDIR: tmp, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const contextOf = (out) => JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
const markers = () => {
  const dir = path.join(tmp, MARKER_DIR);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

// Every phrase the skill's own trigger paragraph names, plus the forms the
// pattern is meant to carry with them: the question form, the slash command,
// the noun, and an uppercase line (the prompt is lowercased before it matches).
const FIRING = [
  'Can I compact?',
  '/compact',
  'compaction',
  'should I compact before we continue?',
  'my context is running out',
  'context window is full',
  'the context is low',
  'we are running out of context here',
  'I am running low on context',
  'almost out of context, what next',
  'clear the chat',
  'clear this chat',
  'new chat',
  'fresh session',
  'start over',
  'CONTEXT IS RUNNING OUT, WHAT NOW',
];

const SILENT = [
  'ship the release when CI is green',
  // `context` with none of its four followers, including the words that
  // CONTAIN one ("below" is not "low", "follow" is not "low").
  'in this context, follow the steps below',
  'the context of the bug is issue #12',
  'give me more context on the resolver',
];

const run = async () => {
  group('docs-checkpoint: the compaction phrases fire');
  for (const prompt of FIRING) {
    await test(`fires on "${prompt}"`, () => {
      freshTmp();
      const out = runHook({ prompt, session_id: 'sess1' });
      assertEq(out.code, 0, out.stderr);
      const ctx = contextOf(out);
      assert(ctx.includes('workkit:checkpoint'), 'the injection must name the skill');
      assert(ctx.includes('#238'), 'the injection must cite its issue');
    });
  }

  group('docs-checkpoint: everything else is silence');
  for (const prompt of SILENT) {
    await test(`silent on "${prompt}"`, () => {
      freshTmp();
      const out = runHook({ prompt, session_id: 'sess1' });
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '', 'an unrelated prompt must produce no output');
      assertEq(markers().join(','), '', 'a silent run must write no marker');
    });
  }

  group('docs-checkpoint: the marker and the delta');
  await test('the first fire writes the marker and asks for the full pass', () => {
    freshTmp();
    const ctx = contextOf(runHook({ prompt: 'lets compact', session_id: 'sess-1' }));
    assert(ctx.includes('run the workkit:checkpoint skill before anything else'), `first fire said: ${ctx}`);
    assert(!ctx.includes('already issued'), 'the first fire is not a delta');
    assertEq(markers().join(','), 'sess_1', 'the marker is named by the sanitized session id');
  });

  await test('the second fire in the same session asks for a delta, naming the time', () => {
    freshTmp();
    runHook({ prompt: 'compact', session_id: 'sess-1' });
    const ctx = contextOf(runHook({ prompt: 'compact', session_id: 'sess-1' }));
    assert(ctx.includes('already issued this session at'), `second fire said: ${ctx}`);
    assert(/already issued this session at \d\d:\d\d\./.test(ctx), `no HH:MM time in: ${ctx}`);
    assert(ctx.includes('delta'), 'the second fire must ask for a delta');
  });

  await test('two session ids do not share a marker', () => {
    freshTmp();
    runHook({ prompt: 'compact', session_id: 'sess-1' });
    const ctx = contextOf(runHook({ prompt: 'compact', session_id: 'sess-2' }));
    assert(ctx.includes('run the workkit:checkpoint skill before anything else'), `other session said: ${ctx}`);
    assertEq(markers().join(','), 'sess_1,sess_2', 'each session keys its own marker');
  });

  await test('an empty session id fires the full line and writes no marker', () => {
    freshTmp();
    const ctx = contextOf(runHook({ prompt: 'compact' }));
    assert(ctx.includes('run the workkit:checkpoint skill before anything else'), `no-id fire said: ${ctx}`);
    assertEq(markers().join(','), '', 'nothing to key a marker by');
  });

  group('docs-checkpoint: robustness');
  await test('valid UserPromptSubmit JSON shape', () => {
    freshTmp();
    const parsed = JSON.parse(runHook({ prompt: 'compact', session_id: 'sess1' }).stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  });

  await test('a payload with no prompt key is silent', () => {
    freshTmp();
    const out = runHook({ session_id: 'sess1' });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  for (const [label, input] of [['garbage stdin', 'not json at all'], ['empty stdin', '']]) {
    await test(`${label} exits 0 silently`, () => {
      freshTmp();
      const out = runHook(input);
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '');
    });
  }

  await test('no jq on PATH exits 0 silently', () => {
    // PATH points at an empty directory, so the hook finds no jq (and no cat);
    // bash itself is reached by its absolute path, the way a hook command is.
    freshTmp();
    const empty = path.join(tmp, 'empty-path');
    fs.mkdirSync(empty, { recursive: true });
    const out = runHook({ prompt: 'compact', session_id: 'sess1' }, { PATH: empty }, '/bin/bash');
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('docs-checkpoint: loader integration');
  await test('loader routes docs:checkpoint', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'docs:checkpoint'], {
      input: JSON.stringify({ prompt: 'compact', session_id: 'sess1' }),
      env: { ...process.env, TMPDIR: tmp },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert((res.stdout || '').includes('workkit:checkpoint'), 'loader run should inject');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
