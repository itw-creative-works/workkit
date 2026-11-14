// Tests for manager:profile's logic, profileContext(config, model) in hooks/mods/profile.js over
// managerConfig(ladder, settings) in hooks/mods/manager.js: the manager standing instruction,
// injected only in manager-capable sessions (frontier or workhorse tier, or unknown). The session model's source
// ($.session.model()), the gate and HOOK_DISABLE are test/mods/user-prompt-submit.test.ts.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');
const { mods, textOf, mergedSettings } = require('../lib/mods-inputs');

const REPO = path.join(__dirname, '..', '..');
const LADDER = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'manager', 'resources', 'ladder.json'), 'utf8'));
const MODELS = { fable: 'claude-fable-5[1m]', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-5', haiku: 'claude-haiku-4-5' };

const config = (user, repo, ladder = LADDER) => mods('manager').managerConfig(ladder, mergedSettings({ user, repo }));
const ctxFor = (model, cfg = config()) => textOf(mods('profile').profileContext(cfg, model));
const settings = (manager) => ({ enabled: true, manager });

describe('manager-profile: injection by session tier', () => {
  test('frontier session injects the profile with the advisor-redundant clause', () => {
    const ctx = ctxFor(MODELS.fable);
    expect(ctx.includes('MANAGER'), 'no MANAGER block').toBeTruthy();
    expect(ctx.includes('never pass a model param'), 'missing the resolver rule').toBeTruthy();
    expect(ctx.includes('redundant'), 'frontier session should get the redundant clause').toBeTruthy();
    expect(!ctx.includes('Consult the workkit:advisor'), 'frontier session must not be told to consult').toBeTruthy();
    expect(ctx.includes('workkit:scout') && ctx.includes('workkit:worker') && ctx.includes('workkit:verifier'), 'crew names must be plugin-namespaced').toBeTruthy();
    expect(!ctx.includes('agents/README.md'), 'no personal-tree citation').toBeTruthy();
    expect(ctx.includes('write the brief to a file'), 'handoff convention inlined').toBeTruthy();
    expect(ctx.includes('chat summary, never a file'), 'brief files gated on an actual dispatch').toBeTruthy();
  });
  test('workhorse session injects with the consult clause', () => {
    const ctx = ctxFor(MODELS.opus);
    expect(ctx.includes('Consult the workkit:advisor'), 'workhorse session should consult the advisor').toBeTruthy();
    expect(!ctx.includes('redundant'), 'workhorse session must not get the redundant clause').toBeTruthy();
  });
  test('unknown session injects (default-frontier rationale)', () => {
    expect(ctxFor('').includes('MANAGER'), 'an unknown tier still injects').toBeTruthy();
  });
  for (const rung of ['sonnet', 'haiku']) {
    test(`${rung} session is solo: no output at all`, () => {
      expect(ctxFor(MODELS[rung]), 'solo').toBe('');
    });
  }
});

describe('manager-profile: the injection is the delegation core only', () => {
  test('the injection stays under 1800 characters on both rungs', () => {
    for (const rung of ['fable', 'opus']) {
      const ctx = ctxFor(MODELS[rung]);
      expect(ctx.length < 1800, `${rung} injection is ${ctx.length} chars`).toBeTruthy();
    }
  });
  test('the watching clause names docs/agents.md § Watching a run on both rungs', () => {
    const clause = 'docs/agents.md § Watching a run';
    expect(ctxFor(MODELS.fable).includes(clause), 'frontier session lacks the watching clause').toBeTruthy();
    expect(ctxFor(MODELS.opus).includes(clause), 'workhorse session lacks the watching clause').toBeTruthy();
  });
  test('the one-time clause follows the findings sentence on both rungs', () => {
    const clause = 'findings.file is on. A one-time problem';
    expect(ctxFor(MODELS.fable).includes(clause), 'frontier session lacks the one-time clause').toBeTruthy();
    expect(ctxFor(MODELS.opus).includes(clause), 'workhorse session lacks the one-time clause').toBeTruthy();
  });
});

describe('manager-profile: layered overrides (repo > user > ladder)', () => {
  test('enabled: false silences a frontier session', () => {
    expect(ctxFor(MODELS.fable, config(undefined, settings({ enabled: false }))), 'silenced').toBe('');
  });
  test('a repo workhorse override makes a sonnet session manager-capable', () => {
    const ctx = ctxFor(MODELS.sonnet, config(undefined, settings({ tiers: { workhorse: 'sonnet' } })));
    expect(ctx.includes('MANAGER'), 'the overridden workhorse tier should inject').toBeTruthy();
    expect(ctx.includes('Consult the workkit:advisor'), 'a workhorse session should consult the advisor').toBeTruthy();
  });
  test('a user-layer frontier override drives the advisor clause', () => {
    const user = { version: 1, repos: {}, manager: { tiers: { frontier: 'opus' } } };
    expect(ctxFor(MODELS.opus, config(user, undefined)).includes('redundant'), 'an opus session under a frontier: opus override IS the advisor').toBeTruthy();
  });
  test('a repo without a manager block changes nothing', () => {
    expect(ctxFor(MODELS.fable, config(undefined, { version: 1, enabled: false })).includes('MANAGER'), 'the workflow key is not the manager key').toBeTruthy();
  });
});

describe('manager-profile: robustness', () => {
  test('missing ladder still injects, the tiers coming from the kit defaults', () => {
    expect(ctxFor(MODELS.fable, config(undefined, undefined, null)).includes('MANAGER'), 'the defaults\' tier names').toBeTruthy();
  });
});
