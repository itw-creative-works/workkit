// Role brief templates: the fourteen files under briefs/, their header and
// slot vocabulary, the length bar, the rules they leave to the agent files,
// and the docs that point at the folder.
const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, selfRun, summary } = require('../lib/harness');

const REPO = path.join(__dirname, '..', '..');
const BRIEFS_DIR = path.join(REPO, 'briefs');

// Hard-coded from the issue's Contract, never read from the folder: a file
// added or dropped there has to fail here.
const BRIEFS = [
  'feature-developer', 'test-developer', 'docs-developer',
  'group-verifier', 'fix-verifier', 'recon-scout', 'compliance-reviewer',
  'bugs-scout', 'simplification-scout', 'history-scout', 'firestore-scout', 'parity-scout',
  'light-reviewer', 'review-scorer',
];
const SLOTS = [
  '{{title}}', '{{repo}}', '{{issue}}', '{{guides}}', '{{task}}', '{{paths}}',
  '{{other-paths}}', '{{tests}}', '{{diff}}', '{{findings}}', '{{question}}', '{{kit}}',
];
const AGENTS = ['worker', 'verifier', 'scout', 'reviewer', 'advisor'];
const DEVELOPERS = ['feature-developer', 'test-developer', 'docs-developer'];
const DIFF_READERS = [
  'group-verifier', 'fix-verifier', 'compliance-reviewer',
  'bugs-scout', 'simplification-scout', 'history-scout', 'firestore-scout', 'parity-scout',
  'light-reviewer', 'review-scorer',
];
const FINDINGS_READERS = ['fix-verifier', 'review-scorer'];
// The unreadable literal the {{kit}} slot replaces: the Read tool collapses
// the .. before it follows the ~/.claude/workkit link.
const KIT_LITERAL = '~/.claude/workkit/..';
const LINE_CAP = 40;
const BYTE_CAP = 400;

const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');
const brief = (name) => read('briefs', `${name}.md`);
const slotsIn = (text) => text.match(/\{\{[^}]*\}\}/g) || [];

// One template per failing name, so a red run lists every offender at once.
const eachBrief = (check) => {
  const bad = [];
  for (const name of BRIEFS) {
    const problem = check(brief(name), name);
    if (problem) bad.push(`${name}: ${problem}`);
  }
  assertEq(bad.join('; '), '', 'templates off the contract');
};

const usesAll = (names, slots) => () => eachBrief((text, name) => {
  if (!names.includes(name)) return null;
  const missing = slots.filter((slot) => !text.includes(slot));
  return missing.length ? `missing ${missing.join(', ')}` : null;
});

// Whole-line match, so `## Tasks` cannot stand in for `## Task`.
const hasLines = (names, wanted) => () => eachBrief((text, name) => {
  if (!names.includes(name)) return null;
  const lines = text.split('\n').map((line) => line.trimEnd());
  const missing = wanted.filter((line) => !lines.includes(line));
  return missing.length ? `missing line ${missing.map((l) => JSON.stringify(l)).join(', ')}` : null;
});

// From the `## <prefix>` heading to the next `## ` heading.
const h2Section = (text, prefix) => {
  const start = text.indexOf(`\n## ${prefix}`);
  assert(start >= 0, `no "## ${prefix}" heading`);
  const rest = text.slice(start + 1);
  const next = rest.slice(3).search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next + 3);
};

const run = async () => {
  group('briefs: the folder');
  await test('briefs/ holds exactly the fourteen templates, each a lowercase <job>-<role>.md', () => {
    assert(fs.existsSync(BRIEFS_DIR), 'briefs/ does not exist');
    const files = fs.readdirSync(BRIEFS_DIR).sort();
    assertEq(files.join(','), BRIEFS.map((n) => `${n}.md`).sort().join(','), 'briefs/ contents');
    const misnamed = files.filter((f) => !/^[a-z]+-[a-z]+\.md$/.test(f));
    assertEq(misnamed.join(', '), '', 'names off the <job>-<role>.md pattern');
  });

  group('briefs: the header');
  await test('every template opens with "# Brief: {{title}}"', () => eachBrief((text) => {
    const first = text.split('\n')[0];
    return first === '# Brief: {{title}}' ? null : `line 1 is ${JSON.stringify(first)}`;
  }));
  await test('every Role: line names its own file stem and one of the five workkit agents', () => eachBrief((text, name) => {
    const role = new RegExp(`^Role: ${name} \\(\`workkit:(${AGENTS.join('|')})\`\\)`, 'm');
    return role.test(text) ? null : 'no "Role: <stem> (`workkit:<agent>`)" line';
  }));

  group('briefs: the slot vocabulary');
  await test('every {{slot}} in every template is one of the twelve', () => eachBrief((text) => {
    const stray = [...new Set(slotsIn(text).filter((slot) => !SLOTS.includes(slot)))];
    return stray.length ? `stray ${stray.join(', ')}` : null;
  }));
  await test('every template uses {{title}}, {{repo}}, {{task}} and {{kit}}', usesAll(BRIEFS, ['{{title}}', '{{repo}}', '{{task}}', '{{kit}}']));
  await test('developer templates use {{paths}}, {{other-paths}} and {{tests}}', usesAll(DEVELOPERS, ['{{paths}}', '{{other-paths}}', '{{tests}}']));
  await test('verifier and lens templates use {{diff}}', usesAll(DIFF_READERS, ['{{diff}}']));
  await test('fix-verifier and review-scorer use {{findings}}', usesAll(FINDINGS_READERS, ['{{findings}}']));
  await test('recon-scout uses {{question}}', usesAll(['recon-scout'], ['{{question}}']));

  group('briefs: the skeleton');
  await test('every template has a "Repo: {{repo}}" line and "## Task" and "## Report" headings', hasLines(BRIEFS, ['Repo: {{repo}}', '## Task', '## Report']));
  await test('developer templates have "## Paths" and "## Verify" headings', hasLines(DEVELOPERS, ['## Paths', '## Verify']));
  await test('verifier and lens templates have a "## Diff" heading', hasLines(DIFF_READERS, ['## Diff']));
  await test(`every template contains {{kit}} and not ${KIT_LITERAL}`, () => eachBrief((text) => {
    if (!text.includes('{{kit}}')) return 'no {{kit}}';
    return text.includes(KIT_LITERAL) ? `still carries ${KIT_LITERAL}` : null;
  }));

  group('briefs: the length bar');
  await test(`no template passes ${LINE_CAP} non-blank lines or ${BYTE_CAP} bytes on a line`, () => eachBrief((text) => {
    const lines = text.split('\n');
    const problems = [];
    const content = lines.filter((line) => line.trim() !== '').length;
    if (content > LINE_CAP) problems.push(`${content} non-blank lines`);
    lines.forEach((line, i) => {
      const bytes = Buffer.byteLength(line, 'utf8');
      if (bytes > BYTE_CAP) problems.push(`line ${i + 1} is ${bytes} bytes`);
    });
    return problems.length ? problems.join(', ') : null;
  }));

  group('briefs: the agent file owns the standing rules');
  await test('no template contains "git stash", "Never spawn" or "final message IS"', () => eachBrief((text) => {
    const restated = ['git stash', 'Never spawn', 'final message IS'].filter((rule) => text.includes(rule));
    return restated.length ? `restates ${restated.join(', ')}` : null;
  }));

  group('agents: the shared-tree rule');
  await test('agents/worker.md names git stash and reverse-edit, not git show HEAD:; agents/verifier.md names git stash', () => {
    const worker = read('agents', 'worker.md');
    const verifier = read('agents', 'verifier.md');
    assert(worker.includes('git stash'), 'worker.md does not name git stash');
    assert(worker.includes('reverse-edit'), 'worker.md does not name reverse-edit');
    assert(!worker.includes('git show HEAD:'), 'worker.md still names git show HEAD:');
    assert(verifier.includes('git stash'), 'verifier.md does not name git stash');
  });

  group('docs: the folder is named');
  await test('docs/agents.md File-handoff convention names briefs/', () => {
    assert(h2Section(read('docs', 'agents.md'), 'File-handoff convention').includes('briefs/'),
      'the File-handoff convention section does not name briefs/');
  });
  await test('AGENTS.md and README.md name briefs/', () => {
    assert(read('AGENTS.md').includes('briefs/'), 'AGENTS.md does not name briefs/');
    assert(read('README.md').includes('briefs/'), 'README.md does not name briefs/');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
