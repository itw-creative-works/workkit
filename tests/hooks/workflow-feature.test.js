// workflow/feature hook: a line about working an issue loads the workkit:feature
// skill deterministically, and later fires in the same session stay silent
// because the skill is already in context.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { BASH, SYSTEM_BASH, NO_RC, shellPath } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mkRepo } = require('../lib/git-repo');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'workflow', 'feature', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const MARKER_DIR = 'claude-feature-marker';
const LINE = '[Issue work detected (#374): load the workkit:feature skill before working the issue.]';

let tmp;
const freshTmp = () => {
  tmp = mkTmp('feature-test-');
  return tmp;
};

const runHook = (input, env = {}, bin = BASH) => {
  const res = spawnSync(bin, [...NO_RC, shellPath(HOOK)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, TMPDIR: shellPath(tmp), ...env },
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

// The owner's real lines about working the queue, plus the forms the pattern is
// meant to carry: an issue number with and without `#`, and an uppercase line
// (the prompt is lowercased before it matches).
const FIRING = [
  'ok go now, work on the issues we discussed',
  "let's do 880 879 now then ship after",
  'ok continue on 4-8 and we will do 9-12 after',
  'Ok what work on next',
  'ok lets work on our task list now',
  'continue',
  'ok whats next?',
  'do issue #42',
  '#42',
  'we do 878 880 and 879',
  "Let's finish up these issues",
  'resume',
  'WORK ON THE BOARD',
  'what is in the batch',
  'the open items',
  // The curly apostrophe a phone keyboard types is straightened before matching.
  'what\u2019s next',
  'let\u2019s do it',
  'keep going',
  'what now',
  'next one',
  "what's left",
  'whats left',
  // One line per phrase that no line above fires by alone, each matching that
  // phrase and nothing else, so deleting a phrase from the pattern goes red.
  'work the backlog',
  'do issue twelve',
  'look at the issues',
  'grab the next issue',
  'what next',
  'go now',
  'lets do it',
  'check my task list',
  'clear the queue',
  'show the board',
];

const SILENT = [
  'ship the release when CI is green',
  'what does this function return',
  'fix the typo in the readme',
  // A single digit is no issue number, and neither is a run glued to letters.
  'version 1.2.3',
  'a1234b',
  // A phrase inside a longer word is no phrase: `work on` in `framework only`,
  // `resume` in `presume`, `continue` in `discontinued`.
  'does the framework only run on mac',
  'I presume this is fine',
  'this api is discontinued',
];

const run = async () => {
  group('workflow-feature: the issue-work lines fire');
  for (const prompt of FIRING) {
    await test(`fires on "${prompt}"`, () => {
      freshTmp();
      const out = runHook({ prompt, session_id: 'sess1' });
      assertEq(out.code, 0, out.stderr);
      const ctx = contextOf(out);
      assert(ctx.includes('workkit:feature'), 'the injection must name the skill');
      assert(ctx.includes('#374'), 'the injection must cite its issue');
    });
  }

  await test('a bare 4 digit number fires and spends no session load', () => {
    freshTmp();
    const out = runHook({ prompt: 'the year 2026 was long', session_id: 'sess1' });
    assertEq(out.code, 0, out.stderr);
    assert(contextOf(out).includes('workkit:feature'), 'a bounded 2 to 4 digit number reads as an issue number');
  });

  group('workflow-feature: a bare number is a weak signal');
  await test('a bare number fires and leaves no marker', () => {
    freshTmp();
    const ctx = contextOf(runHook({ prompt: 'port 8080', session_id: 'sess-1' }));
    assertEq(ctx, LINE);
    assertEq(markers().join(','), '', 'a weak match must not spend the session load');
  });

  await test('a bare number then a strong line in one session fires twice', () => {
    freshTmp();
    assertEq(contextOf(runHook({ prompt: 'port 8080', session_id: 'sess-1' })), LINE);
    assertEq(contextOf(runHook({ prompt: 'work on #374', session_id: 'sess-1' })), LINE);
    assertEq(markers().join(','), 'sess_1', 'the strong match writes the marker');
  });

  await test('an issue number with `#` is strong on its own: it writes the marker', () => {
    freshTmp();
    assertEq(contextOf(runHook({ prompt: '#42', session_id: 'sess-1' })), LINE);
    assertEq(markers().join(','), 'sess_1', '`#N` is no port or year');
  });

  group('workflow-feature: everything else is silence');
  for (const prompt of SILENT) {
    await test(`silent on "${prompt}"`, () => {
      freshTmp();
      const out = runHook({ prompt, session_id: 'sess1' });
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '', 'an unrelated prompt must produce no output');
      assertEq(markers().join(','), '', 'a silent run must write no marker');
    });
  }

  group('workflow-feature: a system-delivered prompt is silence');
  await test('a task notification holding "work on #12" prints nothing; the owner\'s line fires', () => {
    freshTmp();
    const notice = '<task-notification>\n<task-id>b1</task-id>\n<summary>the worker said: work on #12</summary>\n</task-notification>';
    const out = runHook({ prompt: notice, session_id: 'sess-1' });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '', 'a notification is not the owner asking');
    assertEq(markers().join(','), '', 'and spends no session load');
    assertEq(contextOf(runHook({ prompt: 'work on #12', session_id: 'sess-1' })), LINE);
  });

  group('workflow-feature: the marker');
  await test('the first fire writes one marker keyed by the session id', () => {
    freshTmp();
    const ctx = contextOf(runHook({ prompt: 'work on #12', session_id: 'sess-1' }));
    assertEq(ctx, LINE);
    assertEq(markers().join(','), 'sess_1', 'the marker is named by the sanitized session id');
  });

  await test('the second fire in the same session prints nothing', () => {
    freshTmp();
    runHook({ prompt: 'work on #12', session_id: 'sess-1' });
    const out = runHook({ prompt: 'continue', session_id: 'sess-1' });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '', 'the skill is already in context');
    assertEq(markers().join(','), 'sess_1', 'still one marker');
  });

  await test('a different session id fires again', () => {
    freshTmp();
    runHook({ prompt: 'work on #12', session_id: 'sess-1' });
    const ctx = contextOf(runHook({ prompt: 'work on #12', session_id: 'sess-2' }));
    assert(ctx.includes('load the workkit:feature skill'), `other session said: ${ctx}`);
    assertEq(markers().join(','), 'sess_1,sess_2', 'each session keys its own marker');
  });

  await test('an empty session id fires the full line every time and writes no marker', () => {
    freshTmp();
    for (let i = 0; i < 2; i++) {
      const ctx = contextOf(runHook({ prompt: 'work on #12' }));
      assert(ctx.includes('load the workkit:feature skill before working the issue'), `no-id fire said: ${ctx}`);
    }
    assert(!fs.existsSync(path.join(tmp, MARKER_DIR)), 'nothing to key a marker by, so no marker directory');
  });

  group('workflow-feature: robustness');
  await test('valid UserPromptSubmit JSON shape', () => {
    freshTmp();
    const parsed = JSON.parse(runHook({ prompt: 'work on #12', session_id: 'sess1' }).stdout);
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
    const out = runHook({ prompt: 'work on #12', session_id: 'sess1' }, { PATH: empty }, SYSTEM_BASH);
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('workflow-feature: loader integration');
  await test('loader routes workflow:feature', () => {
    freshTmp();
    const { repo } = mkRepo('feature-loader-', {});
    const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), 'workflow:feature'], {
      input: JSON.stringify({ prompt: 'work on #12', session_id: 'sess1', cwd: shellPath(repo) }),
      env: { ...process.env, TMPDIR: shellPath(tmp) },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert((res.stdout || '').includes('workkit:feature'), 'loader run should inject');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
