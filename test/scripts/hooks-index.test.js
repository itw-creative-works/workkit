// Hooks index parity: every hook the kit runs is the hooks module's, read from
// the module itself (the names hooks/register.js and hooks/mods/ log under).
// hooks/hooks.json names the module and nothing else, and the module registers
// on the ten events.
const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO, 'hooks');
const MODS_DIR = path.join(HOOKS_DIR, 'mods');
const HOOKS_JSON = path.join(HOOKS_DIR, 'hooks.json');

// The former shell hooks the module runs; the gh and commit guards run in the
// gh shim's gate and git's own hooks, tree-guard in the git shim.
const MIGRATED = ['docs:change-tracker', 'safety:capture-guard', 'safety:vendor-guard', 'workflow:snapshot'];

// A hook's name as the module logs it, `<group>:<name>` in single quotes.
const HOOK_NAME = /'((?:docs|manager|safety|workflow):[a-z-]+)'/g;

const wiring = () => JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

// docs/hooks.md's counts, spelled as words or digits.
const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const NUMBER = '([0-9]+|[A-Za-z]+(?:-[a-z]+)?)';
const numberOf = (word) => {
  if (/^[0-9]+$/.test(word)) return Number(word);
  const [tens, unit] = word.toLowerCase().split('-');
  if (UNITS.includes(tens)) return UNITS.indexOf(tens);
  expect(tens in TENS && (unit === undefined || UNITS.indexOf(unit) > 0), `a count docs/hooks.md spells as a number: ${word}`).toBeTruthy();
  return TENS[tens] + (unit === undefined ? 0 : UNITS.indexOf(unit));
};

/** Every file under `dir`, recursively, node_modules left out. */
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name === '.git') return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : [full];
});

// Every hook the kit runs: the names the module's files log under.
const moduleHooks = () => {
  const files = [path.join(HOOKS_DIR, 'register.js'), ...walk(MODS_DIR).filter((f) => f.endsWith('.js'))];
  const names = files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(HOOK_NAME)].map((m) => m[1]));
  expect(names.length > 0, 'the hooks module names no hook').toBeTruthy();
  return [...new Set(names)].sort();
};

// Each event the hooks module registers a handler on, read by calling its
// register with an `on` that records instead of hooking.
const moduleEvents = () => {
  const events = [];
  const on = (event) => {
    events.push(event);
    const chain = { catch: () => chain };
    return chain;
  };
  require(path.join(HOOKS_DIR, 'register.js')).register(on, {});
  expect(events.length > 0, 'hooks/register.js registers no handler').toBeTruthy();
  return [...new Set(events)].sort();
};

describe('hooks: hooks.json and the hooks folder', () => {
  test('hooks.json holds only `modules`, naming ./register.js, and the file is there', () => {
    const json = wiring();
    expect(Object.keys(json).join(','), 'the one key').toBe('modules');
    expect(Array.isArray(json.modules), `modules is a list, got: ${JSON.stringify(json.modules)}`).toBeTruthy();
    expect(json.modules.join(','), 'the one module').toBe('./register.js');
    expect(fs.existsSync(path.join(HOOKS_DIR, 'register.js')), 'hooks/register.js exists').toBeTruthy();
  });

  test('the module registers on the ten events and nothing else', () => {
    const ten = [
      'agent.spawn', 'classic.PostToolUse', 'classic.PostToolUseFailure', 'classic.PreToolUse', 'classic.SessionStart',
      'classic.Stop', 'classic.SubagentStart', 'classic.UserPromptSubmit', 'session.end', 'tool.call',
    ];
    expect(moduleEvents().join(','), 'the events hooks/register.js hooks').toBe(ten.join(','));
  });

  test('docs/hooks.md\'s counts match the code: its in-process count is the hooks the module names, and the whole is that plus the guards outside', () => {
    const doc = fs.readFileSync(path.join(REPO, 'docs', 'hooks.md'), 'utf8');
    const totals = [...doc.matchAll(new RegExp(`Of the ${NUMBER} hooks, ${NUMBER} run`, 'gi'))].map((m) => [numberOf(m[1]), numberOf(m[2])]);
    const outside = [...doc.matchAll(new RegExp(`^\\s*-?\\s*${NUMBER} guards run in the`, 'gim'))].map((m) => numberOf(m[1]));
    expect(totals.length > 0, 'docs/hooks.md states its hook counts').toBeTruthy();
    expect(outside.length > 0, 'docs/hooks.md states how many guards run outside the module').toBeTruthy();
    const inProcess = moduleHooks().length;
    for (const [whole, inside] of totals) {
      expect(inside, 'the in-process count against the hooks the module names').toBe(inProcess);
      for (const n of outside) expect(whole, 'the whole count against in-process plus the guards outside').toBe(inside + n);
    }
  });

  test('the module names every hook, the four former shell hooks it still runs among them', () => {
    const missing = MIGRATED.filter((name) => !moduleHooks().includes(name));
    expect(missing.join(','), 'the former shell hooks the module does not name').toBe('');
  });
});
