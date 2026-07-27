// manager/resolver hook — spawn-time model resolution for the class agents.
// Covers the ladder manifest shape, the full decision table in rewrite mode
// (both session-detection paths), advise mode, and the pass-through
// invariants: the resolver must NEVER touch a non-class spawn or break a
// session when its preconditions are missing.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'resolver', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const LADDER_PATH = path.join(REPO, 'hooks', 'manager', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];
// The fast tier's rung comes from the ladder, never hardcoded — the scout
// expectations below follow a tier retune (haiku → sonnet, Ian 2026-07-26)
// without edits here.
const FAST = ladder.tiers.fast;

let tmp;
const freshTmp = () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-test-'));
  return tmp;
};

// Write a statusline-shaped session cache carrying the given model id.
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

// A settings file carrying a manager block, in its own directory's .workkit/.
// `dir` doubles as the hook's cwd; git-init it to pin the repo-root resolution,
// leave it plain to exercise the fallback (a bare tmpdir is in no repo).
const settingsAt = (dir, manager, { git = false } = {}) => {
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  fs.writeFileSync(
    path.join(dir, W, 'settings.json'),
    typeof manager === 'string' ? manager : JSON.stringify({ version: 1, enabled: true, manager })
  );
  if (git) spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  return dir;
};

// A user-layer settings file (the MANAGER_USER_SETTINGS seam).
const userSettings = (manager) => {
  const p = path.join(tmp, 'user-settings.json');
  fs.writeFileSync(p, typeof manager === 'string' ? manager : JSON.stringify({ version: 1, repos: {}, manager }));
  return p;
};

const runHook = (input, env = {}) => {
  const res = spawnSync('bash', [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    // The user layer points at a nonexistent fixture by default, so the suite
    // never reads the running machine's own ~/.workkit/settings.json.
    env: {
      ...process.env,
      TMPDIR: tmp,
      MANAGER_DEBUG: '',
      MANAGER_USER_SETTINGS: path.join(tmp, 'no-user-settings.json'),
      ...env,
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

const resolvedModel = (out) => {
  const parsed = JSON.parse(out.stdout);
  return parsed.hookSpecificOutput.updatedInput.model;
};

const run = async () => {
  group('manager-resolver: ladder manifest shape');
  await test('ladder.json carries note, mode, and the three maps', () => {
    assert(typeof ladder.note === 'string' && ladder.note.length > 0, 'note missing');
    assert(['rewrite', 'advise'].includes(ladder.mode), `bad mode: ${ladder.mode}`);
    assert(ladder.ladder && ladder.classes && ladder.tiers, 'a map is missing');
  });
  await test('all four classes map through tiers into the ladder', () => {
    for (const cls of ['scout', 'worker', 'verifier', 'advisor']) {
      const tier = ladder.classes[cls];
      assert(tier, `class ${cls} missing`);
      const rung = ladder.tiers[tier];
      assert(rung, `tier ${tier} (class ${cls}) missing from tiers`);
      assert(ladder.ladder[rung], `rung ${rung} (tier ${tier}) missing from ladder`);
    }
  });
  await test('ladder is ordered strongest first (fable at the top)', () => {
    assertEq(Object.keys(ladder.ladder)[0], 'fable');
  });

  group('manager-resolver: decision table (rewrite, live cache)');
  const table = [
    // [class, session rung or null, expected rung]
    ['advisor', 'fable', 'fable'],
    ['advisor', 'sonnet', 'fable'],
    ['scout', 'fable', FAST],
    ['scout', 'sonnet', FAST],
    ['worker', 'fable', 'opus'],
    ['worker', 'opus', 'opus'],
    ['worker', 'sonnet', 'sonnet'],
    ['worker', 'haiku', 'haiku'],
    ['verifier', 'sonnet', 'sonnet'],
    ['verifier', 'fable', 'opus'],
  ];
  for (const [cls, sessionRung, expected] of table) {
    await test(`${cls} under a ${sessionRung} session → ${expected}`, () => {
      freshTmp();
      cacheSession('sess1', `${id(sessionRung)}[1m]`);
      const out = runHook(payload(cls));
      assertEq(out.code, 0, out.stderr);
      assertEq(resolvedModel(out), id(expected));
    });
  }
  await test('unknown session (no cache, no transcript) → worker gets the workhorse default', () => {
    freshTmp();
    const out = runHook(payload('worker'));
    assertEq(resolvedModel(out), id('opus'));
  });
  group('manager-resolver: both class spellings');
  // The classes answer to their bare names while they live in ~/.claude/agents,
  // and to workkit:<name> once they ship with this plugin. Both resolve the
  // same rung, and the prefixed spelling reaches the spawn unchanged.
  for (const [cls, expected] of [['advisor', 'fable'], ['scout', FAST], ['worker', 'opus']]) {
    await test(`workkit:${cls} resolves like ${cls}`, () => {
      freshTmp();
      cacheSession('sess1', `${id('fable')}[1m]`);
      const out = runHook(payload(`workkit:${cls}`));
      assertEq(out.code, 0, out.stderr);
      assertEq(resolvedModel(out), id(expected));
    });
  }
  await test('the prefixed subagent_type is passed through untouched', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const parsed = JSON.parse(runHook(payload('workkit:scout')).stdout);
    assertEq(parsed.hookSpecificOutput.updatedInput.subagent_type, 'workkit:scout');
  });
  await test('a workkit: prefix on a non-class type still passes through', () => {
    freshTmp();
    const out = runHook(payload('workkit:reviewer'));
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });

  await test('updatedInput preserves prompt and subagent_type, and allows', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const out = runHook(payload('scout'));
    const parsed = JSON.parse(out.stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assertEq(parsed.hookSpecificOutput.permissionDecision, 'allow');
    assertEq(parsed.hookSpecificOutput.updatedInput.prompt, 'do the thing');
    assertEq(parsed.hookSpecificOutput.updatedInput.subagent_type, 'scout');
  });

  group('manager-resolver: transcript fallback');
  await test('no cache → session model from the last assistant entry', () => {
    freshTmp();
    const transcript = path.join(tmp, 't.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: 'hi' }),
      JSON.stringify({ type: 'assistant', message: { model: id('sonnet') } }),
    ].join('\n'));
    const out = runHook({ ...payload('worker'), transcript_path: transcript });
    assertEq(resolvedModel(out), id('sonnet'));
  });
  await test('quoted transcript content cannot poison the session model', () => {
    freshTmp();
    const transcript = path.join(tmp, 't.jsonl');
    fs.writeFileSync(transcript, [
      JSON.stringify({ type: 'assistant', message: { model: id('sonnet') } }),
      // A tool-result line QUOTING an assistant entry that claims fable — the
      // jq validation must reject it, leaving the real sonnet entry to win.
      JSON.stringify({ type: 'user', toolUseResult: '{"type":"assistant","message":{"model":"claude-fable-5"}}' }),
    ].join('\n'));
    const out = runHook({ ...payload('worker'), transcript_path: transcript });
    assertEq(resolvedModel(out), id('sonnet'));
  });

  group('manager-resolver: pass-through invariants');
  for (const type of ['Explore', 'Plan', 'general-purpose', 'reviewer', 'claude', 'no-such-type']) {
    await test(`subagent_type ${type} spawns untouched`, () => {
      freshTmp();
      const out = runHook(payload(type));
      assertEq(out.code, 0, out.stderr);
      assertEq(out.stdout, '');
    });
  }
  await test('a non-Agent tool passes through', () => {
    freshTmp();
    const out = runHook({ ...payload('worker'), tool_name: 'Bash' });
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('an explicit model param is the manager\'s override (rewrite mode)', () => {
    freshTmp();
    const out = runHook(payload('worker', { model: 'haiku' }));
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('missing ladder file fails open', () => {
    freshTmp();
    const out = runHook(payload('worker'), { MANAGER_LADDER: path.join(tmp, 'nope.json') });
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('unparseable ladder fails open', () => {
    freshTmp();
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, 'not json {');
    const out = runHook(payload('worker'), { MANAGER_LADDER: bad });
    assertEq(out.code, 0);
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

  group('manager-resolver: advise mode');
  const adviseLadder = () => {
    const p = path.join(tmp, 'advise.json');
    fs.writeFileSync(p, JSON.stringify({ ...ladder, mode: 'advise' }));
    return p;
  };
  await test('class spawn without the resolved model blocks, naming it', () => {
    freshTmp();
    const out = runHook(payload('scout'), { MANAGER_LADDER: adviseLadder() });
    assertEq(out.code, 2);
    assert(out.stderr.includes(id(FAST)), `stderr lacks the model: ${out.stderr}`);
    assert(out.stderr.includes('scout'), 'stderr lacks the class');
  });
  await test('class spawn with the WRONG model blocks', () => {
    freshTmp();
    const out = runHook(payload('scout', { model: id('opus') }), { MANAGER_LADDER: adviseLadder() });
    assertEq(out.code, 2);
  });
  await test('class spawn already carrying the resolved model allows silently', () => {
    freshTmp();
    const out = runHook(payload('scout', { model: id(FAST) }), { MANAGER_LADDER: adviseLadder() });
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });
  await test('non-class spawns still pass through in advise mode', () => {
    freshTmp();
    const out = runHook(payload('Explore'), { MANAGER_LADDER: adviseLadder() });
    assertEq(out.code, 0);
    assertEq(out.stdout, '');
  });

  group('manager-resolver: layered overrides (repo > user > ladder)');
  await test('a repo tiers override moves the worker rung (git-resolved root)', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { tiers: { workhorse: 'sonnet' } }, { git: true });
    const out = runHook({ ...payload('worker'), cwd: repo });
    assertEq(out.code, 0, out.stderr);
    assertEq(resolvedModel(out), id('sonnet'));
  });
  await test('a subdirectory cwd resolves to the repo root', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { tiers: { workhorse: 'sonnet' } }, { git: true });
    const sub = path.join(repo, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const out = runHook({ ...payload('worker'), cwd: sub });
    assertEq(resolvedModel(out), id('sonnet'));
  });
  await test('a plain (non-git) cwd still reads its own .workkit/settings.json', () => {
    freshTmp();
    const dir = settingsAt(path.join(tmp, 'plain'), { tiers: { workhorse: 'haiku' } });
    const out = runHook({ ...payload('worker'), cwd: dir });
    assertEq(resolvedModel(out), id('haiku'));
  });
  await test('the user layer applies when the repo carries no settings', () => {
    freshTmp();
    const dir = path.join(tmp, 'bare');
    fs.mkdirSync(dir, { recursive: true });
    const out = runHook({ ...payload('worker'), cwd: dir },
      { MANAGER_USER_SETTINGS: userSettings({ tiers: { workhorse: 'haiku' } }) });
    assertEq(resolvedModel(out), id('haiku'));
  });
  await test('the repo layer beats the user layer', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { tiers: { workhorse: 'sonnet' } }, { git: true });
    const out = runHook({ ...payload('worker'), cwd: repo },
      { MANAGER_USER_SETTINGS: userSettings({ tiers: { workhorse: 'haiku' } }) });
    assertEq(resolvedModel(out), id('sonnet'));
  });
  await test('an override of one tier leaves the others alone', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { tiers: { workhorse: 'haiku' } }, { git: true });
    const out = runHook({ ...payload('scout'), cwd: repo });
    assertEq(resolvedModel(out), id(FAST));
  });
  await test('enabled: false passes a class spawn through untouched', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { enabled: false }, { git: true });
    const out = runHook({ ...payload('worker'), cwd: repo });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('enabled: false in the user layer is overridable by the repo', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { enabled: true }, { git: true });
    const out = runHook({ ...payload('worker'), cwd: repo },
      { MANAGER_USER_SETTINGS: userSettings({ enabled: false }) });
    assertEq(resolvedModel(out), id('opus'));
  });
  await test('a repo cannot redefine the ladder or the class map', () => {
    freshTmp();
    const repo = settingsAt(
      path.join(tmp, 'repo'),
      { classes: { worker: 'fast' }, ladder: { opus: 'haiku' } },
      { git: true }
    );
    const out = runHook({ ...payload('worker'), cwd: repo });
    assertEq(resolvedModel(out), id('opus'));
  });
  await test('a repo mode override switches the resolver to advise', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), { mode: 'advise' }, { git: true });
    const out = runHook({ ...payload('scout'), cwd: repo });
    assertEq(out.code, 2);
    assert(out.stderr.includes(id(FAST)), `stderr lacks the model: ${out.stderr}`);
  });
  await test('unparseable repo settings fall back to the ladder', () => {
    freshTmp();
    const repo = settingsAt(path.join(tmp, 'repo'), 'not json {', { git: true });
    const out = runHook({ ...payload('worker'), cwd: repo });
    assertEq(resolvedModel(out), id('opus'));
  });
  await test('settings without a manager block contribute nothing', () => {
    freshTmp();
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, W), { recursive: true });
    fs.writeFileSync(path.join(repo, W, 'settings.json'), JSON.stringify({ version: 1, enabled: false }));
    const out = runHook({ ...payload('worker'), cwd: repo });
    assertEq(resolvedModel(out), id('opus'));
  });
  await test('a cwd that does not exist fails open to the ladder', () => {
    freshTmp();
    const out = runHook({ ...payload('worker'), cwd: path.join(tmp, 'nowhere') });
    assertEq(resolvedModel(out), id('opus'));
  });

  group('manager-resolver: loader integration');
  await test('loader routes manager:resolver', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const res = spawnSync('bash', [LOADER, 'manager:resolver'], {
      input: JSON.stringify(payload('worker')),
      env: { ...process.env, TMPDIR: tmp },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assertEq(JSON.parse(res.stdout).hookSpecificOutput.updatedInput.model, id('opus'));
  });
  await test('HOOK_DISABLE=1 is a silent no-op', () => {
    freshTmp();
    const res = spawnSync('bash', [LOADER, 'manager:resolver'], {
      input: JSON.stringify(payload('worker')),
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

if (require.main === module) {
  module.exports().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
