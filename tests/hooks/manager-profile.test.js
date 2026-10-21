// Tests for manager:profile's logic, profileContext(config, model) in
// hooks/mods/profile.js over managerConfig(ladder, userSettings,
// repoSettings) in hooks/mods/manager.js: the manager standing instruction,
// injected only in manager-capable sessions (frontier or workhorse tier, or
// unknown). The session model's source ($.session.model()), the gate and
// HOOK_DISABLE are hooks/user-prompt-submit.test.ts.

// HEAD cases retired with the mod (the engine parses the input): "garbage stdin exits 0", "empty stdin exits 0".
// HEAD cases ported under new names in hooks/user-prompt-submit.test.ts: "loader routes manager:profile" and
// "valid UserPromptSubmit JSON shape" as "an opted-in repo: the contexts arrive in the order ...";
// "transcript fallback drives the tier too" as "the tier now comes from $.session.model()".

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { section } = require('../lib/markdown');
const { mods, textOf } = require('../lib/mods-inputs');

const REPO = path.join(__dirname, '..', '..');
const LADDER = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'manager', 'resources', 'ladder.json'), 'utf8'));
const MODELS = { fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5' };

const config = (user, repo, ladder = LADDER) => mods('manager').managerConfig(ladder, user, repo);
const ctxFor = (model, cfg = config()) => textOf(mods('profile').profileContext(cfg, model));
const settings = (manager) => ({ version: 1, enabled: true, manager });

const run = async () => {
  group('manager-profile: injection by session tier');
  await test('ports "frontier session injects the profile with the advisor-redundant clause"', () => {
    const ctx = ctxFor(MODELS.fable);
    assert(ctx.includes('MANAGER'), 'no MANAGER block');
    assert(ctx.includes('never pass a model param'), 'missing the resolver rule');
    assert(ctx.includes('redundant'), 'frontier session should get the redundant clause');
    assert(!ctx.includes('Consult the workkit:advisor'), 'frontier session must not be told to consult');
    assert(ctx.includes('workkit:scout') && ctx.includes('workkit:worker') && ctx.includes('workkit:verifier'), 'crew names must be plugin-namespaced');
    assert(!ctx.includes('agents/README.md'), 'no personal-tree citation');
    assert(ctx.includes('write the brief to a file'), 'handoff convention inlined');
    assert(ctx.includes('chat summary, never a file'), 'brief files gated on an actual dispatch');
  });
  await test('ports "workhorse session injects with the consult clause"', () => {
    const ctx = ctxFor(MODELS.opus);
    assert(ctx.includes('Consult the workkit:advisor'), 'workhorse session should consult the advisor');
    assert(!ctx.includes('redundant'), 'workhorse session must not get the redundant clause');
  });
  await test('ports "unknown session injects (default-frontier rationale)"', () => {
    assert(ctxFor('').includes('MANAGER'), 'an unknown tier still injects');
  });
  for (const rung of ['sonnet', 'haiku']) {
    await test(`ports "${rung} session is solo: no output at all"`, () => {
      assertEq(ctxFor(MODELS[rung]), '', 'solo');
    });
  }

  group('manager-profile: the injection is the delegation core only');
  await test('ports "the four core clauses are present"', () => {
    const ctx = ctxFor(MODELS.fable);
    assert(/recon/i.test(ctx) && /implementation/i.test(ctx) && /blind review/i.test(ctx), 'the delegation split is not stated');
    assert(ctx.includes('never pass a model param'), 'the resolver rule is missing');
    assert(ctx.includes("the agent's reply IS the report"), 'the file-handoff rule is missing');
    assert(/[Jj]udgment stays/.test(ctx), 'the judgment boundary is missing');
    assert(ctx.includes('self-contained'), 'the owner-question rule is missing');
    assert(ctx.includes('names the framework guide'), 'the brief routes the guide read');
    assert(ctx.includes('ONE bullet, bold lead = number + link + [status] + five words') && ctx.includes('Restating an issue'), 'the cold-reader line rides every prompt');
    assert(ctx.includes('link text #N, or repo#N on every link when the reply spans repos'), 'the repo prefix rule rides every prompt');
    for (const term of ['feature-developer', 'test-developer', 'scripts/red-proof.sh', 'docs/agents.md § Batches', 'briefs/']) {
      assert(ctx.includes(term), `the batch shape rides every prompt: "${term}" is missing`);
    }
  });
  await test('ports "the bold lead without the status token is gone"', () => {
    assert(!ctxFor(MODELS.fable).includes('bold lead = number + link + five words'), 'the bold lead still omits the status token');
  });
  await test('ports "the visibility rules are present on both rungs"', () => {
    for (const rung of ['fable', 'opus']) {
      const ctx = ctxFor(MODELS[rung]);
      assert(ctx.includes('Keep a visible checklist with the todo tool for any multi-step task: current item in progress, updated as steps start and finish, pruned when stale.'), `${rung}: the checklist rule is missing`);
      assert(ctx.includes('Announce every crew spawn in chat as you make it (class, model per the ladder, one-line mandate) and report what it returned when it finishes.'), `${rung}: the spawn-narration rule is missing`);
    }
  });
  await test('ports "the content that moved to docs/agents.md is gone"', () => {
    const ctx = ctxFor(MODELS.fable);
    for (const moved of ['Size the crew', 'worktree isolation', 'full review panel assembles', '.workkit/agents/session.md', 'Subagents never spawn']) {
      assert(!ctx.includes(moved), `"${moved}" belongs in docs/agents.md, not the injection`);
    }
  });
  await test('ports "the injection stays under 1600 characters on both rungs"', () => {
    for (const rung of ['fable', 'opus']) {
      const ctx = ctxFor(MODELS[rung]);
      assert(ctx.length < 1600, `${rung} injection is ${ctx.length} chars`);
    }
  });
  await test('ports "a findings clause names chat as the route and findings.file as the toggle, on both rungs"', () => {
    for (const rung of ['fable', 'opus']) {
      const clause = ctxFor(MODELS[rung]).split(/(?<=[.!?])\s+/).find((s) => s.includes('findings.file'));
      assert(clause, `${rung}: no clause names findings.file`);
      assert(/finding/i.test(clause.replace('findings.file', '')) && /\bchat\b/i.test(clause), `${rung}: the findings.file clause does not route findings to chat: ${clause}`);
    }
  });

  group('manager-profile: the batch start rule and the short issue line');
  await test('ports "a frontier session is told a batch is always one and spawns now"', () => {
    const ctx = ctxFor(MODELS.fable);
    for (const phrase of ['always one batch', 'spawns now', 'rides beside running work']) {
      assert(ctx.includes(phrase), `the batch start clause is missing "${phrase}"`);
    }
  });
  await test('ports "the issue line is one to three sentences on both rungs"', () => {
    for (const rung of ['fable', 'opus']) {
      const ctx = ctxFor(MODELS[rung]);
      assert(ctx.includes('one to three sentences'), `${rung}: the issue line does not say one to three sentences`);
      assert(!ctx.includes('two to three'), `${rung}: the issue line still says two to three`);
    }
  });
  await test('ports "docs/agents.md opens § Batches with the start rule and rules on owner questions"', () => {
    const md = path.join(REPO, 'docs', 'agents.md');
    assert(section(md, '### Batches').split(/\n\s*\n/)[0].includes('always one batch'), '§ Batches does not open with the start rule');
    assert(section(md, '### Questions to the owner').includes('same turn'), '§ Questions to the owner lacks the same-turn ruling');
  });
  await test('ports "docs/project-state.md points the Batches bullet at the start rule and shortens the issue line"', () => {
    const md = path.join(REPO, 'docs', 'project-state.md');
    const queue = section(md, '## Queue semantics');
    const bullet = queue.slice(queue.indexOf('- **Batches**')).split(/\n(?=- \*\*|\s*\n)/)[0];
    assert(bullet.startsWith('- **Batches**'), 'the Batches bullet is missing from § Queue semantics');
    assert(bullet.includes('start rule'), 'the Batches bullet does not point at the start rule');
    assert(section(md, '## Restating an issue').includes('one to three sentences'), '§ Restating an issue does not say one to three sentences');
  });

  group('manager-profile: layered overrides (repo > user > ladder)');
  await test('ports "enabled: false silences a frontier session"', () => {
    assertEq(ctxFor(MODELS.fable, config(undefined, settings({ enabled: false }))), '', 'silenced');
  });
  await test('ports "a repo workhorse override makes a sonnet session manager-capable"', () => {
    const ctx = ctxFor(MODELS.sonnet, config(undefined, settings({ tiers: { workhorse: 'sonnet' } })));
    assert(ctx.includes('MANAGER'), 'the overridden workhorse tier should inject');
    assert(ctx.includes('Consult the workkit:advisor'), 'a workhorse session should consult the advisor');
  });
  await test('ports "a user-layer frontier override drives the advisor clause"', () => {
    const user = { version: 1, repos: {}, manager: { tiers: { frontier: 'opus' } } };
    assert(ctxFor(MODELS.opus, config(user, undefined)).includes('redundant'), 'an opus session under a frontier: opus override IS the advisor');
  });
  await test('ports "a repo without a manager block changes nothing"', () => {
    assert(ctxFor(MODELS.fable, config(undefined, { version: 1, enabled: false })).includes('MANAGER'), 'the workflow key is not the manager key');
  });
  await test('ports "unparseable repo settings fall back to the ladder": a layer that could not be read is null', () => {
    assert(ctxFor(MODELS.fable, config(undefined, null)).includes('MANAGER'), 'garbage settings fail open');
  });

  group('manager-profile: robustness');
  await test('ports "missing ladder still injects with built-in tier names"', () => {
    assert(ctxFor(MODELS.fable, config(undefined, undefined, null)).includes('MANAGER'), 'falls back to the built-in tier names');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
