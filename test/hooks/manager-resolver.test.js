// Tests for manager:resolver's logic: resolverModel(config, subagentType, parentModel, givenModel) in
// hooks/mods/resolver.js, over managerConfig(ladder, settings) and modelTier(id) in hooks/mods/manager.js.
// The ladder's shape, the decision table, both class spellings and the layer merge. The spawn itself (a given model,
// advise mode, the layers read off disk) is test/mods/agent-spawn.test.ts.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');
const { mods, mergedSettings } = require('../lib/mods-inputs');

const DEFAULTS_PATH = path.join(__dirname, '..', '..', 'defaults', 'settings.json');

const LADDER_PATH = path.join(__dirname, '..', '..', 'hooks', 'manager', 'resources', 'ladder.json');
const ladder = JSON.parse(fs.readFileSync(LADDER_PATH, 'utf8'));
const id = (rung) => ladder.ladder[rung];
// The fast tier's rung is the kit defaults file's, read as data, so a tier retune needs no edit here.
const FAST = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8')).manager.tiers.fast;
const MODELS = { fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5' };

const config = (user, repo) => mods('manager').managerConfig(ladder, mergedSettings({ user, repo }));
const resolve = (type, parent, cfg = config()) => mods('resolver').resolverModel(cfg, type, parent, undefined);
const settings = (manager) => ({ enabled: true, manager });

describe('manager-resolver: ladder manifest shape', () => {
  test('ladder.json carries note and the two maps', () => {
    expect(typeof ladder.note === 'string' && ladder.note.length > 0, 'note missing').toBeTruthy();
    expect(ladder.ladder && ladder.classes, 'a map is missing').toBeTruthy();
  });
  test('ladder is ordered strongest first (fable at the top)', () => {
    expect(Object.keys(ladder.ladder)[0]).toBe('fable');
  });
});

describe('manager-resolver: the family matcher', () => {
  test('modelTier reads the rung off a session model id, a [1m] suffix included', () => {
    expect(mods('manager').modelTier(MODELS.fable)).toBe('fable');
    expect(mods('manager').modelTier(MODELS.opus)).toBe('opus');
    expect(mods('manager').modelTier(MODELS.sonnet)).toBe('sonnet');
    expect(mods('manager').modelTier(MODELS.haiku)).toBe('haiku');
    expect(!mods('manager').modelTier('gpt-4o'), 'an unknown family has no rung').toBeTruthy();
  });
});

describe('manager-resolver: decision table (rewrite)', () => {
  for (const [cls, sessionRung, expected] of [
    ['advisor', 'fable', 'fable'], ['advisor', 'sonnet', 'fable'], ['scout', 'fable', FAST], ['scout', 'sonnet', FAST],
    ['worker', 'fable', 'opus'], ['worker', 'opus', 'opus'], ['worker', 'sonnet', 'sonnet'], ['worker', 'haiku', 'haiku'],
    ['verifier', 'sonnet', 'sonnet'], ['verifier', 'fable', 'opus'],
  ]) {
    test(`${cls} under a ${sessionRung} session → ${expected}`, () => {
      expect(resolve(`workkit:${cls}`, MODELS[sessionRung])).toBe(id(expected));
    });
  }
  test('unknown session (no cache, no transcript) → worker gets the workhorse default', () => {
    expect(resolve('workkit:worker', '')).toBe(id('opus'));
  });
});

describe('manager-resolver: both class spellings', () => {
  for (const [cls, expected] of [['advisor', 'fable'], ['scout', FAST], ['worker', 'opus']]) {
    test(`workkit:${cls} resolves like ${cls}`, () => {
      expect(resolve(cls, MODELS.fable), 'the bare name').toBe(id(expected));
      expect(resolve(`workkit:${cls}`, MODELS.fable), 'the prefixed name').toBe(id(expected));
    });
  }
  test('a workkit: prefix on a non-class type still passes through', () => {
    expect(!resolve('workkit:reviewer', MODELS.fable), 'no model for a non-class type').toBeTruthy();
  });
});

describe('manager-resolver: layered overrides (repo > user > ladder)', () => {
  test('an override of one tier leaves the others alone', () => {
    expect(resolve('workkit:scout', MODELS.fable, config(undefined, settings({ tiers: { workhorse: 'haiku' } })))).toBe(id(FAST));
  });
  test('a repo cannot redefine the ladder or the class map', () => {
    const cfg = config(undefined, settings({ classes: { worker: 'fast' }, ladder: { opus: 'haiku' } }));
    expect(resolve('workkit:worker', MODELS.fable, cfg)).toBe(id('opus'));
  });
});
