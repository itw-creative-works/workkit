// Tests for manager:spawn-guard's logic, spawnGuardWarning(config,
// subagentType, givenModel, parentModel) in hooks/mods/spawn-guard.js: the
// warn-only companion to the resolver. Both rules, both class spellings, and
// the silence everywhere else. The warning's delivery, the never-a-decision
// invariant and the ladder read are test/mods/pre-tool-use.test.ts.

// HEAD cases retired with the mod (the engine parses the input): "garbage stdin exits 0 silently",
// "empty stdin exits 0 silently". The other HEAD cases this file does not hold keep their names in
// test/mods/pre-tool-use.test.ts.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const ladder = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'manager', 'resources', 'ladder.json'), 'utf8'));
const MODELS = { fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5' };

const config = (user) => mods('manager').managerConfig(ladder, user, undefined);
const warn = (type, given, parent = MODELS.opus, cfg = config()) => textOf(mods('spawn-guard').spawnGuardWarning(cfg, type, given, parent));

const cases = async () => {
  group('manager-spawn-guard: rule 1, a hand-passed model on a class spawn');
  for (const cls of ['scout', 'worker', 'verifier', 'advisor']) {
    for (const name of cls === 'advisor' ? [cls, `workkit:${cls}`] : [cls]) {
      await test(`ports "${name} with model: haiku warns"`, () => {
        const msg = warn(name, 'haiku');
        assert(msg.includes('manager:resolver'), `warning lacks the rule: ${msg}`);
        assert(msg.includes(cls), `warning lacks the class: ${msg}`);
      });
    }
  }
  await test('ports "advise mode asks for the model param, so it does not warn"', () => {
    assertEq(warn('workkit:worker', 'opus', MODELS.opus, config({ version: 1, manager: { mode: 'advise' } })), '', 'silent');
  });

  group('manager-spawn-guard: rule 2, the advisor in a frontier session');
  await test('ports "workkit:advisor from a frontier session warns the same"', () => {
    assert(warn('workkit:advisor', undefined, MODELS.fable).includes('redundant'), 'warns');
  });
  await test('ports "an advisor spawn from an opus session is silent"', () => {
    assertEq(warn('advisor', undefined, MODELS.opus), '', 'silent');
  });
  await test('ports "an unknown session model is silent (no cache, no transcript)"', () => {
    assertEq(warn('advisor', undefined, ''), '', 'silent');
  });
  await test('ports "a worker spawn from a frontier session is silent"', () => {
    assertEq(warn('worker', undefined, MODELS.fable), '', 'silent');
  });
  await test('ports "both rules at once produce one combined warning"', () => {
    const msg = warn('advisor', 'haiku', MODELS.fable);
    assert(msg.includes('manager:resolver'), msg);
    assert(msg.includes('redundant'), msg);
    assertEq(msg.split('manager:spawn-guard').length, 2, 'the prefix appears once');
  });

  group('manager-spawn-guard: silence everywhere else');
  for (const type of ['Explore', 'workkit:reviewer']) {
    await test(`ports "subagent_type ${type} (with a model param) is silent"`, () => {
      assertEq(warn(type, 'haiku'), '', 'silent');
    });
  }
  await test('ports "enabled: false silences the guard"', () => {
    assertEq(warn('worker', 'haiku', MODELS.opus, config({ version: 1, manager: { enabled: false } })), '', 'silent');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
