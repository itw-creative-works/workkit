// Skills parity: the nine workflow skills ship here, each folder's name is the
// frontmatter name (plugin namespacing supplies the `workkit:` prefix), and
// nothing that ships still points at the dotfiles they came from.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(REPO, 'skills');
const AGENTS_DIR = path.join(REPO, 'agents');
const BRIEFS_DIR = path.join(REPO, 'briefs');

const SKILLS = ['feature', 'interview', 'diagnose', 'review', 'triage', 'status', 'checkpoint', 'migrate', 'ship'];

const frontmatterField = (file, field) => {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert(match, `${file} has no frontmatter`);
  const value = match[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  assert(value, `${file} frontmatter has no ${field}`);
  return value[1].trim();
};

const markdownIn = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath || e.path, e.name));

// The directory is the roster every check below derives from: a skill added
// tomorrow is checked the day it lands, and one removed stops being asked for.
const skillFolders = () =>
  fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

const run = async () => {
  group('skills: the nine folders');
  for (const name of SKILLS) {
    await test(`${name}/SKILL.md exists and its frontmatter name matches the folder`, () => {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      assert(fs.existsSync(file), `missing ${file}`);
      assertEq(frontmatterField(file, 'name'), name, `${name} frontmatter name`);
    });
  }

  group('skills: frontmatter is strict YAML');

  await test('no plain frontmatter scalar carries a bare `: `, ` #`, or an opening `[` or `{`', () => {
    // A strict loader refuses a plain (unquoted) scalar holding `: ` or ` #`
    // and reads one opening with `[` or `{` as a list or a map. Claude Code
    // tolerates all of it, so the drift is invisible in use; checked here
    // without a YAML dependency, on every folder.
    const bad = [];
    for (const name of skillFolders()) {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      const block = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
      assert(block, `${file} has no frontmatter`);
      for (const line of block[1].split('\n')) {
        const field = line.match(/^([\w-]+):\s*(.*)$/);
        if (!field) continue;
        const value = field[2];
        if (/^["']/.test(value)) continue;
        if (/^[[{]/.test(value) || value.includes(': ') || value.includes(' #')) bad.push(`${name} ${field[1]}`);
      }
    }
    assertEq(bad.join(', '), '', 'plain scalars a strict YAML loader refuses');
  });

  group('skills + agents + docs: portability');

  const shippedDocs = () => [
    ...markdownIn(path.join(REPO, 'docs')),
    path.join(REPO, 'README.md'),
    path.join(REPO, 'AGENTS.md'),
  ];

  // The README beside every hook, and the engine's, the jobs' and the dashboard's.
  const shippedReadmes = () => [
    ...markdownIn(path.join(REPO, 'hooks')).filter((file) => path.basename(file) === 'README.md'),
    ...['workflow', 'jobs', 'tower'].map((dir) => path.join(REPO, dir, 'README.md')),
  ];
  const portable = () => [
    ...markdownIn(SKILLS_DIR), ...markdownIn(AGENTS_DIR), ...markdownIn(BRIEFS_DIR), ...shippedDocs(), ...shippedReadmes(),
  ];

  // Nothing that ships may name one machine's filesystem or the owner's own
  // repo: an absolute /Users/… path, a ~/Developer/… checkout, or the dotfiles
  // this kit came from. Generic placeholders (`<path-to-checkout>`, `<owner>`)
  // are how an example path is written instead.
  const MACHINE_SPECIFIC = [/\.dotfiles\b/, /(?<![A-Za-z]:|\/[a-z])\/Users\//, /~\/Developer\//, /\bthe dotfiles repo\b/i];
  const machineSpecific = (text) => MACHINE_SPECIFIC.some((pattern) => pattern.test(text));

  await test('no machine-specific path appears in shipped content', () => {
    const bad = portable().filter((file) => machineSpecific(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file));
    assertEq(bad.join(', '), '', 'files carrying a machine-specific path');
  });

  await test('no shipped agent or skill reaches into a personal ~/.claude directory', () => {
    // The spec may point at the surrounding harness (`~/.claude/hooks/README.md`
    // is a real neighbouring document); an agent or a skill, which runs
    // anywhere, may not depend on one.
    const bad = [];
    for (const file of [...markdownIn(SKILLS_DIR), ...markdownIn(AGENTS_DIR)]) {
      const text = fs.readFileSync(file, 'utf8');
      if (/~\/\.claude\/(agents|skills|hooks)\b/.test(text)) bad.push(path.relative(REPO, file));
    }
    assertEq(bad.join(', '), '', 'files reaching into a personal ~/.claude directory');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
