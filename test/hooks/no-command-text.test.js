// The lock that keeps every guard off a Bash command's text: the facts bashFacts (hooks/mods/facts.js) builds
// for a guard carry the command nowhere, whatever the call hands it. Every guard on both Bash chains is run as a
// spy over an unmistakable command, and no value its facts hold, at any depth, is or contains that text. The
// hooks module's own side (what it runs, writes and logs for such a call) is test/mods/no-command-text.test.ts.

const { describe, test, expect } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

// A command text no fact could hold by chance, spelled as the old readers would have acted on it.
const UNMISTAKABLE = "printf 'zq7731-no-guard-reads-this' && git reset --hard && sed -i s/a/b/ x && npm publish";
const MARK = 'zq7731-no-guard-reads-this';

// An io over one opted-in repo at /r, every run answered empty.
const read = async (p) => (p === '/r/.workkit/settings.json' ? OPT_IN_SHAPES.current : null);
const io = { pluginRoot: '/kit', top: async () => '/r', read, run: async () => null, stat: async () => null, now: () => 0 };

/** Every path under `value` whose string holds MARK, as `a.b[2]`; functions are code, not facts, and are passed over. */
const holding = (value, at = 'facts', seen = new Set()) => {
  if (typeof value === 'string') return value.includes(MARK) ? [at] : [];
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return entries.flatMap(([k, v]) => [...holding(k, `${at}{key}`, seen), ...holding(v, `${at}.${k}`, seen)]);
};

describe('no-command-text: the facts a guard gets', () => {
  test('bashFacts handed a command holds it in no value at any depth', () => {
    const facts = mods('facts').bashFacts(io, {}, { command: UNMISTAKABLE, cwd: '/r', background: false, namesCapture: false });
    expect(facts && typeof facts === 'object', 'facts are built').toBeTruthy();
    expect(JSON.stringify(holding(facts)), 'the paths that hold the command').toBe('[]');
  });

  test('every guard on the Bash chains, run as a spy over the command, gets facts that hold it nowhere', async () => {
    const { BASH_GUARDS, POST_BASH_GUARDS, runChain } = mods('guards');
    const found = [];
    const ran = [];
    const spies = (guards) => guards.map(({ hook }) => ({
      hook,
      run: async (facts) => { ran.push(hook); found.push(...holding(facts).map((p) => `${hook}: ${p}`)); return null; },
    }));
    for (const [guards, call] of [
      [BASH_GUARDS, { command: UNMISTAKABLE, cwd: '/r', background: false, namesCapture: false }],
      [POST_BASH_GUARDS, { command: UNMISTAKABLE, cwd: '/r', background: false, since: 0, roots: ['/r'] }],
    ]) {
      await runChain(io, {}, spies(guards), call);
    }
    expect(ran.length, `each guard ran, got: ${ran.join(', ')}`).toBe(BASH_GUARDS.length + POST_BASH_GUARDS.length);
    expect(JSON.stringify(found), 'the guards and paths that held the command').toBe('[]');
  });
});
