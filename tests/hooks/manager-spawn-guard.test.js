// manager/spawn-guard hook — the warn-only companion to the resolver.
// Covers both rules, both class spellings, the silence everywhere else, the
// fail-open preconditions, and the invariant the whole hook rests on: no path
// ever returns a permission decision, so a spawn is never blocked or altered.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'spawn-guard', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const LADDER_PATH = path.join(REPO, 'hooks', 'manager', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];
const FRONTIER = ladder.tiers.frontier;

let tmp;
const freshTmp = () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-guard-test-'));
  return tmp;
};

// A statusline-shaped session cache carrying the given model id.
const cacheSession = (sid, modelId) => {
  const dir = path.join(tmp, 'claude-session-state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sid.replace(/[^a-zA-Z0-9]/g, '_')}.json`),
    JSON.stringify({ model: { id: modelId }, thinking: { enabled: true } })
  );
};

const payload = (subagentType, extra = {}) => ({
  tool_name: 'Task',
  session_id: 'sess1',
  transcript_path: path.join(tmp, 'no-transcript.jsonl'),
  tool_input: { subagent_type: subagentType, prompt: 'do the thing', ...extra },
});

const runHook = (input, env = {}) => {
  const res = spawnSync('bash', [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: {
      ...process.env,
      TMPDIR: tmp,
      MANAGER_USER_SETTINGS: path.join(tmp, 'no-user-settings.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const warning = (out) => {
  const parsed = JSON.parse(out.stdout);
  return parsed.systemMessage;
};

const run = async () => {
  group('manager-spawn-guard: rule 1 — a hand-passed model on a class spawn');
  for (const cls of ['scout', 'worker', 'verifier', 'advisor']) {
    for (const name of [cls, `workkit:${cls}`]) {
      await test(`${name} with model: haiku warns`, () => {
        freshTmp();
        const out = runHook(payload(name, { model: 'haiku' }));
        assertEq(out.code, 0, out.stderr);
        const msg = warning(out);
        assert(msg.includes('manager:resolver'), `warning lacks the rule: ${msg}`);
        assert(msg.includes(cls), `warning lacks the class: ${msg}`);
      });
    }
  }
  await test('the same spawn WITHOUT a model param is silent', () => {
    freshTmp();
    const out = runHook(payload('worker'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('advise mode asks for the model param, so it does not warn', () => {
    freshTmp();
    const p = path.join(tmp, 'advise.json');
    fs.writeFileSync(p, JSON.stringify({ ...ladder, mode: 'advise' }));
    const out = runHook(payload('worker', { model: id('opus') }), { MANAGER_LADDER: p });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('manager-spawn-guard: rule 2 — the advisor in a frontier session');
  await test('an advisor spawn from a frontier session warns', () => {
    freshTmp();
    cacheSession('sess1', `${id(FRONTIER)}[1m]`);
    const out = runHook(payload('advisor'));
    assertEq(out.code, 0, out.stderr);
    assert(warning(out).includes('redundant'), warning(out));
  });
  await test('workkit:advisor from a frontier session warns the same', () => {
    freshTmp();
    cacheSession('sess1', id(FRONTIER));
    assert(warning(runHook(payload('workkit:advisor'))).includes('redundant'));
  });
  await test('an advisor spawn from an opus session is silent', () => {
    freshTmp();
    cacheSession('sess1', `${id('opus')}[1m]`);
    const out = runHook(payload('advisor'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('an unknown session model is silent (no cache, no transcript)', () => {
    freshTmp();
    const out = runHook(payload('advisor'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('a worker spawn from a frontier session is silent', () => {
    freshTmp();
    cacheSession('sess1', id(FRONTIER));
    const out = runHook(payload('worker'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('both rules at once produce one combined warning', () => {
    freshTmp();
    cacheSession('sess1', id(FRONTIER));
    const msg = warning(runHook(payload('advisor', { model: 'haiku' })));
    assert(msg.includes('manager:resolver'), msg);
    assert(msg.includes('redundant'), msg);
    assertEq(msg.split('manager:spawn-guard').length, 2, 'the prefix should appear once');
  });

  group('manager-spawn-guard: silence everywhere else');
  for (const type of ['Explore', 'Plan', 'general-purpose', 'reviewer', 'workkit:reviewer', 'no-such-type']) {
    await test(`subagent_type ${type} (with a model param) is silent`, () => {
      freshTmp();
      const out = runHook(payload(type, { model: 'haiku' }));
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '');
    });
  }
  await test('a non-Agent tool is silent', () => {
    freshTmp();
    const out = runHook({ ...payload('worker', { model: 'haiku' }), tool_name: 'Bash' });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('enabled: false silences the guard', () => {
    freshTmp();
    const settings = path.join(tmp, 'user-settings.json');
    fs.writeFileSync(settings, JSON.stringify({ version: 1, manager: { enabled: false } }));
    const out = runHook(payload('worker', { model: 'haiku' }), { MANAGER_USER_SETTINGS: settings });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  group('manager-spawn-guard: fail open');
  await test('a missing ladder is silent', () => {
    freshTmp();
    const out = runHook(payload('worker', { model: 'haiku' }), { MANAGER_LADDER: path.join(tmp, 'nope.json') });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('an unparseable ladder is silent', () => {
    freshTmp();
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json {');
    const out = runHook(payload('worker', { model: 'haiku' }), { MANAGER_LADDER: bad });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('garbage stdin exits 0 silently', () => {
    freshTmp();
    const out = runHook('this is not json');
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('empty stdin exits 0 silently', () => {
    freshTmp();
    const out = runHook('');
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });

  group('manager-spawn-guard: warn-only invariant');
  await test('no path ever returns a permission decision', () => {
    freshTmp();
    cacheSession('sess1', id(FRONTIER));
    const cases = [
      payload('worker', { model: 'haiku' }),
      payload('advisor'),
      payload('advisor', { model: 'haiku' }),
      payload('workkit:scout', { model: id('sonnet') }),
    ];
    for (const input of cases) {
      const out = runHook(input);
      assertEq(out.code, 0, out.stderr);
      assert(out.stdout.length > 0, 'expected a warning for this case');
      const parsed = JSON.parse(out.stdout);
      assertEq(parsed.decision, undefined, 'top-level decision must be absent');
      assertEq(parsed.hookSpecificOutput.permissionDecision, undefined, 'permissionDecision must be absent');
      assertEq(parsed.hookSpecificOutput.updatedInput, undefined, 'updatedInput must be absent');
      assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
      assertEq(parsed.hookSpecificOutput.additionalContext, parsed.systemMessage);
    }
  });

  group('manager-spawn-guard: loader integration');
  await test('loader routes manager:spawn-guard', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'manager:spawn-guard'], {
      input: JSON.stringify(payload('worker', { model: 'haiku' })),
      env: { ...process.env, TMPDIR: tmp, MANAGER_USER_SETTINGS: path.join(tmp, 'none.json') },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert(JSON.parse(res.stdout).systemMessage.includes('manager:spawn-guard'), res.stdout);
  });
  await test('HOOK_DISABLE=1 is a silent no-op', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'manager:spawn-guard'], {
      input: JSON.stringify(payload('worker', { model: 'haiku' })),
      env: { ...process.env, TMPDIR: tmp, HOOK_DISABLE: '1' },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0);
    assertEq(res.stdout, '');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
