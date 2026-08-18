// Hooks index parity — the WIRING in hooks/hooks.json is the roster, and the two
// places a reader meets it are pinned to it in both directions: docs/hooks.md's
// index table and detail sections, and the spelled-out count in AGENTS.md
// § Hooks. A hook wired without its row, a row left behind by one that went
// away, and a nineteenth hook that lands while AGENTS.md still says eighteen all
// fail here (issue #162).
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const HOOKS_JSON = path.join(REPO, 'hooks', 'hooks.json');
const HOOKS_DOC = path.join(REPO, 'docs', 'hooks.md');
const AGENTS_DOC = path.join(REPO, 'AGENTS.md');

// The counts AGENTS.md § Hooks could plausibly spell out. The `(?!-)` in the
// lookup below is what keeps `twenty` from matching inside `twenty-five`.
const COUNT_WORDS = {
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty-one': 21, 'twenty-two': 22, 'twenty-three': 23, 'twenty-four': 24, 'twenty-five': 25,
};

// The section of a markdown file under one heading, up to the next heading of
// the same or a higher level — the parity checks read one section each rather
// than the whole file, so a name mentioned in prose elsewhere cannot stand in
// for its row.
const section = (file, heading) => {
  const text = fs.readFileSync(file, 'utf8');
  const level = heading.match(/^#+/)[0].length;
  const start = text.indexOf(`\n${heading}`);
  assert(start >= 0, `${path.relative(REPO, file)} has no "${heading}" heading`);
  const rest = text.slice(start + 1 + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
};

// The WIRING is the roster every check below derives from. Several hooks are
// wired on more than one event (`safety:capture-guard`, `workflow:reload-guard`),
// so the names dedupe.
const wiredHooks = () => {
  const wiring = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  const names = [];
  for (const entries of Object.values(wiring.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        assert(typeof hook.command === 'string', `hooks.json wires an entry with no command string: ${JSON.stringify(hook)}`);
        const match = hook.command.match(/loader\.sh (\S+)/);
        assert(match, `hooks.json wires a command that names no hook: ${hook.command}`);
        names.push(match[1]);
      }
    }
  }
  assert(names.length > 0, 'hooks.json wires no hooks');
  return [...new Set(names)].sort();
};

const run = async () => {
  group('hooks: docs/hooks.md parity');

  await test("the index table's rows are exactly the wired hooks", () => {
    const rows = [...section(HOOKS_DOC, '## The index').matchAll(/^\|\s*`([^`]+)`/gm)].map((m) => m[1]).sort();
    assertEq(rows.join(','), wiredHooks().join(','), "docs/hooks.md's index rows");
  });

  await test('the detail sections are exactly the wired hooks', () => {
    // Keyed on the BACKTICKED name, which is what keeps the file's two prose
    // headings — `## The index` and `## How they are wired` — out of the set.
    const text = fs.readFileSync(HOOKS_DOC, 'utf8');
    const headings = [...text.matchAll(/^## `([^`]+)`/gm)].map((m) => m[1]).sort();
    assertEq(headings.join(','), wiredHooks().join(','), "docs/hooks.md's detail sections");
  });

  group('hooks: AGENTS.md count');

  await test('AGENTS.md § Hooks spells out the number of wired hooks', () => {
    const text = section(AGENTS_DOC, '## Hooks');
    const word = Object.keys(COUNT_WORDS).find((w) => new RegExp(`\\b${w}\\b(?!-)`).test(text));
    assert(word, 'AGENTS.md § Hooks carries no count word this test recognises (fifteen through twenty-five)');
    assertEq(COUNT_WORDS[word], wiredHooks().length, `AGENTS.md § Hooks says "${word}"`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
