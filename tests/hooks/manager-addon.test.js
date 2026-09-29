// manager/addon hook: a personal add-on stacks onto a workkit agent at spawn.
// Covers the add-on reaching its agent, the silent cases (no file, an empty
// file, a foreign agent), the default home, the loud unreadable file, and the
// wiring that routes SubagentStart through the loader.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, testUnless, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { BASH, NO_RC, IS_WINDOWS, NO_EXEC_BIT, shellPath } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'addon', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const HOOKS_JSON = path.join(REPO, 'hooks', 'hooks.json');
// A mode-000 file is unreadable only where modes exist and the reader is not root.
const NO_UNREADABLE = IS_WINDOWS ? NO_EXEC_BIT : process.getuid() === 0 && 'root reads a mode-000 file anyway';

// A workkit home with an agents/ folder, and the add-on file for one agent.
const freshHome = () => {
  const home = mkTmp('manager-addon-test-');
  fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
  return home;
};
const writeAddon = (home, name, text) => {
  const file = path.join(home, 'agents', `${name}.md`);
  fs.writeFileSync(file, text);
  return file;
};

const payload = (agentType) => ({
  session_id: 'sess1',
  cwd: REPO,
  hook_event_name: 'SubagentStart',
  agent_id: 'agent-abc123',
  agent_type: agentType,
});

const spawn = (argv, input, env) => {
  const res = spawnSync(BASH, [...NO_RC, ...argv], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};
const runHook = (input, home) => spawn([shellPath(HOOK)], input, { WORKFLOW_HOME: shellPath(home) });

const context = (out) => {
  const parsed = JSON.parse(out.stdout);
  assertEq(parsed.hookSpecificOutput.hookEventName, 'SubagentStart');
  return parsed.hookSpecificOutput.additionalContext;
};

const run = async () => {
  group('manager-addon: an add-on stacks onto its agent');
  await test('workkit:verifier with an add-on gets the header and the text', () => {
    const home = freshHome();
    const file = writeAddon(home, 'verifier', 'Always check the Windows lane.\nSecond line.\n');
    const out = runHook(payload('workkit:verifier'), home);
    assertEq(out.code, 0, out.stderr);
    const ctx = context(out);
    const [header, ...body] = ctx.split('\n');
    assertEq(header, `Personal add-on for workkit:verifier (from ${shellPath(file)}):`);
    assertEq(body.join('\n'), 'Always check the Windows lane.\nSecond line.');
  });
  await test('each agent reads its own file, not a sibling\'s', () => {
    const home = freshHome();
    writeAddon(home, 'verifier', 'verifier only');
    writeAddon(home, 'scout', 'scout only');
    const ctx = context(runHook(payload('workkit:scout'), home));
    assert(ctx.includes('scout only'), ctx);
    assert(!ctx.includes('verifier only'), ctx);
  });
  await test('with no WORKFLOW_HOME the add-on is read from ~/.workkit', () => {
    const home = mkTmp('manager-addon-home-');
    fs.mkdirSync(path.join(home, '.workkit', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.workkit', 'agents', 'worker.md'), 'from the default home');
    const out = spawn([shellPath(HOOK)], payload('workkit:worker'), { HOME: shellPath(home), WORKFLOW_HOME: undefined });
    assertEq(out.code, 0, out.stderr);
    assert(context(out).includes('from the default home'), out.stdout);
  });

  group('manager-addon: silence');
  await test('no add-on file: exit 0, no output', () => {
    const out = runHook(payload('workkit:verifier'), freshHome());
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
    assertEq(out.stderr, '');
  });
  await test('no agents folder at all: exit 0, no output', () => {
    const out = runHook(payload('workkit:verifier'), mkTmp('manager-addon-bare-'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  for (const [label, text] of [['an empty file', ''], ['a whitespace-only file', '\n  \n\t\n']]) {
    await test(`${label}: exit 0, no output`, () => {
      const home = freshHome();
      writeAddon(home, 'verifier', text);
      const out = runHook(payload('workkit:verifier'), home);
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '');
    });
  }
  for (const type of ['Explore', 'general-purpose', 'verifier', 'other-plugin:verifier']) {
    await test(`agent_type ${type} gets nothing, even with a matching file`, () => {
      const home = freshHome();
      writeAddon(home, 'verifier', 'must not leak');
      const out = runHook(payload(type), home);
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '');
    });
  }
  await test('garbage stdin exits 0 silently', () => {
    const out = runHook('this is not json', freshHome());
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });

  group('manager-addon: loud failure');
  await testUnless(Boolean(NO_UNREADABLE), NO_UNREADABLE)('an unreadable add-on exits non-zero naming the file', () => {
    const home = freshHome();
    const file = writeAddon(home, 'verifier', 'locked away');
    fs.chmodSync(file, 0o000);
    try {
      const out = runHook(payload('workkit:verifier'), home);
      assert(out.code !== 0, `expected a non-zero exit, got ${out.code}`);
      assert(out.code !== 2, 'exit 2 means a block; this is an error');
      assertEq(out.stdout, '');
      assert(out.stderr.startsWith('manager:addon: '), out.stderr);
      assert(out.stderr.includes(shellPath(file)), out.stderr);
    } finally {
      fs.chmodSync(file, 0o600);
    }
  });

  group('manager-addon: wiring');
  await test('hooks.json registers the hook under SubagentStart, matcher ^workkit:', () => {
    const wiring = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
    const entry = (wiring.hooks.SubagentStart || []).find((b) => b.matcher === '^workkit:');
    assert(entry, 'a SubagentStart block matching ^workkit: exists');
    assert(entry.hooks.some((h) => h.command.includes('manager:addon')), 'it routes manager:addon');
  });
  await test('loader routes manager:addon', () => {
    const home = freshHome();
    writeAddon(home, 'scout', 'through the loader');
    const out = spawn([shellPath(LOADER), 'manager:addon'], payload('workkit:scout'), { WORKFLOW_HOME: shellPath(home) });
    assertEq(out.code, 0, out.stderr);
    assert(context(out).includes('through the loader'), out.stdout);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
