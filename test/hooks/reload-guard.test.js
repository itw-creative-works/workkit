// Tests for workflow:reload-guard's logic, reloadGuardContext(stamp, fingerprint) in hooks/mods/reload-guard.js:
// the one-line notice when the kit's load-time surfaces differ from what the session stamped. What counts as a
// change, the stamp, and nagging once are test/mods/user-prompt-submit.test.ts; the events the module registers on,
// test/scripts/hooks-index.test.js.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const STAMP = 'hooks.json:3f1c|agents/worker.md:1700000000000|skills/ship/SKILL.md:1700000000000';
const CHANGED = 'hooks.json:3f1c|agents/scout.md:1700000600000|agents/worker.md:1700000000000|skills/ship/SKILL.md:1700000000000';
const say = (stamp, fingerprint) => textOf(mods('reload-guard').reloadGuardContext(stamp, fingerprint));

const cases = async () => {
  group('reload-guard: an unchanged checkout is silent');

  await test('prompt after a stamp with nothing touched: no output', () => {
    assertEq(say(STAMP, STAMP), '', 'nothing changed, nothing to say');
  });

  group('reload-guard: a change nags');

  await test('the notice is valid UserPromptSubmit context: one line naming /reload-plugins', () => {
    const out = say(STAMP, CHANGED);
    assert(out.includes('/reload-plugins'), `the change is announced, got: ${out}`);
    assert(out.includes('already live'), 'and says what does NOT need a reload');
    assertEq(out.split('\n').length, 1, 'exactly one line');
  });

  group('reload-guard.js: surfacePaths');

  await test('surfacePaths lists agents/*.md, each SKILL.md, hooks/register.js and every file under hooks/mods at any depth', async () => {
    const tree = {
      agents: [{ name: 'worker.md', kind: 'file' }, { name: 'notes.txt', kind: 'file' }],
      skills: [{ name: 'ship', kind: 'dir' }],
      'hooks/mods': [{ name: 'a.js', kind: 'file' }, { name: 'commit-gate', kind: 'dir' }],
      'hooks/mods/commit-gate': [{ name: 'checks.js', kind: 'file' }, { name: 'deep', kind: 'dir' }],
      'hooks/mods/commit-gate/deep': [{ name: 'prompt.md', kind: 'file' }],
    };
    const paths = await mods('reload-guard').surfacePaths(async (dir) => tree[dir] ?? []);
    const want = ['agents/worker.md', 'skills/ship/SKILL.md', 'hooks/register.js', 'hooks/mods/a.js',
      'hooks/mods/commit-gate/checks.js', 'hooks/mods/commit-gate/deep/prompt.md'];
    assertEq(JSON.stringify([...paths].sort()), JSON.stringify([...want].sort()), 'the surfaces, a non-.md agent file left out');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
