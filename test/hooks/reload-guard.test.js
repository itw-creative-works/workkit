// Tests for workflow:reload-guard's logic, reloadGuardContext(stamp, fingerprint) in hooks/mods/reload-guard.js:
// the one-line notice when the kit's load-time surfaces differ from what the session stamped. What counts as a
// change, the stamp, and nagging once are test/mods/user-prompt-submit.test.ts; the events the module registers on,
// test/scripts/hooks-index.test.js.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const STAMP = 'hooks.json:3f1c|agents/worker.md:1700000000000|skills/ship/SKILL.md:1700000000000';
const CHANGED = 'hooks.json:3f1c|agents/scout.md:1700000600000|agents/worker.md:1700000000000|skills/ship/SKILL.md:1700000000000';
const say = (stamp, fingerprint) => textOf(mods('reload-guard').reloadGuardContext(stamp, fingerprint));

describe('reload-guard: an unchanged checkout is silent', () => {
  test('prompt after a stamp with nothing touched: no output', () => {
    expect(say(STAMP, STAMP), 'nothing changed, nothing to say').toBe('');
  });
});

describe('reload-guard: a change nags', () => {
  test('the notice is valid UserPromptSubmit context: one line naming /reload-plugins', () => {
    const out = say(STAMP, CHANGED);
    expect(out.includes('/reload-plugins'), `the change is announced, got: ${out}`).toBeTruthy();
    expect(out.includes('already live'), 'and says what does NOT need a reload').toBeTruthy();
    expect(out.split('\n').length, 'exactly one line').toBe(1);
  });
});

describe('reload-guard.js: surfacePaths', () => {
  test('surfacePaths lists agents/*.md, each SKILL.md, hooks/register.js, the lexer test-bar loads, and every file under hooks/mods at any depth', async () => {
    const tree = {
      agents: [{ name: 'worker.md', kind: 'file' }, { name: 'notes.txt', kind: 'file' }],
      skills: [{ name: 'ship', kind: 'dir' }],
      'hooks/mods': [{ name: 'a.js', kind: 'file' }, { name: 'commit-gate', kind: 'dir' }],
      'hooks/mods/commit-gate': [{ name: 'checks.js', kind: 'file' }, { name: 'deep', kind: 'dir' }],
      'hooks/mods/commit-gate/deep': [{ name: 'prompt.md', kind: 'file' }],
    };
    const paths = await mods('reload-guard').surfacePaths(async (dir) => tree[dir] ?? []);
    const want = ['agents/worker.md', 'skills/ship/SKILL.md', 'hooks/register.js', 'packages/core/test/lib/lexer.js', 'hooks/mods/a.js',
      'hooks/mods/commit-gate/checks.js', 'hooks/mods/commit-gate/deep/prompt.md'];
    expect(JSON.stringify([...paths].sort()), 'the surfaces, a non-.md agent file left out').toBe(JSON.stringify([...want].sort()));
  });
});
