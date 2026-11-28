// Tests for the reusable CHANGELOG workflow (.github/workflows/changelog.yml):
// the one CI home of the entry-format check. The shape is read off the lines:
// the kit has no YAML dependency and every question here is line-shaped.

const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');
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

describe('changelog.yml: the reusable workflow', () => {
  test('it is callable and only callable: on is workflow_call alone', () => {
    const text = read(REUSABLE);
    expect(!text.includes('\t'), 'no tab indentation, which YAML rejects').toBeTruthy();
    const lines = text.split('\n');
    const on = lines.indexOf('on:');
    expect(on !== -1, `a top-level on: key, got:\n${text}`).toBeTruthy();
    const triggers = [];
    for (let i = on + 1; i < lines.length && !/^[A-Za-z_-]+:/.test(lines[i]); i++) {
      if (/^ {2}[A-Za-z_-]+:/.test(lines[i])) triggers.push(lines[i].trim());
    }
    expect(triggers.join(','), 'the one trigger is a call from another workflow').toBe('workflow_call:');
  });

  test('it checks out the kit into a subfolder and starts the kit\'s ci-changelog.js from there', () => {
    const text = read(REUSABLE);
    const repo = text.match(/^ +repository: (\S+)$/m);
    const sub = text.match(/^ +path: (\S+)$/m);
    expect(repo && sub, `a second checkout carries repository: and path:, got:\n${text}`).toBeTruthy();
    expect(text.includes(`${sub[1]}/.github/scripts/ci-changelog.js`),
      `the step starts ci-changelog.js from the kit's checkout, got:\n${text}`).toBeTruthy();
    expect(fs.existsSync(path.join(ROOT, '.github', 'scripts', 'ci-changelog.js')), 'at a path the kit really has').toBeTruthy();
    expect(/uses: actions\/checkout@v5/.test(text) && /uses: actions\/setup-node@v5/.test(text),
      'actions pinned the way the checks template pins them').toBeTruthy();
  });

  // Which flags the base ref picks is ci-changelog.js's, held in test/scripts/ci-changelog.test.js.
  test('a pull request\'s base reaches the step, and the checkout keeps its merge commit\'s first parent', () => {
    const text = read(REUSABLE);
    expect(/BASE_REF: \$\{\{ github\.base_ref \}\}/.test(text), `the base branch reaches the step, got:\n${text}`).toBeTruthy();
    expect(checkoutDepth(text), `the caller's checkout keeps the merge commit's parents, got:\n${text}`).toBe('2');
  });
});
