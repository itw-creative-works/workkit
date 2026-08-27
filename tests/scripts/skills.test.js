// Skills parity — the ten workflow skills ship here, each folder's name is the
// frontmatter name (plugin namespacing supplies the `workkit:` prefix), and
// nothing under agents/ or skills/ still points at the dotfiles they came from.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(REPO, 'skills');
const AGENTS_DIR = path.join(REPO, 'agents');

const SKILLS = ['feature', 'interview', 'diagnose', 'review', 'triage', 'status', 'checkpoint', 'migrate', 'ship', 'parallel'];

// A description is a ROUTING line — the model reads every one of them on every
// turn, so it stays one tight trigger sentence and the body carries the detail
// (issue #94).
const DESCRIPTION_CAP = 300;

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

// The DIRECTORY is the roster every check below derives from: a skill added
// tomorrow is checked the day it lands, and one removed stops being asked for.
const skillFolders = () =>
  fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

// The section of a markdown file under one heading, up to the next heading of
// the same or a higher level — the docs parity checks read one section each
// rather than the whole file, so a name mentioned in prose elsewhere cannot
// stand in for its row.
const section = (file, heading) => {
  const text = fs.readFileSync(file, 'utf8');
  const level = heading.match(/^#+/)[0].length;
  const start = text.indexOf(`\n${heading}`);
  assert(start >= 0, `${path.relative(REPO, file)} has no "${heading}" heading`);
  const rest = text.slice(start + 1 + heading.length);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next < 0 ? rest : rest.slice(0, next);
};

const run = async () => {
  group('skills: the ten folders');
  for (const name of SKILLS) {
    await test(`${name}/SKILL.md exists and its frontmatter name matches the folder`, () => {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      assert(fs.existsSync(file), `missing ${file}`);
      assertEq(frontmatterField(file, 'name'), name, `${name} frontmatter name`);
    });
  }
  await test('no extra skill folders ship', () => {
    assertEq(skillFolders().join(','), [...SKILLS].sort().join(','), 'skills/ contents');
  });

  group('skills: description cap');

  await test(`every skill's description is at most ${DESCRIPTION_CAP} characters`, () => {
    // Enumerated from the DIRECTORY, not the roster above: a skill added
    // tomorrow is under the cap the day it lands, and a folder without a
    // SKILL.md fails here rather than quietly dropping out of the check.
    const folders = skillFolders();
    assert(folders.length > 0, 'no skills found');
    const over = [];
    for (const name of folders) {
      const file = path.join(SKILLS_DIR, name, 'SKILL.md');
      assert(fs.existsSync(file), `missing ${file}`);
      const description = frontmatterField(file, 'description');
      if (description.length > DESCRIPTION_CAP) over.push(`${name} (${description.length})`);
    }
    assertEq(over.join(', '), '', `descriptions over ${DESCRIPTION_CAP} chars`);
  });

  group('skills: no `workflow:` skill names survive');
  await test('nothing under skills/ names a workflow: skill', () => {
    // `workflow:standards` is the HOOK, and keeps its name — only the
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

  group('skills: docs parity');

  // The two places a reader meets the roster — AGENTS.md's list and the
  // README's enumeration — are pinned to the FOLDERS, in both directions: a
  // twelfth skill that lands without its name fails here, and so does a name
  // left behind by a skill that went away (issue #128). AGENTS.md carries the
  // bare names rather than a table since #161 — what each one DOES lives in its
  // own SKILL.md — so the surface is every backticked plain name in the
  // section, which `workkit:<name>` and `SKILL.md` are not.
  await test("AGENTS.md's Skills section lists exactly the skill folders", () => {
    const named = [...section(path.join(REPO, 'AGENTS.md'), '## Skills').matchAll(/`([a-z-]+)`/g)]
      .map((m) => m[1])
      .sort();
    assertEq([...new Set(named)].join(','), skillFolders().join(','), "AGENTS.md's skills list");
  });

  await test("README.md's skills enumeration names exactly the skill folders", () => {
    const named = [...section(path.join(REPO, 'README.md'), '### Skills').matchAll(/`\/?workkit:([a-z-]+)`/g)]
      .map((m) => m[1]);
    assertEq([...new Set(named)].sort().join(','), skillFolders().join(','), "README.md's skills enumeration");
  });

  group('skills + agents + docs: portability');

  const shippedDocs = () => [
    ...markdownIn(path.join(REPO, 'docs')),
    path.join(REPO, 'README.md'),
    path.join(REPO, 'AGENTS.md'),
  ];

  await test('no machine-specific path appears in shipped content', () => {
    // Nothing that ships may name one machine's filesystem: an absolute
    // /Users/… path, a ~/Developer/… checkout, or the dotfiles this kit came
    // from. Generic placeholders (`<path-to-checkout>`, `<owner>`) are how an
    // example path is written instead.
    const bad = [];
    for (const file of [...markdownIn(SKILLS_DIR), ...markdownIn(AGENTS_DIR), ...shippedDocs()]) {
      const text = fs.readFileSync(file, 'utf8');
      if (/\.dotfiles\b/.test(text) || /\/Users\//.test(text) || /~\/Developer\//.test(text)) {
        bad.push(path.relative(REPO, file));
      }
    }
    assertEq(bad.join(', '), '', 'files carrying a machine-specific path');
  });

  await test('no shipped agent or skill reaches into a personal ~/.claude directory', () => {
    // The spec may POINT at the surrounding harness (`~/.claude/hooks/README.md`
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
