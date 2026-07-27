//
// Tests for hooks/workflow:reload-guard — the SessionStart stamp and the
// UserPromptSubmit reminder that the kit checkout changed since the session
// loaded.
//
// Every run points RELOAD_GUARD_ROOT at a fixture checkout and TMPDIR at a
// throwaway directory: the surfaces these tests change are hooks.json, agent
// files, and skill files, which in the real root belong to this repo.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const HOOK = path.join(__dirname, '..', '..', 'hooks', 'workflow', 'reload-guard', 'run.sh');
const LOADER = path.join(__dirname, '..', '..', 'hooks', 'loader.sh');

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rg-test-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

// A minimal checkout carrying the three load-time surfaces the hook watches.
const makeRoot = () => {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'skills', 'ship'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }, null, 2));
  fs.writeFileSync(path.join(dir, 'agents', 'worker.md'), '# worker\n');
  fs.writeFileSync(path.join(dir, 'skills', 'ship', 'SKILL.md'), '# ship\n');
  return dir;
};

// mtime resolution is one second on some filesystems, so a change that must be
// SEEN gets an explicit backdate rather than a same-second rewrite.
const touchOlder = (file, seconds) => {
  const when = new Date(Date.now() - seconds * 1000);
  fs.utimesSync(file, when, when);
};

// A session-keyed state directory shared across the runs of one test — that
// sharing is what makes the stamp comparison meaningful.
const makeSession = () => ({ id: `sess-${Math.random().toString(36).slice(2)}`, state: mkTmp() });

const runHook = (event, { root, session, script = HOOK, args = [], env = {} } = {}) => {
  const input = JSON.stringify({
    hook_event_name: event,
    session_id: session.id,
    cwd: root,
    transcript_path: '',
  });
  const res = spawnSync('bash', [script, ...args], {
    input,
    env: {
      ...process.env,
      RELOAD_GUARD_ROOT: root,
      TMPDIR: session.state,
      ...env,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const stateFiles = (session) => {
  const dir = path.join(session.state, 'workkit-reload-guard');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

const noticed = (out) => out.includes('/reload-plugins');

const run = async () => {
  group('reload-guard: the SessionStart stamp');

  await test('SessionStart writes the stamp and says nothing', () => {
    const root = makeRoot();
    const session = makeSession();
    const { code, stdout } = runHook('SessionStart', { root, session });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'stamping is silent');
    assert(stateFiles(session).some((f) => f.endsWith('.stamp')), `a stamp exists, got: ${stateFiles(session)}`);
    cleanup(root); cleanup(session.state);
  });

  await test('a second SessionStart re-stamps the current state', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    const dir = path.join(session.state, 'workkit-reload-guard');
    const stamp = path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.stamp')));
    const first = fs.readFileSync(stamp, 'utf8');
    touchOlder(path.join(root, 'agents', 'worker.md'), 120);
    runHook('SessionStart', { root, session });
    assert(fs.readFileSync(stamp, 'utf8') !== first, 'the new state replaces the old one');
    // And the session that just loaded it hears nothing.
    assert(!noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'a freshly loaded session is current');
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: an unchanged checkout is silent');

  await test('prompt after a stamp with nothing touched — no output', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    const { code, stdout } = runHook('UserPromptSubmit', { root, session });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'nothing changed, nothing to say');
    cleanup(root); cleanup(session.state);
  });

  await test('rewriting hooks.json with identical wiring is not a change', () => {
    const root = makeRoot();
    const session = makeSession();
    const file = path.join(root, 'hooks', 'hooks.json');
    runHook('SessionStart', { root, session });
    const body = fs.readFileSync(file, 'utf8');
    touchOlder(file, 300);
    fs.writeFileSync(file, body);
    assertEq(runHook('UserPromptSubmit', { root, session }).stdout, '', 'hooks.json is judged by content, not mtime');
    cleanup(root); cleanup(session.state);
  });

  await test('editing an existing hook script is not a change — those edits are already live', () => {
    const root = makeRoot();
    const session = makeSession();
    fs.mkdirSync(path.join(root, 'hooks', 'docs', 'state-check'), { recursive: true });
    const script = path.join(root, 'hooks', 'docs', 'state-check', 'run.sh');
    fs.writeFileSync(script, '#!/bin/bash\nexit 0\n');
    runHook('SessionStart', { root, session });
    fs.writeFileSync(script, '#!/bin/bash\n# rewritten\nexit 0\n');
    assertEq(runHook('UserPromptSubmit', { root, session }).stdout, '', 'only load-time surfaces count');
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: a change nags once');

  await test('rewired hooks.json — one notice, then silence', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.writeFileSync(
      path.join(root, 'hooks', 'hooks.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'x' }] }] } }, null, 2),
    );
    const first = runHook('UserPromptSubmit', { root, session });
    assertEq(first.code, 0, 'a reminder never costs the prompt');
    assert(noticed(first.stdout), `the change is announced, got: ${first.stdout}`);
    assert(first.stdout.includes('already live'), 'and says what does NOT need a reload');
    const second = runHook('UserPromptSubmit', { root, session });
    assertEq(second.stdout, '', 'the same change nags once, not every prompt');
    const third = runHook('UserPromptSubmit', { root, session });
    assertEq(third.stdout, '', 'and stays quiet');
    cleanup(root); cleanup(session.state);
  });

  await test('a FURTHER change nags again', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{ "hooks": { "Stop": [] } }\n');
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'the first change is announced');
    assertEq(runHook('UserPromptSubmit', { root, session }).stdout, '', 'and then quiet');
    fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{ "hooks": { "Stop": [], "PreToolUse": [] } }\n');
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'a new change is a new notice');
    cleanup(root); cleanup(session.state);
  });

  await test('a new agent file is a change, even though it has no previous mtime', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.writeFileSync(path.join(root, 'agents', 'scout.md'), '# scout\n');
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'a new agent needs a reload');
    cleanup(root); cleanup(session.state);
  });

  await test('a new skill directory is a change', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.mkdirSync(path.join(root, 'skills', 'triage'));
    fs.writeFileSync(path.join(root, 'skills', 'triage', 'SKILL.md'), '# triage\n');
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'a new skill needs a reload');
    cleanup(root); cleanup(session.state);
  });

  await test('an edited agent file is a change', () => {
    const root = makeRoot();
    const session = makeSession();
    const file = path.join(root, 'agents', 'worker.md');
    runHook('SessionStart', { root, session });
    touchOlder(file, 600);
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'an agent definition is read at load time');
    cleanup(root); cleanup(session.state);
  });

  await test('a removed agent file is a change', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.rmSync(path.join(root, 'agents', 'worker.md'));
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'the file LIST is part of the state');
    cleanup(root); cleanup(session.state);
  });

  await test('the notice is valid UserPromptSubmit context', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.writeFileSync(path.join(root, 'agents', 'verifier.md'), '# verifier\n');
    const parsed = JSON.parse(runHook('UserPromptSubmit', { root, session }).stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'correct event name');
    assertEq(
      parsed.hookSpecificOutput.additionalContext.split('\n').length, 1,
      'exactly one line',
    );
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: sessions are independent');

  await test('a second session started after the change is current, and hears nothing', () => {
    const root = makeRoot();
    const session = makeSession();
    const later = { id: 'sess-later', state: session.state };
    runHook('SessionStart', { root, session });
    fs.writeFileSync(path.join(root, 'agents', 'advisor.md'), '# advisor\n');
    runHook('SessionStart', { root, session: later });
    assertEq(runHook('UserPromptSubmit', { root, session: later }).stdout, '', 'it loaded the new state');
    assert(noticed(runHook('UserPromptSubmit', { root, session }).stdout), 'the older session is still out of date');
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: guards');

  await test('no stamp at all — re-stamped silently, no phantom change', () => {
    const root = makeRoot();
    const session = makeSession();
    const { code, stdout } = runHook('UserPromptSubmit', { root, session });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'a session that never stamped is not out of date');
    assert(stateFiles(session).some((f) => f.endsWith('.stamp')), 'and the stamp is written now');
    assertEq(runHook('UserPromptSubmit', { root, session }).stdout, '', 'so the next prompt is quiet too');
    cleanup(root); cleanup(session.state);
  });

  await test('garbage stdin — exit 0, silent', () => {
    const root = makeRoot();
    const session = makeSession();
    const res = spawnSync('bash', [HOOK], {
      input: 'not json at all {{{',
      env: { ...process.env, RELOAD_GUARD_ROOT: root, TMPDIR: session.state },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'exit 0');
    assertEq(res.stdout || '', '', 'silent');
    cleanup(root); cleanup(session.state);
  });

  await test('no session id — exit 0, and nothing is written', () => {
    const root = makeRoot();
    const session = makeSession();
    const res = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit' }),
      env: { ...process.env, RELOAD_GUARD_ROOT: root, TMPDIR: session.state },
      encoding: 'utf8',
      timeout: 15000,
    });
    assertEq(res.status, 0, 'exit 0');
    assertEq(res.stdout || '', '', 'silent');
    assertEq(stateFiles(session).length, 0, 'an unkeyed session gets no state file');
    cleanup(root); cleanup(session.state);
  });

  await test('an unexpected event name — exit 0, silent', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session });
    fs.writeFileSync(path.join(root, 'agents', 'reviewer.md'), '# reviewer\n');
    const { code, stdout } = runHook('Stop', { root, session });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'this hook answers two events and no others');
    cleanup(root); cleanup(session.state);
  });

  await test('a checkout missing every surface — exit 0, silent', () => {
    const root = mkTmp();
    const session = makeSession();
    assertEq(runHook('SessionStart', { root, session }).code, 0, 'stamping an empty tree is fine');
    const { code, stdout } = runHook('UserPromptSubmit', { root, session });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'nothing to compare, nothing to say');
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: loader integration');

  await test('the loader routes workflow:reload-guard and the notice comes through', () => {
    const root = makeRoot();
    const session = makeSession();
    const via = (event) => runHook(event, { root, session, script: LOADER, args: ['workflow:reload-guard'] });
    assertEq(via('SessionStart').code, 0, 'routed and stamped');
    fs.writeFileSync(path.join(root, 'agents', 'scout.md'), '# scout\n');
    const { code, stdout } = via('UserPromptSubmit');
    assertEq(code, 0, 'exit 0 through the loader');
    assert(noticed(stdout), `the notice survives the loader, got: ${stdout}`);
    cleanup(root); cleanup(session.state);
  });

  await test('HOOK_DISABLE=1 silences it entirely', () => {
    const root = makeRoot();
    const session = makeSession();
    runHook('SessionStart', { root, session, script: LOADER, args: ['workflow:reload-guard'] });
    fs.writeFileSync(path.join(root, 'agents', 'scout.md'), '# scout\n');
    const { code, stdout } = runHook('UserPromptSubmit', {
      root, session, script: LOADER, args: ['workflow:reload-guard'], env: { HOOK_DISABLE: '1' },
    });
    assertEq(code, 0, 'exit 0');
    assertEq(stdout, '', 'the per-command hatch bypasses the reminder');
    cleanup(root); cleanup(session.state);
  });

  group('reload-guard: registration');

  await test('hooks.json wires it on both events, through the loader', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'));
    const commands = (event) => (wiring.hooks[event] || [])
      .flatMap((entry) => entry.hooks || [])
      .map((h) => h.command);
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      assert(
        commands(event).some((c) => c.includes('loader.sh workflow:reload-guard')),
        `${event} runs the reload guard, got: ${commands(event).join(' | ')}`,
      );
    }
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
