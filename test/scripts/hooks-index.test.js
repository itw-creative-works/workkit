// Hooks index parity: every hook the kit runs is the hooks module's, read from
// the module itself (the names hooks/register.js and hooks/mods/ log under).
// hooks/hooks.json names the module and nothing else, and the module registers
// on the nine events.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO, 'hooks');
const MODS_DIR = path.join(HOOKS_DIR, 'mods');
const HOOKS_JSON = path.join(HOOKS_DIR, 'hooks.json');

// The thirteen that ran as shell hooks before the module took them.
const MIGRATED = [
  'docs:change-tracker', 'safety:capture-guard', 'safety:commit-gate', 'safety:commit-language', 'safety:findings-guard',
  'safety:issue-guard', 'safety:proof-guard', 'safety:release-taken', 'safety:spec-guard', 'safety:suite-guard',
  'safety:tree-guard', 'safety:vendor-guard', 'workflow:snapshot',
];

// A hook's name as the module logs it, `<group>:<name>` in single quotes.
const HOOK_NAME = /'((?:docs|manager|safety|workflow):[a-z-]+)'/g;

const wiring = () => JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

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
  assert(names.length > 0, 'the hooks module names no hook');
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
  assert(events.length > 0, 'hooks/register.js registers no handler');
  return [...new Set(events)].sort();
};

const run = async () => {
  group('hooks: hooks.json and the hooks folder');

  await test('hooks.json holds only `modules`, naming ./register.js, and the file is there', () => {
    const json = wiring();
    assertEq(Object.keys(json).join(','), 'modules', 'the one key');
    assert(Array.isArray(json.modules), `modules is a list, got: ${JSON.stringify(json.modules)}`);
    assertEq(json.modules.join(','), './register.js', 'the one module');
    assert(fs.existsSync(path.join(HOOKS_DIR, 'register.js')), 'hooks/register.js exists');
  });

  await test('the module registers on the nine events and nothing else', () => {
    const nine = [
      'agent.spawn', 'classic.PostToolUse', 'classic.PreToolUse', 'classic.SessionStart',
      'classic.Stop', 'classic.SubagentStart', 'classic.UserPromptSubmit', 'session.end', 'tool.call',
    ];
    assertEq(moduleEvents().join(','), nine.join(','), 'the events hooks/register.js hooks');
  });

  await test('the module names every hook, the thirteen former shell hooks among them', () => {
    const missing = MIGRATED.filter((name) => !moduleHooks().includes(name));
    assertEq(missing.join(','), '', 'the former shell hooks the module does not name');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
