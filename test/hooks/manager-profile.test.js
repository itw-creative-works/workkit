// Tests for manager:profile's logic, profileContext(config, model) in
// hooks/mods/profile.js over managerConfig(ladder, userSettings,
// repoSettings) in hooks/mods/manager.js: the manager standing instruction,
// injected only in manager-capable sessions (frontier or workhorse tier, or
// unknown). The session model's source ($.session.model()), the gate and
// HOOK_DISABLE are test/mods/user-prompt-submit.test.ts.

// HEAD cases retired with the mod (the engine parses the input): "garbage stdin exits 0", "empty stdin exits 0".
// HEAD cases ported under new names in test/mods/user-prompt-submit.test.ts: "loader routes manager:profile" and
// "valid UserPromptSubmit JSON shape" as "an opted-in repo: the contexts arrive in the order ...";
// "transcript fallback drives the tier too" as "the tier now comes from $.session.model()".

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
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
  await test('ports "the injection stays under 1600 characters on both rungs"', () => {
    for (const rung of ['fable', 'opus']) {
      const ctx = ctxFor(MODELS[rung]);
      assert(ctx.length < 1600, `${rung} injection is ${ctx.length} chars`);
    }
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
