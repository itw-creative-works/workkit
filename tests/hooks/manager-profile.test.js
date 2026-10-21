// manager/profile hook: the manager standing instruction, injected only in
// manager-capable sessions (frontier/workhorse tier, or unknown).
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun, WORKKIT_DIR: W } = require('../lib/harness');
const { BASH, NO_RC, shellPath, loaderEnv } = require('../lib/platform');
const { mkTmp } = require('../lib/scratch');
const { mkRepo } = require('../lib/git-repo');
const { section } = require('../lib/markdown');

const REPO = path.join(__dirname, '..', '..');
const HOOK = path.join(REPO, 'hooks', 'manager', 'profile', 'run.sh');
const LOADER = path.join(REPO, 'hooks', 'loader.sh');
const LADDER_PATH = path.join(REPO, 'hooks', 'manager', 'resources', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];

let tmp;
const freshTmp = () => {
  tmp = mkTmp('profile-test-');
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
  transcript_path: shellPath(path.join(tmp, 'no-transcript.jsonl')),
  prompt: 'hello',
});

// A real git repo carrying a manager block in its .workkit/settings.json: the
// config reads a settings file only where git names a toplevel, so a bare
// tmpdir would prove nothing. A string body is written verbatim, for the cases
// about a file that says something else or does not parse.
const repoWith = (manager) => {
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(dir, W), { recursive: true });
  fs.writeFileSync(
    path.join(dir, W, 'settings.json'),
    typeof manager === 'string' ? manager : JSON.stringify({ version: 1, enabled: true, manager })
  );
  spawnSync('git', ['-C', dir, 'init', '-q'], { encoding: 'utf8' });
  return dir;
};

const runHook = (input, env = {}) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(HOOK)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    // The user layer points at a nonexistent fixture by default, so the suite
    // never reads the running machine's own ~/.workkit/settings.json.
    env: {
      ...process.env,
      TMPDIR: shellPath(tmp),
      MANAGER_USER_SETTINGS: shellPath(path.join(tmp, 'no-user-settings.json')),
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
    assert(ctx.includes('write the brief to a file'), 'handoff convention inlined');
    assert(ctx.includes('chat summary, never a file'), 'brief files gated on an actual dispatch (#192)');
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
    await test(`${rung} session is solo: no output at all`, () => {
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
    const out = runHook({ ...payload(), transcript_path: shellPath(transcript) });
    assertEq(out.stdout, '');
  });

  group('manager-profile: the injection is the delegation core only');
  await test('the four core clauses are present', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    assert(/recon/i.test(ctx) && /implementation/i.test(ctx) && /blind review/i.test(ctx), 'the delegation split is not stated');
    assert(ctx.includes('never pass a model param'), 'the resolver rule is missing');
    assert(ctx.includes("the agent's reply IS the report"), 'the file-handoff rule is missing');
    assert(/[Jj]udgment stays/.test(ctx), 'the judgment boundary is missing');
    assert(ctx.includes('self-contained'), 'the owner-question rule is missing');
    assert(ctx.includes('names the framework guide'), 'the brief routes the guide read');
    assert(ctx.includes('ONE bullet, bold lead = number + link + [status] + five words') && ctx.includes('Restating an issue'), 'the cold-reader line, with the status token, rides every prompt (#221, #417)');
    assert(ctx.includes('link text #N, or repo#N on every link when the reply spans repos'), 'the repo prefix rule rides every prompt (#386)');
    for (const term of ['feature-developer', 'test-developer', 'scripts/red-proof.sh', 'docs/agents.md § Batches', 'briefs/']) {
      assert(ctx.includes(term), `the batch shape rides every prompt: "${term}" is missing`);
    }
  });
  await test('the bold lead without the status token is gone (#417)', () => {
    // The old clause is not a substring of the new one, so a half-edit that
    // keeps it alongside the new phrase still fails here.
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    assert(!ctx.includes('bold lead = number + link + five words'), 'the bold lead still omits the status token');
  });
  await test('the visibility rules are present on both rungs (#154)', () => {
    // What a manager owes the chat while it delegates: the checklist that says
    // where the work is, and the spawn narration that says who is on it. Both
    // are stated for every session the profile injects into, not only the
    // frontier one, since a workhorse manager delegates the same way.
    for (const rung of ['fable', 'opus']) {
      freshTmp();
      cacheSession('sess1', id(rung));
      const ctx = contextOf(runHook(payload()));
      assert(ctx.includes('Keep a visible checklist with the todo tool for any multi-step task: current item in progress, updated as steps start and finish, pruned when stale.'),
        `${rung}: the checklist rule is missing`);
      assert(ctx.includes('Announce every crew spawn in chat as you make it (class, model per the ladder, one-line mandate) and report what it returned when it finishes.'),
        `${rung}: the spawn-narration rule is missing`);
    }
  });
  await test('the content that moved to docs/agents.md is gone', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    for (const moved of ['Size the crew', 'worktree isolation', 'full review panel assembles', '.workkit/agents/session.md', 'Subagents never spawn']) {
      assert(!ctx.includes(moved), `"${moved}" belongs in docs/agents.md, not the injection`);
    }
  });
  await test('the injection stays under 1600 characters on both rungs', () => {
    // The workhorse branch is the longer one (its advisor clause), so the cap
    // must be proven per rung: the frontier ctx alone leaves untested headroom,
    // and the next clause has to earn its place against the cap.
    for (const rung of ['fable', 'opus']) {
      freshTmp();
      cacheSession('sess1', id(rung));
      const ctx = contextOf(runHook(payload()));
      assert(ctx.length < 1600, `${rung} injection is ${ctx.length} chars`);
    }
  });
  await test('a findings clause names chat as the route and findings.file as the toggle, on both rungs', () => {
    // One sentence carries both, so "chat" said elsewhere in the injection
    // cannot stand in for the route.
    for (const rung of ['fable', 'opus']) {
      freshTmp();
      cacheSession('sess1', id(rung));
      const ctx = contextOf(runHook(payload()));
      const clause = ctx.split(/(?<=[.!?])\s+/).find((s) => s.includes('findings.file'));
      assert(clause, `${rung}: no clause names findings.file`);
      assert(/finding/i.test(clause.replace('findings.file', '')) && /\bchat\b/i.test(clause),
        `${rung}: the findings.file clause does not route findings to chat: ${clause}`);
    }
  });

  group('manager-profile: the batch start rule and the short issue line');
  await test('a frontier session is told a batch is always one and spawns now', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const ctx = contextOf(runHook(payload()));
    for (const phrase of ['always one batch', 'spawns now', 'rides beside running work']) {
      assert(ctx.includes(phrase), `the batch start clause is missing "${phrase}"`);
    }
  });
  await test('the issue line is one to three sentences on both rungs', () => {
    for (const rung of ['fable', 'opus']) {
      freshTmp();
      cacheSession('sess1', id(rung));
      const ctx = contextOf(runHook(payload()));
      assert(ctx.includes('one to three sentences'), `${rung}: the issue line does not say one to three sentences`);
      assert(!ctx.includes('two to three'), `${rung}: the issue line still says two to three`);
    }
  });
  await test('docs/agents.md opens § Batches with the start rule and rules on owner questions', () => {
    const md = path.join(REPO, 'docs', 'agents.md');
    const batches = section(md, '### Batches');
    const firstParagraph = batches.split(/\n\s*\n/)[0];
    assert(firstParagraph.includes('always one batch'), '§ Batches does not open with the start rule');
    assert(section(md, '### Questions to the owner').includes('same turn'), '§ Questions to the owner lacks the ruling that authorized work starts in the same turn');
  });
  await test('docs/project-state.md points the Batches bullet at the start rule and shortens the issue line', () => {
    const md = path.join(REPO, 'docs', 'project-state.md');
    const queue = section(md, '## Queue semantics');
    const bullet = queue.slice(queue.indexOf('- **Batches**')).split(/\n(?=- \*\*|\s*\n)/)[0];
    assert(bullet.startsWith('- **Batches**'), 'the Batches bullet is missing from § Queue semantics');
    assert(bullet.includes('start rule'), 'the Batches bullet does not point at the start rule');
    assert(section(md, '## Restating an issue').includes('one to three sentences'), '§ Restating an issue does not say one to three sentences');
  });

  group('manager-profile: layered overrides (repo > user > ladder)');
  await test('enabled: false silences a frontier session', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const out = runHook({ ...payload(), cwd: shellPath(repoWith({ enabled: false })) });
    assertEq(out.code, 0, out.stderr);
    assertEq(out.stdout, '');
  });
  await test('a repo workhorse override makes a sonnet session manager-capable', () => {
    freshTmp();
    cacheSession('sess1', id('sonnet'));
    const out = runHook({ ...payload(), cwd: shellPath(repoWith({ tiers: { workhorse: 'sonnet' } })) });
    const ctx = contextOf(out);
    assert(ctx.includes('MANAGER'), 'the overridden workhorse tier should inject');
    assert(ctx.includes('Consult the workkit:advisor'), 'a workhorse session should consult the advisor');
  });
  await test('a user-layer frontier override drives the advisor clause', () => {
    freshTmp();
    cacheSession('sess1', id('opus'));
    const userFile = path.join(tmp, 'user-settings.json');
    fs.writeFileSync(userFile, JSON.stringify({ version: 1, repos: {}, manager: { tiers: { frontier: 'opus' } } }));
    const ctx = contextOf(runHook(payload(), { MANAGER_USER_SETTINGS: shellPath(userFile) }));
    assert(ctx.includes('redundant'), 'an opus session under a frontier: opus override IS the advisor');
  });
  await test('a repo without a manager block changes nothing', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const dir = repoWith(JSON.stringify({ version: 1, enabled: false }));
    assert(contextOf(runHook({ ...payload(), cwd: shellPath(dir) })).includes('MANAGER'), 'the workflow key is not the manager key');
  });
  await test('unparseable repo settings fall back to the ladder', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const dir = repoWith('not json {');
    assert(contextOf(runHook({ ...payload(), cwd: shellPath(dir) })).includes('MANAGER'), 'garbage settings must fail open');
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
    const { repo } = mkRepo('profile-loader-', {});
    const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), 'manager:profile'], {
      input: JSON.stringify({ ...payload(), cwd: shellPath(repo) }),
      env: loaderEnv({ TMPDIR: shellPath(tmp) }),
      encoding: 'utf8',
      timeout: 10000,
    });
    assertEq(res.status, 0, res.stderr);
    assert(res.stdout.includes('MANAGER'), 'loader run should inject');
  });
  await test('HOOK_DISABLE=1 is a silent no-op', () => {
    freshTmp();
    cacheSession('sess1', id('fable'));
    const { repo } = mkRepo('profile-loader-', {});
    const res = spawnSync(BASH, [...NO_RC, shellPath(LOADER), 'manager:profile'], {
      input: JSON.stringify({ ...payload(), cwd: shellPath(repo) }),
      env: loaderEnv({ TMPDIR: shellPath(tmp), HOOK_DISABLE: '1' }),
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
