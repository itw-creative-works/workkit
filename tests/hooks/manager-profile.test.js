// manager/profile hook — the MANAGER standing instruction, injected only in
// manager-capable sessions (frontier/workhorse tier, or unknown).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, WORKKIT_DIR: W } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'profile', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const LADDER_PATH = path.join(REPO, 'hooks', 'manager', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];

let tmp;
const freshTmp = () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-test-'));
  return tmp;
};

const cacheSession = (sid, modelId) => {
  const dir = path.join(tmp, 'claude-session-state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${sid.replace(/[^a-zA-Z0-9]/g, '_')}.json`),
    JSON.stringify({ model: { id: modelId }, thinking: { enabled: true } })
  );
};

const payload = () => ({
  session_id: 'sess1',
  transcript_path: path.join(tmp, 'no-transcript.jsonl'),
  prompt: 'hello',
});

// A repo directory carrying a manager block in its .workkit/settings.json.
// Left plain (no git init): a bare tmpdir is in no repo, so the hook's repo
// root falls back to the cwd itself.
const repoWith = (manager) => {
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  fs.writeFileSync(
    path.join(dir, W, 'settings.json'),
    JSON.stringify({ version: 1, enabled: true, manager })
  );
  return dir;
};

const runHook = (input, env = {}) => {
  const res = spawnSync('bash', [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    // The user layer points at a nonexistent fixture by default, so the suite
    // never reads the running machine's own ~/.workkit/settings.json.
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

const contextOf = (out) => JSON.parse(out.stdout).hookSpecificOutput.additionalContext;

const run = async () => {
  group('manager-profile: injection by session tier');
  await test('frontier session injects the profile with the advisor-redundant clause', () => {
    freshTmp();
    cacheSession('sess1', `${id('fable')}[1m]`);
    const out = runHook(payload());
    assertEq(out.code, 0, out.stderr);
    const ctx = contextOf(out);
    assert(ctx.includes('MANAGER'), 'no MANAGER block');
    assert(ctx.includes('never pass a model param'), 'missing the resolver rule');
    assert(ctx.includes('redundant'), 'frontier session should get the redundant clause');
    assert(!ctx.includes('Consult the workkit:advisor'), 'frontier session must not be told to consult');
    assert(ctx.includes('workkit:scout') && ctx.includes('workkit:worker') && ctx.includes('workkit:verifier'), 'crew names must be plugin-namespaced');
    assert(!ctx.includes('agents/README.md'), 'no personal-tree citation');
    assert(ctx.includes('brief file') || ctx.includes('write the brief to a file'), 'handoff convention inlined');
  });
  await test('workhorse session injects with the consult clause', () => {
    freshTmp();
    cacheSession('sess1', id('opus'));
    const out = runHook(payload());
    const ctx = contextOf(out);
    assert(ctx.includes('Consult the workkit:advisor'), 'workhorse session should consult the advisor');
    assert(!ctx.includes('redundant'), 'workhorse session must not get the redundant clause');
  });
  await test('unknown session injects (default-frontier rationale)', () => {
    freshTmp();
    const out = runHook(payload());
    assertEq(out.code, 0);
    assert(contextOf(out).includes('MANAGER'), 'unknown tier should still inject');
  });
  for (const rung of ['sonnet', 'haiku']) {
    await test(`${rung} session is solo — no output at all`, () => {
      freshTmp();
      cacheSession('sess1', id(rung));
      const out = runHook(payload());
      assertEq(out.code, 0);
      assertEq(out.stdout, '');
    });
  }
  await test('transcript fallback drives the tier too', () => {
    freshTmp();
    const transcript = path.join(tmp, 't.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model: id('haiku') } }));
    const out = runHook({ ...payload(), transcript_path: transcript });
    assertEq(out.stdout, '');
  });

  group('manager-profile: the injection is the delegation core only');
  await test('the four core clauses are present', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    assert(/recon/i.test(ctx) && /implementation/i.test(ctx) && /blind review/i.test(ctx), 'the delegation split is not stated');
    assert(ctx.includes('never pass a model param'), 'the resolver rule is missing');
    assert(ctx.includes('return status only'), 'the file-handoff rule is missing');
    assert(/[Jj]udgment stays/.test(ctx), 'the judgment boundary is missing');
  });
  await test('the content that moved to docs/agents.md is gone', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    for (const moved of ['Size the crew', 'worktree isolation', 'review panel', '.workkit/session.md', 'Subagents never spawn']) {
      assert(!ctx.includes(moved), `"${moved}" belongs in docs/agents.md, not the injection`);
    }
  });
  await test('the injection stays under 600 characters on both rungs', () => {
    // The workhorse branch is the longer one (its advisor clause), so the cap
    // must be proven per rung — the frontier ctx alone leaves untested headroom.
    for (const rung of ['fable', 'opus']) {
      freshTmp();
      cacheSession('sess1', id(rung));
      const ctx = contextOf(runHook(payload()));
      assert(ctx.length < 600, `${rung} injection is ${ctx.length} chars`);
    }
  });

  group('manager-profile: layered overrides (repo > user > ladder)');
  await test('enabled: false silences a frontier session', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const out = runHook({ ...payload(), cwd: repoWith({ enabled: false }) });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('a repo workhorse override makes a sonnet session manager-capable', () => {
    freshTmp();
    cacheSession('sess1', id('sonnet'));
    const out = runHook({ ...payload(), cwd: repoWith({ tiers: { workhorse: 'sonnet' } }) });
    const ctx = contextOf(out);
    assert(ctx.includes('MANAGER'), 'the overridden workhorse tier should inject');
    assert(ctx.includes('Consult the workkit:advisor'), 'a workhorse session should consult the advisor');
  });
  await test('a user-layer frontier override drives the advisor clause', () => {
    freshTmp();
    cacheSession('sess1', id('opus'));
    const userFile = path.join(tmp, 'user-settings.json');
    fs.writeFileSync(userFile, JSON.stringify({ version: 1, repos: {}, manager: { tiers: { frontier: 'opus' } } }));
    const ctx = contextOf(runHook(payload(), { MANAGER_USER_SETTINGS: userFile }));
    assert(ctx.includes('redundant'), 'an opus session under a frontier: opus override IS the advisor');
  });
  await test('a repo without a manager block changes nothing', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const dir = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), JSON.stringify({ version: 1, enabled: false }));
    assert(contextOf(runHook({ ...payload(), cwd: dir })).includes('MANAGER'), 'the workflow key is not the manager key');
  });
  await test('unparseable repo settings fall back to the ladder', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const dir = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(dir, W), { recursive: true });
    fs.writeFileSync(path.join(dir, W, 'settings.json'), 'not json {');
    assert(contextOf(runHook({ ...payload(), cwd: dir })).includes('MANAGER'), 'garbage settings must fail open');
  });

  group('manager-profile: robustness');
  await test('valid UserPromptSubmit JSON shape', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const parsed = JSON.parse(runHook(payload()).stdout);
    assertEq(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  });
  await test('garbage stdin exits 0', () => {
    freshTmp();
    const out = runHook('not json at all');
    assertEq(out.code, 0);
  });
  await test('empty stdin exits 0', () => {
    freshTmp();
    const out = runHook('');
    assertEq(out.code, 0);
  });
  await test('missing ladder still injects with built-in tier names', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const out = runHook(payload(), { MANAGER_LADDER: path.join(tmp, 'nope.json') });
    assertEq(out.code, 0);
    assert(contextOf(out).includes('MANAGER'), 'should fall back to the built-in tier names');
  });

  group('manager-profile: loader integration');
  await test('loader routes manager:profile', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const res = spawnSync('bash', [LOADER, 'manager:profile'], {
      input: JSON.stringify(payload()),
      env: { ...process.env, TMPDIR: tmp },
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert(res.stdout.includes('MANAGER'), 'loader run should inject');
  });
  await test('HOOK_DISABLE=1 is a silent no-op', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const res = spawnSync('bash', [LOADER, 'manager:profile'], {
      input: JSON.stringify(payload()),
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
