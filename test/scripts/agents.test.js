// Agent roster parity: the four class agents, the ladder they must agree
// with, and the effort each one runs at.
const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO, 'agents');
const LADDER = path.join(REPO, 'hooks', 'manager', 'resources', 'ladder.json');
const DEFAULTS = path.join(REPO, 'defaults', 'settings.json');

const CLASSES = ['scout', 'worker', 'verifier', 'advisor'];

// Minimal YAML frontmatter reader. Flat key: value pairs only.
const frontmatter = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  expect(match, `${path.basename(file)} has no frontmatter`).toBeTruthy();
  const out = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
};

describe('agents: the four class files', () => {
  const ladder = JSON.parse(fs.readFileSync(LADDER, 'utf8'));
  const { tiers } = JSON.parse(fs.readFileSync(DEFAULTS, 'utf8')).manager;

  for (const cls of CLASSES) {
    test(`${cls}.md exists with a matching name`, () => {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      expect(fm.name).toBe(cls);
      expect(fm.description && fm.description.length > 0, 'description missing').toBeTruthy();
    });
  }
  test('frontmatter fallback models agree with the ladder (family match)', () => {
    for (const cls of CLASSES) {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      const rung = tiers[ladder.classes[cls]];
      expect(fm.model, `${cls} has no fallback model`).toBeTruthy();
      // Family-level agreement: "haiku" or "claude-haiku-4-5" both match rung
      // "haiku". Drift between the fallback and the ladder fails here.
      expect(
        fm.model === rung || fm.model.includes(rung),
        `${cls} fallback "${fm.model}" disagrees with ladder rung "${rung}"`
      ).toBeTruthy();
    }
  });
  test('effort: scout medium, worker and verifier xhigh, advisor follows the session', () => {
    expect(frontmatter(path.join(AGENTS_DIR, 'scout.md')).effort).toBe('medium');
    expect(frontmatter(path.join(AGENTS_DIR, 'worker.md')).effort).toBe('xhigh');
    expect(frontmatter(path.join(AGENTS_DIR, 'verifier.md')).effort).toBe('xhigh');
    expect(frontmatter(path.join(AGENTS_DIR, 'advisor.md')).effort).toBe(undefined);
  });
  test('advisor and scout/verifier toolsets carry no Write', () => {
    for (const cls of ['scout', 'verifier', 'advisor']) {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      expect(fm.tools, `${cls} should restrict tools`).toBeTruthy();
      expect(!/\bWrite\b|\bEdit\b/.test(fm.tools), `${cls} must not carry Write/Edit`).toBeTruthy();
    }
  });
});
