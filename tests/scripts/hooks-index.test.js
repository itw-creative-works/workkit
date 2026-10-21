// Hooks index parity: the wiring in hooks/hooks.json is the roster, its shell
// commands and the handlers its hooks module registers. docs/hooks.md's index
// table, detail sections and `## The hooks module` rows, the count AGENTS.md
// § Hooks spells out and README's Hooks row number are pinned to it.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { section } = require('../lib/markdown');

const REPO = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO, 'hooks', 'hooks.json');
const HOOKS_DOC = path.join(REPO, 'docs', 'hooks.md');
const AGENTS_DOC = path.join(REPO, 'AGENTS.md');
const README_DOC = path.join(REPO, 'README.md');
const MODULE_HEADING = '## The hooks module';

// The fifteen hooks the module carries, as settings named them.
const MODULE_HOOKS = [
  'docs:board-guard', 'docs:changelog-guard', 'docs:checkpoint', 'docs:session', 'docs:session-guard', 'docs:state-check',
  'manager:addon', 'manager:close-guard', 'manager:profile', 'manager:resolver', 'manager:spawn-guard',
  'safety:test-reminder', 'workflow:feature', 'workflow:reload-guard', 'workflow:standards',
];

// The shell hooks left once the module carries its fifteen.
const SHELL_COUNT = 13;

// The counts AGENTS.md § Hooks could plausibly spell out. The `(?!-)` in the
// lookup below is what keeps `twenty` from matching inside `twenty-five`.
const COUNT_WORDS = {
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25,
  'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28,
};

const wiring = () => JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));

// The shell hooks hooks.json routes through the loader. Several are wired on
// more than one event (`safety:capture-guard`), so the names dedupe.
const shellHooks = () => {
  const names = [];
  for (const entries of Object.values(wiring().hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        assert(typeof hook.command === 'string', `hooks.json wires an entry with no command string: ${JSON.stringify(hook)}`);
        const match = hook.command.match(/loader\.sh (\S+)/);
        assert(match, `hooks.json wires a command that names no hook: ${hook.command}`);
        names.push(match[1]);
      }
    }
  }
  assert(names.length > 0, 'hooks.json wires no shell hooks');
  return [...new Set(names)].sort();
};

// Every hook the kit runs: the shell ones and the module's.
const allHooks = () => [...new Set([...shellHooks(), ...MODULE_HOOKS])].sort();

// Each event the hooks module registers a handler on, read by calling its
// register with an `on` that records instead of hooking.
const moduleEvents = () => {
  const events = [];
  const on = (event) => {
    events.push(event);
    const chain = { catch: () => chain };
    return chain;
  };
  require(path.join(REPO, 'hooks', 'register.js')).register(on, {});
  assert(events.length > 0, 'hooks/register.js registers no handler');
  return [...new Set(events)].sort();
};

const run = async () => {
  group('hooks: hooks.json');

  await test('hooks.json names the hooks module under `modules`, and the file is there', () => {
    const { modules } = wiring();
    assert(Array.isArray(modules), `hooks.json carries no modules list, got: ${JSON.stringify(modules)}`);
    assertEq(modules.join(','), './register.js', 'the one module');
    assert(fs.existsSync(path.join(REPO, 'hooks', 'register.js')), 'hooks/register.js exists');
  });

  await test('the module registers on the eight events and nothing else', () => {
    const eight = [
      'agent.spawn', 'classic.PostToolUse', 'classic.PreToolUse', 'classic.SessionStart',
      'classic.Stop', 'classic.SubagentStart', 'classic.UserPromptSubmit', 'session.end',
    ];
    assertEq(moduleEvents().join(','), eight.join(','), 'the events hooks/register.js hooks');
  });

  await test('no hooks.json command names one of the fifteen, docs:session and manager:close-guard among them', () => {
    const left = shellHooks().filter((name) => MODULE_HOOKS.includes(name));
    assertEq(left.join(','), '', 'the module carries these now');
    const commands = JSON.stringify(wiring().hooks);
    for (const name of ['docs:session', 'manager:close-guard']) {
      assert(!new RegExp(`${name}(?![-\\w])`).test(commands), `no hooks.json command names ${name}`);
    }
  });

  group('hooks: docs/hooks.md parity');

  await test("the index table's rows are the shell hooks and the module's fifteen", () => {
    const rows = [...section(HOOKS_DOC, '## The index').matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]);
    const missing = shellHooks().filter((name) => !rows.includes(name));
    assertEq(missing.join(','), '', 'every shell hook has its index row');
    const stray = rows.filter((name) => !allHooks().includes(name));
    assertEq(stray.join(','), '', 'every index row is a hook the kit runs');
  });

  await test('the top-level detail sections are exactly the thirteen shell hooks', () => {
    // Keyed on the backticked name, which keeps the prose headings out of the set.
    const text = fs.readFileSync(HOOKS_DOC, 'utf8');
    const headings = [...text.matchAll(/^## `([^`]+)`/gm)].map((m) => m[1]).sort();
    assertEq(shellHooks().length, SHELL_COUNT, 'hooks.json wires the thirteen shell hooks');
    assertEq(headings.join(','), shellHooks().join(','), "docs/hooks.md's detail sections");
  });

  await test(`every handler the module registers has a row under ${MODULE_HEADING}`, () => {
    const body = section(HOOKS_DOC, MODULE_HEADING);
    assert(body.trim().length > 0, `docs/hooks.md has no ${MODULE_HEADING} section`);
    const rows = body.split('\n').filter((line) => line.startsWith('|'));
    const missing = moduleEvents().filter((event) => !rows.some((row) => row.includes(`\`${event}\``)));
    assertEq(missing.join(','), '', `the handlers with no row under ${MODULE_HEADING}`);
  });

  await test(`each of the fifteen has its entry under ${MODULE_HEADING}`, () => {
    const body = section(HOOKS_DOC, MODULE_HEADING);
    const entry = (name) => new RegExp(`^(###+ |\\|\\s*)\`${name}\``, 'm').test(body);
    const missing = MODULE_HOOKS.filter((name) => !entry(name));
    assertEq(missing.join(','), '', `the module hooks with no entry under ${MODULE_HEADING}`);
  });

  group('hooks: AGENTS.md count');

  await test('AGENTS.md § Hooks spells out the number of hooks', () => {
    const text = section(AGENTS_DOC, '## Hooks');
    const word = Object.keys(COUNT_WORDS).find((w) => new RegExp(`\\b${w}\\b(?!-)`).test(text));
    assert(word, 'AGENTS.md § Hooks carries no count word this test recognises (fifteen through twenty-eight)');
    assertEq(COUNT_WORDS[word], allHooks().length, `AGENTS.md § Hooks says "${word}"`);
  });

  group('hooks: README.md count');

  await test("README's Hooks row carries the number of hooks", () => {
    const match = fs.readFileSync(README_DOC, 'utf8').match(/^\|\s*\[Hooks\]\([^)]*\)\s*\|\s*(\d+)\s*\|/m);
    assert(match, 'README.md has no "| [Hooks](...) | <n> |" row');
    assertEq(Number(match[1]), allHooks().length, "README.md's Hooks row");
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
