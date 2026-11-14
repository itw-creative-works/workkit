// Skills parity: the nine workflow skills ship here, each folder's name is the
// frontmatter name (plugin namespacing supplies the `workkit:` prefix), and
// nothing that ships still points at the dotfiles they came from.
const path = require('path');
const fs = require('fs');
const { describe, test, expect } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(REPO, 'skills');
const AGENTS_DIR = path.join(REPO, 'agents');
const BRIEFS_DIR = path.join(REPO, 'briefs');

const SKILLS = ['feature', 'interview', 'diagnose', 'review', 'triage', 'status', 'checkpoint', 'migrate', 'ship'];

const frontmatterField = (file, field) => {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  expect(match, `${file} has no frontmatter`).toBeTruthy();
  const value = match[1].match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  expect(value, `${file} frontmatter has no ${field}`).toBeTruthy();
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

describe('skills: the nine folders', () => {
  for (const name of SKILLS) {
    test(`${name}/SKILL.md exists and its frontmatter name matches the folder`, () => {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      expect(fs.existsSync(file), `missing ${file}`).toBeTruthy();
      expect(frontmatterField(file, 'name'), `${name} frontmatter name`).toBe(name);
    });
  }
});

describe('skills: frontmatter is strict YAML', () => {
  test('no plain frontmatter scalar carries a bare `: `, ` #`, or an opening `[` or `{`', () => {
    // A strict loader refuses a plain (unquoted) scalar holding `: ` or ` #`
    // and reads one opening with `[` or `{` as a list or a map. Claude Code
    // tolerates all of it, so the drift is invisible in use; checked here
    // without a YAML dependency, on every folder.
    const bad = [];
    for (const name of skillFolders()) {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      const block = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
      expect(block, `${file} has no frontmatter`).toBeTruthy();
      for (const line of block[1].split('\n')) {
        const field = line.match(/^([\w-]+):\s*(.*)$/);
        if (!field) continue;
        const value = field[2];
        if (/^["']/.test(value)) continue;
        if (/^[[{]/.test(value) || value.includes(': ') || value.includes(' #')) bad.push(`${name} ${field[1]}`);
      }
    }
    expect(bad.join(', '), 'plain scalars a strict YAML loader refuses').toBe('');
  });
});

describe('skills + agents + docs: portability', () => {
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

  test('no machine-specific path appears in shipped content', () => {
    const bad = portable().filter((file) => machineSpecific(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO, file));
    expect(bad.join(', '), 'files carrying a machine-specific path').toBe('');
  });

  test('no shipped agent or skill reaches into a personal ~/.claude directory', () => {
    // The spec may point at the surrounding harness (`~/.claude/hooks/README.md`
    // is a real neighbouring document); an agent or a skill, which runs
    // anywhere, may not depend on one.
    const bad = [];
    for (const file of [...markdownIn(SKILLS_DIR), ...markdownIn(AGENTS_DIR)]) {
      const text = fs.readFileSync(file, 'utf8');
      if (/~\/\.claude\/(agents|skills|hooks)\b/.test(text)) bad.push(path.relative(REPO, file));
    }
    expect(bad.join(', '), 'files reaching into a personal ~/.claude directory').toBe('');
  });
});
