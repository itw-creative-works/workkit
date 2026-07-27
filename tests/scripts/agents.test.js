// Agent roster parity — the four class agents, the ladder they must agree
// with, the README roster, and the review skill's re-route.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO, 'agents');
const LADDER = path.join(REPO, 'hooks', 'manager', 'ladder.json');
const README = path.join(REPO, 'docs', 'agents.md');
const SKILL = path.join(REPO, 'skills', 'review', 'SKILL.md');

const CLASSES = ['scout', 'worker', 'verifier', 'advisor'];

// Minimal YAML frontmatter reader — flat key: value pairs only.
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

const run = async () => {
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
  await test('verifier runs at effort high; scout at effort low', () => {
    assertEq(frontmatter(path.join(AGENTS_DIR, 'verifier.md')).effort, 'high');
    assertEq(frontmatter(path.join(AGENTS_DIR, 'scout.md')).effort, 'low');
  });
  await test('advisor and scout/verifier toolsets carry no Write', () => {
    for (const cls of ['scout', 'verifier', 'advisor']) {
      const fm = frontmatter(path.join(AGENTS_DIR, `${cls}.md`));
      assert(fm.tools, `${cls} should restrict tools`);
      assert(!/\bWrite\b|\bEdit\b/.test(fm.tools), `${cls} must not carry Write/Edit`);
    }
  });
  await test('every class file names the resolver as the model authority', () => {
    for (const cls of CLASSES) {
      const text = fs.readFileSync(path.join(AGENTS_DIR, `${cls}.md`), 'utf8');
      assert(text.includes('manager/resolver'), `${cls}.md does not name the resolver`);
    }
  });
  await test('every agent file inlines its handoff rules instead of pointing at a personal path', () => {
    for (const file of fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
      assert(text.includes('Never spawn subagents.'), `${file} does not state the no-subagents rule`);
      assert(/report path/.test(text), `${file} does not state the report-path rule`);
    }
  });

  group('agents: README roster parity');
  await test('roster carries a row for each class + reviewer', () => {
    const readme = fs.readFileSync(README, 'utf8');
    for (const name of [...CLASSES, 'reviewer']) {
      assert(new RegExp(`\\|\\s*\`workkit:${name}\``).test(readme), `roster row missing: ${name}`);
    }
  });
  await test('README documents the Classes contract', () => {
    const readme = fs.readFileSync(README, 'utf8');
    assert(readme.includes('manager/resolver'), 'Classes section must name the resolver');
    assert(readme.includes('ladder.json'), 'Classes section must name the ladder');
  });

  group('agents: review skill re-route');
  await test('SKILL.md routes lenses to the scout and scoring to the verifier', () => {
    const skill = fs.readFileSync(SKILL, 'utf8');
    assert(skill.includes('`workkit:scout` agent'), 'lens table should name the scout');
    assert(skill.includes('`workkit:verifier` agent'), 'scorer/light tier should name the verifier');
    assert(!skill.includes('general subagent'), 'no lens should remain on "general subagent"');
    assert(skill.includes('never pass a `model` param'), 'the resolver rule note is missing');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
