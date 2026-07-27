// Skills parity — the nine workflow skills ship here, each folder's name is the
// frontmatter name (plugin namespacing supplies the `workkit:` prefix), and
// nothing under agents/ or skills/ still points at the dotfiles they came from.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(REPO, 'skills');
const AGENTS_DIR = path.join(REPO, 'agents');

const SKILLS = ['feature', 'grill', 'diagnose', 'review', 'simplify', 'triage', 'whats-next', 'migrate', 'ship'];

const frontmatterName = (file) => {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert(match, `${file} has no frontmatter`);
  const name = match[1].match(/^name:\s*(.+)$/m);
  assert(name, `${file} frontmatter has no name`);
  return name[1].trim();
};

const markdownIn = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath || e.path, e.name));

const run = async () => {
  group('skills: the nine folders');
  for (const name of SKILLS) {
    await test(`${name}/SKILL.md exists and its frontmatter name matches the folder`, () => {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      assert(fs.existsSync(file), `missing ${file}`);
      assertEq(frontmatterName(file), name, `${name} frontmatter name`);
    });
  }
  await test('no extra skill folders ship', () => {
    const found = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    assertEq(found.join(','), [...SKILLS].sort().join(','), 'skills/ contents');
  });

  group('skills: no `workflow:` skill names survive');
  await test('nothing under skills/ names a workflow: skill', () => {
    // `workflow:standards` is the HOOK, and keeps its name — only the nine
    // SKILL names moved to the workkit: prefix.
    const bad = [];
    for (const file of markdownIn(SKILLS_DIR)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const name of SKILLS) {
        if (text.includes(`workflow:${name}`)) bad.push(`${path.relative(REPO, file)} → workflow:${name}`);
      }
    }
    assertEq(bad.join('; '), '', 'stale skill names');
  });

  group('skills + agents: portability');
  await test('no dotfiles-absolute path appears in a shipped agent or skill', () => {
    const bad = [];
    for (const dir of [SKILLS_DIR, AGENTS_DIR]) {
      for (const file of markdownIn(dir)) {
        const text = fs.readFileSync(file, 'utf8');
        if (/\.dotfiles\b/.test(text) || /~\/\.claude\/(agents|skills|hooks)\b/.test(text)
          || /Ian-Wiedenman/.test(text) || /~\/Developer\/Repositories\//.test(text)) {
          bad.push(path.relative(REPO, file));
        }
      }
    }
    assertEq(bad.join(', '), '', 'files carrying a dotfiles path');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
