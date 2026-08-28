// Agent-definition lint — the mechanically checkable half of the "no
// machine-specific paths" rule (docs/agents.md § Defining an agent, and the
// AGENTS.md Conventions section, which extends the same rule to everything
// under hooks/, agents/ and skills/). These files ship to any repo on any
// machine, so one absolute path is a broken install somewhere else.
//
// The OTHER agent-file rules stay JUDGMENT and are deliberately not linted
// here — an agent file carrying knowledge content instead of pointing at the
// live repo docs is a review call, and its home is docs/agents.md.
//
// Scope note: tests/scripts/skills.test.js already refuses `/Users/`,
// `~/Developer/` and `.dotfiles` across skills, agents and the shipped docs.
// This suite is the line-level lens on the same convention — it names the
// offending file AND line, adds the forms that check missed (`/home/`, a
// Windows drive letter), and is the only one that walks hooks/.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO, 'agents');

// The portable idioms — `~/…` (every install has a home directory) and
// `${CLAUDE_PLUGIN_ROOT}/…` (the plugin resolves its own location) — match
// none of these by construction, so they need no exception list.
const PATTERNS = [
  { name: '/Users/', re: /\/Users\//i },
  { name: '/home/', re: /\/home\//i },
  { name: 'C:\\', re: /C:\\/i },
  { name: '~/Developer/', re: /~\/Developer\//i },
  { name: '.dotfiles', re: /\.dotfiles/i },
];

// Every violation in one file's text, as `path:line — pattern`.
const violations = (rel, text) => {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) out.push(`${rel}:${i + 1} — machine-specific path (${name}): ${line.trim()}`);
    }
  });
  return out;
};

const filesIn = (dir, filter = () => true) =>
  fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && filter(e.name))
    .map((e) => path.join(e.parentPath || e.path, e.name));

const scan = (files) => {
  const bad = [];
  for (const file of files) bad.push(...violations(path.relative(REPO, file), fs.readFileSync(file, 'utf8')));
  return bad;
};

const run = async () => {
  group('agents-lint: the detector');

  await test('each machine-specific form is caught, with its line number', () => {
    assertEq(
      violations('a.md', 'ok\nsee /Users/someone/Developer/thing.md\n').join(''),
      'a.md:2 — machine-specific path (/Users/): see /Users/someone/Developer/thing.md',
      '/Users/ path'
    );
    assertEq(violations('a.md', 'run /home/runner/work/x.sh').length, 1, '/home/ path');
    assertEq(violations('a.md', 'open C:\\Users\\someone\\x.md').length, 1, 'a Windows drive path');
    assertEq(violations('a.md', 'see /users/alice/x.md').length, 1, 'a lowercase /users/ on a case-insensitive volume');
    assertEq(violations('a.md', 'notes in ~/Developer/notes.md').length, 1, 'a personal-layout path');
    assertEq(violations('a.md', 'lives in the .dotfiles repo').length, 1, 'a dotfiles-checkout reference');
  });

  await test('the portable idioms are not flagged', () => {
    const portable = [
      'The engine lives at ~/.claude/workkit.',
      'command: ${CLAUDE_PLUGIN_ROOT}/hooks/loader.sh docs:session',
      'Write the brief to a temp file and hand the worker its path.',
    ].join('\n');
    assertEq(violations('a.md', portable).join(', '), '', 'portable paths must pass');
  });

  group('agents-lint: the shipped tree');

  await test('agents/ exists and holds agent definitions', () => {
    // A missing or empty agents/ is a LOUD failure, never a skip: the check
    // below would otherwise pass by scanning nothing.
    assert(fs.existsSync(AGENTS_DIR), `missing ${AGENTS_DIR}`);
    const found = filesIn(AGENTS_DIR, (name) => name.endsWith('.md'));
    assert(found.length > 0, 'no agents/*.md found');
  });

  await test('no agent definition carries a machine-specific absolute path', () => {
    const bad = scan(filesIn(AGENTS_DIR, (name) => name.endsWith('.md')));
    assertEq(bad.join('\n'), '', `absolute paths in agent files:\n${bad.join('\n')}`);
  });

  // The same convention, same sentence in AGENTS.md: hooks and skills ship on
  // the same terms as the agents do, so they are scanned by the same walk.
  for (const dir of ['hooks', 'skills']) {
    await test(`nothing under ${dir}/ carries a machine-specific absolute path`, () => {
      const full = path.join(REPO, dir);
      assert(fs.existsSync(full), `missing ${full}`);
      const files = filesIn(full);
      assert(files.length > 0, `no files found under ${dir}/`);
      const bad = scan(files);
      assertEq(bad.join('\n'), '', `absolute paths under ${dir}/:\n${bad.join('\n')}`);
    });
  }
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
