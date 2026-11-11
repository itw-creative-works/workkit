// Tests for the reusable CHANGELOG workflow (.github/workflows/changelog.yml):
// the one CI home of the entry-format check. The shape is read off the lines:
// the kit has no YAML dependency and every question here is line-shaped.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { childrenOf, block, listItems } = require('../lib/workflow-yaml');

const ROOT = path.join(__dirname, '..', '..');
const REUSABLE = path.join(ROOT, '.github', 'workflows', 'changelog.yml');

const read = (file) => fs.readFileSync(file, 'utf8');

// A step's `with:` keys and their values, the lines indented under `with:`.
const withOf = (lines) => {
  const at = lines.findIndex((l) => /^ *with:\s*$/.test(l));
  if (at === -1) return {};
  const keys = {};
  for (const line of childrenOf(lines, at)) {
    const m = line.match(/^ *([\w-]+):\s*(.*)$/);
    if (m) keys[m[1]] = m[2];
  }
  return keys;
};

// The fetch-depth in the `with:` of the caller's own checkout (the
// actions/checkout step naming no other repository), or null. The steps are
// the one job's, its `steps:` block at the job's key indent.
const checkoutDepth = (text) => {
  const own = listItems(block(text.split('\n'), 'steps', 4)).find((lines) => lines.some((l) => /^ *(- )?uses: actions\/checkout@/.test(l))
    && !('repository' in withOf(lines)));
  return (own && withOf(own)['fetch-depth']) ?? null;
};

const cases = async () => {
  group('changelog.yml: the reusable workflow');

  await test('it is callable and only callable: on is workflow_call alone', () => {
    const text = read(REUSABLE);
    assert(!text.includes('\t'), 'no tab indentation, which YAML rejects');
    const lines = text.split('\n');
    const on = lines.indexOf('on:');
    assert(on !== -1, `a top-level on: key, got:\n${text}`);
    const triggers = [];
    for (let i = on + 1; i < lines.length && !/^[A-Za-z_-]+:/.test(lines[i]); i++) {
      if (/^ {2}[A-Za-z_-]+:/.test(lines[i])) triggers.push(lines[i].trim());
    }
    assertEq(triggers.join(','), 'workflow_call:', 'the one trigger is a call from another workflow');
  });

  await test('it checks out the kit into a subfolder and lints the caller from there', () => {
    const text = read(REUSABLE);
    const repo = text.match(/^ +repository: (\S+)$/m);
    const sub = text.match(/^ +path: (\S+)$/m);
    assert(repo && sub, `a second checkout carries repository: and path:, got:\n${text}`);
    assert(text.includes(`node ${sub[1]}/workflow/changelog/lint.js CHANGELOG.md --unreleased-only`),
      `the linter runs from the kit's checkout over the caller's unreleased section, got:\n${text}`);
    assert(fs.existsSync(path.join(ROOT, 'workflow', 'changelog', 'lint.js')), 'at a path the kit really has');
    assert(text.includes('no CHANGELOG.md, nothing to check'), 'a caller with no CHANGELOG passes with a message');
    assert(/uses: actions\/checkout@v5/.test(text) && /uses: actions\/setup-node@v5/.test(text),
      'actions pinned the way the checks template pins them');
  });

  await test('a pull request judges the entries it adds against its merge commit\'s first parent', () => {
    const text = read(REUSABLE);
    assert(/BASE_REF: \$\{\{ github\.base_ref \}\}/.test(text), `the base branch reaches the step, got:\n${text}`);
    assertEq(checkoutDepth(text), '2', `the caller's checkout keeps the merge commit's parents, got:\n${text}`);
    assert(/lint\.js CHANGELOG\.md --added-only --base=HEAD\^1/.test(text), `and the linter compares against the first, got:\n${text}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(module.exports);
