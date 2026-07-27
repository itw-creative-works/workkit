/* eslint-disable no-console */
//
// Tests for hooks/safety/commit-language — the PreToolUse hook that bounces
// git commit commands whose quoted message text uses non-neutral vocabulary
// (kill/destroy/dead → terminate/remove/stale). Only quoted spans are
// scanned, so unquoted file paths never trigger it.
//

const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'safety', 'commit-language', 'run.sh');

const runHook = (command) => {
  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const res = spawnSync('bash', [HOOK], {
    input,
    env: { ...process.env, HOME: os.homedir() },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stderr: res.stderr || '' };
};

const run = async () => {
  group('commit-language: bounced messages');

  await test('kill in -m message — exit 2 with replacement guidance', () => {
    const { code, stderr } = runHook('git commit -m "fix: kill the stuck watcher process"');
    assertEq(code, 2, 'kill must bounce');
    assert(stderr.includes('commit-language'), 'names itself');
    assert(stderr.includes('terminate'), 'suggests the neutral replacement');
  });

  await test('word variants and case — killed, Destroyed, DEAD all bounce', () => {
    for (const msg of ['killed the daemon', 'Destroyed old config', 'remove DEAD code']) {
      const { code } = runHook(`git commit -m "chore: ${msg}"`);
      assertEq(code, 2, `"${msg}" must bounce`);
    }
  });

  await test('HEREDOC body — exit 2', () => {
    const cmd = 'git commit -m "$(cat <<\'EOF\'\nfix(hooks): restart watcher\n\nKills the stale process before relaunch.\nEOF\n)"';
    const { code } = runHook(cmd);
    assertEq(code, 2, 'HEREDOC message text is scanned');
  });

  group('commit-language: allowed');

  await test('neutral message — exit 0', () => {
    const { code, stderr } = runHook('git commit -m "fix: terminate the stale watcher and remove old config"');
    assertEq(code, 0, 'neutral vocabulary passes');
    assertEq(stderr, '', 'silent');
  });

  await test('substring inside longer words — deadline, killarney — exit 0', () => {
    const { code } = runHook('git commit -m "feat: deadline reminder for killarney branch"');
    assertEq(code, 0, 'whole-word match only');
  });

  await test('unquoted file path with listed word — exit 0', () => {
    const { code } = runHook('git add kill-switch.md && git commit -m "docs: describe the hook disable flag"');
    assertEq(code, 0, 'unquoted paths are never scanned');
  });

  await test('non-commit git command with listed word quoted — exit 0', () => {
    const { code } = runHook('git grep "killed" -- src/');
    assertEq(code, 0, 'only commit commands are gated');
  });

  await test('mention of git commit inside quotes, no real commit — exit 0', () => {
    const { code } = runHook('echo "run git commit -m kill later"');
    assertEq(code, 0, 'stripped-quote detection ignores mentions');
  });

  await test('MULTI-LINE quoted mention — exit 0 (review regression)', () => {
    // A line-based quote strip left the tail lines of a multi-line quoted
    // string looking unquoted, misclassifying this echo as a real commit.
    const { code } = runHook('echo "todo list\ngit commit the fix that kills the watcher"');
    assertEq(code, 0, 'multi-line quoted text is stripped like single-line');
  });

  await test('heredoc BODY with git commit example and listed word — exit 0 (gotchas-sweep regression)', () => {
    // Appending skill prose via `cat >> file <<EOF` whose body holds a
    // literal `git commit` line plus a guarded word is file content, not a
    // commit — detection must strip heredoc bodies before clause-splitting.
    const cmd = 'cat >> SKILL.md <<\'EOF\'\n- when the gate bounces `git add -A && git commit -m "kill"`, re-stage\nEOF';
    const { code } = runHook(cmd);
    assertEq(code, 0, 'heredoc bodies are not commands');
  });

  await test('commit inside interpreter-fed heredoc with listed word — exit 2 (light-review finding)', () => {
    // A heredoc body piped INTO a shell is executed code — the detection
    // strip must not hide a real commit phrased this way.
    const cmd = 'bash <<\'EOF\'\ngit commit -m "kill the watcher"\nEOF';
    const { code } = runHook(cmd);
    assertEq(code, 2, 'interpreter-fed heredoc bodies are commands and must be scanned');
  });

  await test('quote character inside single quotes before a commit with a listed word — exit 2 (strip-ordering regression)', () => {
    const { code } = runHook('grep \'"\' notes.txt; git commit -m "kill the watcher"');
    assertEq(code, 2, 'detection must survive mixed quote nesting and scan the message');
  });

  group('commit-language: hardening 2026-07-25');

  await test('listed word in OTHER quoted text on the line — exit 0 (message-scope regression)', () => {
    // The scan used to read EVERY quoted span in the whole command, so the
    // echo text bounced a clean commit message.
    const { code, stderr } = runHook('git commit -m "docs: tidy" && echo "killing the old server"');
    assertEq(code, 0, `only message spans are judged, got: ${stderr}`);
  });

  await test('unquoted message falls back to the whole-command scan — exit 2', () => {
    // No extractable -m span → every quoted span is judged, toward gating.
    const { code } = runHook('git commit -m tidy && echo "killing the old server"');
    assertEq(code, 2, 'extraction failure must gate, never go silent');
  });

  await test('interpreter-string commit with a listed word — exit 2 (wrapper regression)', () => {
    // `sh -c "git commit …"` had no visible clause after the quote strip, so
    // the hook exited before scanning anything.
    const { code } = runHook('sh -c \'git commit -m "kill the watcher"\'');
    assertEq(code, 2, 'wrapped commits are still scanned');
  });

  await test('interpreter-string commit with a neutral message — exit 0', () => {
    const { code, stderr } = runHook('sh -c "git commit -m \'docs: tidy\'"');
    assertEq(code, 0, `neutral wrapped message passes, got: ${stderr}`);
  });

  await test('prefixed commit spellings are scanned — env/path (prefix regression)', () => {
    // These first words walked past the old first-word-is-git test.
    for (const c of ['env git commit -m "kill the watcher"', '/usr/bin/git commit -m "kill the watcher"']) {
      const { code } = runHook(c);
      assertEq(code, 2, `must bounce: ${c}`);
    }
  });

  await test('unquoted eval commit with a listed word — exit 2 (eval-peel regression)', () => {
    // `eval git commit -m "kill …"` executes the words essentially as
    // written, but eval was not peeled, so no clause was found and the hook
    // exited before scanning the message.
    const { code } = runHook('eval git commit -m "kill the watcher"');
    assertEq(code, 2, 'eval over plain words is a commit and must be scanned');
  });

  await test('attached -c string with a listed word — exit 2 (no-space regression)', () => {
    // `bash -c"git commit …"` runs the string, but the old wrapper detector
    // demanded whitespace between the option cluster and the quotes.
    const { code } = runHook('bash -c"git commit -m \'kill the watcher\'"');
    assertEq(code, 2, 'the attached option-argument form is still a wrapped commit');
  });

  group('commit-language: fail-open');

  await test('missing command — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'no command → fail open');
  });

  await test('malformed JSON — exit 0', () => {
    const res = spawnSync('bash', [HOOK], {
      input: 'not json',
      env: { ...process.env, HOME: os.homedir() },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, 'bad input → fail open');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
