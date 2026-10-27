// Agent roster parity: the four class agents, the ladder they must agree
// with, and the effort each one runs at.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO, 'agents');
const LADDER = path.join(REPO, 'hooks', 'manager', 'resources', 'ladder.json');

const CLASSES = ['scout', 'worker', 'verifier', 'advisor'];

// Minimal YAML frontmatter reader. Flat key: value pairs only.
const frontmatter = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert(match, `${path.basename(file)} has no frontmatter`);
  const out = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

const cases = async () => {
  const ladder = JSON.parse(fs.readFileSync(LADDER, 'utf8'));

  group('agents: the four class files');
  for (const cls of CLASSES) {
    await test(`${cls}.md exists with a matching name`, () => {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      assertEq(fm.name, cls);
      assert(fm.description && fm.description.length > 0, 'description missing');
    });
  }
  await test('frontmatter fallback models agree with the ladder (family match)', () => {
    for (const cls of CLASSES) {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      const rung = ladder.tiers[ladder.classes[cls]];
      assert(fm.model, `${cls} has no fallback model`);
      // Family-level agreement: "haiku" or "claude-haiku-4-5" both match rung
      // "haiku". Drift between the fallback and the ladder fails here.
      assert(
        fm.model === rung || fm.model.includes(rung),
        `${cls} fallback "${fm.model}" disagrees with ladder rung "${rung}"`
      );
    }
  });
  await test('effort: scout medium, worker and verifier xhigh, advisor follows the session', () => {
    assertEq(frontmatter(path.join(AGENTS_DIR, 'scout.md')).effort, 'medium');
    assertEq(frontmatter(path.join(AGENTS_DIR, 'worker.md')).effort, 'xhigh');
    assertEq(frontmatter(path.join(AGENTS_DIR, 'verifier.md')).effort, 'xhigh');
    assertEq(frontmatter(path.join(AGENTS_DIR, 'advisor.md')).effort, undefined);
  });
  await test('advisor and scout/verifier toolsets carry no Write', () => {
    for (const cls of ['scout', 'verifier', 'advisor']) {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      assert(fm.tools, `${cls} should restrict tools`);
      assert(!/\bWrite\b|\bEdit\b/.test(fm.tools), `${cls} must not carry Write/Edit`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
