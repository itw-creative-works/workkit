// Hooks index parity: every hook the kit runs is the hooks module's, read from
// the module itself (the names hooks/register.js and hooks/mods/ log under).
// hooks/hooks.json names the module and nothing else, no shell hook is left
// under hooks/, and docs/hooks.md's `## The hooks module` rows and entries, its
// naming of every hooks/mods/*.js file, the count AGENTS.md § Hooks spells out
// and README's Hooks row number are pinned to the module.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');
const { section } = require('../lib/markdown');

const REPO = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO, 'hooks');
const MODS_DIR = path.join(HOOKS_DIR, 'mods');
const HOOKS_JSON = path.join(HOOKS_DIR, 'hooks.json');
const HOOKS_DOC = path.join(REPO, 'docs', 'hooks.md');
const AGENTS_DOC = path.join(REPO, 'AGENTS.md');
const README_DOC = path.join(REPO, 'README.md');
const MODULE_HEADING = '## The hooks module';

// The thirteen that ran as shell hooks before the module took them.
const MIGRATED = [
  'docs:change-tracker', 'safety:capture-guard', 'safety:commit-gate', 'safety:commit-language', 'safety:findings-guard',
  'safety:issue-guard', 'safety:proof-guard', 'safety:release-taken', 'safety:spec-guard', 'safety:suite-guard',
  'safety:tree-guard', 'safety:vendor-guard', 'workflow:snapshot',
];

// The shell homes the module retired, spelled so this file never names the loader whole.
const RETIRED = ['loader', ...['optin', 'commit', 'gh-edit', 'notice', 'proof', 'settings', 'suite'].map((n) => `lib/${n}`)]
  .map((n) => `${n}.sh`);

// A hook's name as the module logs it, `<group>:<name>` in single quotes.
const HOOK_NAME = /'((?:docs|manager|safety|workflow):[a-z-]+)'/g;

// The counts AGENTS.md § Hooks could plausibly spell out. The `(?!-)` in the
// lookup below is what keeps `twenty` from matching inside `twenty-five`.
const COUNT_WORDS = {
  twenty: 20, 'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25,
  'twenty-six': 26, 'twenty-seven': 27, 'twenty-eight': 28, 'twenty-nine': 29, thirty: 30,
  'thirty-one': 31, 'thirty-two': 32,
};

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

  await test('no run.sh anywhere under hooks/, and the loader and the seven retired lib files are gone', () => {
    const scripts = walk(HOOKS_DIR).filter((f) => path.basename(f) === 'run.sh').map((f) => path.relative(REPO, f));
    assertEq(scripts.join(','), '', 'the shell hook scripts left under hooks/');
    const left = RETIRED.filter((rel) => fs.existsSync(path.join(HOOKS_DIR, rel)));
    assertEq(left.join(','), '', 'the retired shell homes still under hooks/');
  });

  await test('the module names every hook, the thirteen former shell hooks among them', () => {
    const missing = MIGRATED.filter((name) => !moduleHooks().includes(name));
    assertEq(missing.join(','), '', 'the former shell hooks the module does not name');
  });

  group('hooks: docs/hooks.md parity');

  await test(`every handler the module registers has a row under ${MODULE_HEADING}`, () => {
    const body = section(HOOKS_DOC, MODULE_HEADING);
    assert(body.trim().length > 0, `docs/hooks.md has no ${MODULE_HEADING} section`);
    const rows = body.split('\n').filter((line) => line.startsWith('|'));
    const missing = moduleEvents().filter((event) => !rows.some((row) => row.includes(`\`${event}\``)));
    assertEq(missing.join(','), '', `the handlers with no row under ${MODULE_HEADING}`);
  });

  await test(`every hook the module names has its table row and its entry under ${MODULE_HEADING}, and nothing else does`, () => {
    const body = section(HOOKS_DOC, MODULE_HEADING);
    const rows = [...body.matchAll(/^\|\s*`([a-z]+:[a-z-]+)`/gm)].map((m) => m[1]);
    const entries = [...body.matchAll(/^###+ `([a-z]+:[a-z-]+)`/gm)].map((m) => m[1]);
    const hooks = moduleHooks();
    assertEq(hooks.filter((name) => !rows.includes(name)).join(','), '', 'the hooks with no table row');
    assertEq(hooks.filter((name) => !entries.includes(name)).join(','), '', 'the hooks with no entry');
    const stray = [...new Set([...rows, ...entries])].filter((name) => !hooks.includes(name));
    assertEq(stray.join(','), '', 'the rows and entries that name no hook the module carries');
  });

  await test('docs/hooks.md keeps no top-level shell hook section', () => {
    const headings = [...fs.readFileSync(HOOKS_DOC, 'utf8').matchAll(/^## `([^`]+)`/gm)].map((m) => m[1]);
    assertEq(headings.join(','), '', 'the top-level hook sections left');
  });

  await test('docs/hooks.md names every hooks/mods/*.js file', () => {
    const text = fs.readFileSync(HOOKS_DOC, 'utf8');
    const files = fs.readdirSync(MODS_DIR).filter((f) => f.endsWith('.js'));
    assert(files.length > 0, 'hooks/mods/ holds no module file');
    const unnamed = files.filter((f) => !text.includes(`mods/${f}`));
    assertEq(unnamed.join(','), '', 'the hooks/mods/ files docs/hooks.md never names');
  });

  group('hooks: AGENTS.md and README.md counts');

  await test('AGENTS.md § Hooks spells out the number of hooks', () => {
    const text = section(AGENTS_DOC, '## Hooks');
    const word = Object.keys(COUNT_WORDS).find((w) => new RegExp(`\\b${w}\\b(?!-)`).test(text));
    assert(word, 'AGENTS.md § Hooks carries no count word this test recognises (twenty through thirty-two)');
    assertEq(COUNT_WORDS[word], moduleHooks().length, `AGENTS.md § Hooks says "${word}"`);
  });

  await test("README's Hooks row carries the number of hooks", () => {
    const match = fs.readFileSync(README_DOC, 'utf8').match(/^\|\s*\[Hooks\]\([^)]*\)\s*\|\s*(\d+)\s*\|/m);
    assert(match, 'README.md has no "| [Hooks](...) | <n> |" row');
    assertEq(Number(match[1]), moduleHooks().length, "README.md's Hooks row");
  });

  group('hooks: the loader is named nowhere');

  await test('no .sh, .js or .md file in the kit names the loader script, CHANGELOG.md aside', () => {
    // The kit's files are git's tracked and unignored ones that exist, so the
    // gitignored session state is no hit. Spelled in two halves so this file is not its own.
    const needle = ['loader', 'sh'].join('.');
    const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: REPO, encoding: 'utf8' });
    assertEq(listed.status, 0, `git lists the kit's files, stderr: ${listed.stderr}`);
    const hits = [...new Set(listed.stdout.split('\n').filter(Boolean))]
      .filter((rel) => /\.(sh|js|md)$/.test(rel) && path.basename(rel) !== 'CHANGELOG.md')
      .map((rel) => path.join(REPO, rel))
      .filter((f) => fs.existsSync(f))
      .filter((f) => fs.readFileSync(f, 'utf8').includes(needle))
      .map((f) => path.relative(REPO, f));
    assertEq(hits.join(', '), '', 'the files still naming it');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
