// Tests for manager:resolver's logic: resolverModel(config, subagentType,
// parentModel, givenModel) in hooks/mods/resolver.js, over managerConfig(
// ladder, userSettings, repoSettings) and modelTier(id) in
// hooks/mods/manager.js. The ladder's shape, the decision table, both class
// spellings and the layer merge. The spawn itself (a given model, advise
// mode, the layers read off disk) is tests/mods/agent-spawn.test.ts.

// HEAD cases retired with the mod: "garbage stdin exits 0 silently", "empty stdin exits 0 silently" (the
// engine parses the input); "no cache → session model from the last assistant entry" and "quoted transcript
// content cannot poison the session model" (no transcript is read: the session model is e.parentModel);
// "a non-Agent tool passes through" (agent.spawn fires only for a spawn).

// HEAD cases ported under new names in tests/mods/agent-spawn.test.ts: "an explicit model param is the manager's
// override (rewrite mode)" as "a spawn already carrying a model passes on unchanged"; "class spawn without the
// resolved model blocks, naming it" as "mode advise refuses a class spawn with the re-issue text ...";
// "loader routes manager:resolver" as "workkit:worker with no model under a sonnet parent ..." (its run line).

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const LADDER_PATH = path.join(__dirname, '..', '..', 'hooks', 'manager', 'resources', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];
// The fast tier's rung comes from the ladder, so a tier retune needs no edit here.
const FAST = ladder.tiers.fast;
const MODELS = { fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5' };

const config = (user, repo) => mods('manager').managerConfig(ladder, user, repo);
const resolve = (type, parent, cfg = config()) => mods('resolver').resolverModel(cfg, type, parent, undefined);
const settings = (manager) => ({ version: 1, enabled: true, manager });

const run = async () => {
  group('manager-resolver: ladder manifest shape');
  await test('ports "ladder.json carries note, mode, and the three maps"', () => {
    assert(typeof ladder.note === 'string' && ladder.note.length > 0, 'note missing');
    assert(['rewrite', 'advise'].includes(ladder.mode), `bad mode: ${ladder.mode}`);
    assert(ladder.ladder && ladder.classes && ladder.tiers, 'a map is missing');
  });
  await test('ports "all four classes map through tiers into the ladder"', () => {
    for (const cls of ['scout', 'worker', 'verifier', 'advisor']) {
      const tier = ladder.classes[cls];
      assert(tier && ladder.tiers[tier] && ladder.ladder[ladder.tiers[tier]], `class ${cls} does not reach a rung`);
    }
  });
  await test('ports "ladder is ordered strongest first (fable at the top)"', () => {
    assertEq(Object.keys(ladder.ladder)[0], 'fable');
  });

  group('manager-resolver: the family matcher');
  await test('modelTier reads the rung off a session model id, a [1m] suffix included', () => {
    assertEq(mods('manager').modelTier(MODELS.fable), 'fable');
    assertEq(mods('manager').modelTier(MODELS.opus), 'opus');
    assertEq(mods('manager').modelTier(MODELS.sonnet), 'sonnet');
    assertEq(mods('manager').modelTier(MODELS.haiku), 'haiku');
    assert(!mods('manager').modelTier('gpt-4o'), 'an unknown family has no rung');
  });

  group('manager-resolver: decision table (rewrite)');
  for (const [cls, sessionRung, expected] of [
    ['advisor', 'fable', 'fable'], ['advisor', 'sonnet', 'fable'], ['scout', 'fable', FAST], ['scout', 'sonnet', FAST],
    ['worker', 'fable', 'opus'], ['worker', 'opus', 'opus'], ['worker', 'sonnet', 'sonnet'], ['worker', 'haiku', 'haiku'],
    ['verifier', 'sonnet', 'sonnet'], ['verifier', 'fable', 'opus'],
  ]) {
    await test(`ports "${cls} under a ${sessionRung} session → ${expected}"`, () => {
      assertEq(resolve(`workkit:${cls}`, MODELS[sessionRung]), id(expected));
    });
  }
  await test('ports "unknown session (no cache, no transcript) → worker gets the workhorse default"', () => {
    assertEq(resolve('workkit:worker', ''), id('opus'));
  });

  group('manager-resolver: both class spellings');
  for (const [cls, expected] of [['advisor', 'fable'], ['scout', FAST], ['worker', 'opus']]) {
    await test(`ports "workkit:${cls} resolves like ${cls}"`, () => {
      assertEq(resolve(cls, MODELS.fable), id(expected), 'the bare name');
      assertEq(resolve(`workkit:${cls}`, MODELS.fable), id(expected), 'the prefixed name');
    });
  }
  await test('ports "a workkit: prefix on a non-class type still passes through"', () => {
    assert(!resolve('workkit:reviewer', MODELS.fable), 'no model for a non-class type');
  });

  group('manager-resolver: layered overrides (repo > user > ladder)');
  await test('ports "an override of one tier leaves the others alone"', () => {
    assertEq(resolve('workkit:scout', MODELS.fable, config(undefined, settings({ tiers: { workhorse: 'haiku' } }))), id(FAST));
  });
  await test('ports "a repo cannot redefine the ladder or the class map"', () => {
    const cfg = config(undefined, settings({ classes: { worker: 'fast' }, ladder: { opus: 'haiku' } }));
    assertEq(resolve('workkit:worker', MODELS.fable, cfg), id('opus'));
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
