//
// Tests for workflow/changelog.js — the CHANGELOG entry rules and the CLI both
// the docs:changelog-guard hook and the safety/commit-gate hook call.
//
// The added-only tests build real git repositories in a temp dir (no network,
// no fixtures to keep in sync) because "which lines did this change add" is a
// question only git can answer, and stubbing it would test the stub.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const { group, test, assert, assertEq, summary } = require('../lib/harness');

const MODULE = path.join(__dirname, '..', '..', 'workflow', 'changelog.js');
const { parseEntries, lintText, RULES } = require(MODULE);

const mkTmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const ISSUE = '[#4](https://github.com/o/r/issues/4)';
const COMMIT = '[`1de1308`](https://github.com/o/r/commit/1de1308)';
const THANKS = 'Thanks [@who](https://github.com/who)!';

/** A CHANGELOG with the given bullet lines under a section. */
const doc = (section, ...bullets) => [
  '# Changelog',
  '',
  'All notable changes to this project.',
  '',
  `## [${section}]`,
  '',
  '### Added',
  '',
  ...bullets.flatMap((b) => [b, '']),
].join('\n');

const rules = (violations) => violations.map((v) => v.rule).sort();

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A real git repo with a committed CHANGELOG, so diffs are genuine. */
const mkRepo = (initialContent) => {
  const dir = mkTmp();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), initialContent);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
};

const runCli = (file, args, cwd) => {
  const res = spawnSync('node', [MODULE, file, ...args], { cwd, encoding: 'utf8', timeout: 20000 });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
};

const run = async () => {
  group('changelog: parsing');

  await test('a bullet under a version section is an entry; a preamble bullet is not', () => {
    const text = [
      '# Changelog',
      '',
      '- this is a legend line, not an entry',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} — A short entry.`,
    ].join('\n');
    const entries = parseEntries(text);
    assertEq(entries.length, 1, 'only the sectioned bullet counts');
    assertEq(entries[0].kind, 'unreleased', 'classified as unreleased');
  });

  await test('a `## [3.1.0] - date` heading is a released section', () => {
    const entries = parseEntries(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} — Text.`));
    assertEq(entries[0].kind, 'released', 'version headings are released');
  });

  await test('a wrapped entry is one entry, not several', () => {
    const text = doc('Unreleased', `- ${ISSUE} — First line of the sentence`, '  wrapped onto a second line.');
    // The blank line the doc() helper inserts sits AFTER the wrap, so the
    // continuation must attach to the bullet above it.
    const entries = parseEntries(text.replace(`— First line of the sentence\n\n  wrapped`, '— First line of the sentence\n  wrapped'));
    assertEq(entries.length, 1, 'one entry');
    assert(entries[0].prose.includes('wrapped onto a second line'), `continuation joined, got: ${entries[0].prose}`);
  });

  group('changelog: the rules');

  await test('the canonical unreleased entry passes', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} — Plugins install from settings.json instead of being tracked as files.`));
    assertEq(found.length, 0, `clean, got: ${JSON.stringify(found)}`);
  });

  await test('the canonical released entry passes', () => {
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} ${THANKS} — Plugins install from settings.json.`));
    assertEq(found.length, 0, `clean, got: ${JSON.stringify(found)}`);
  });

  await test('an entry with no issue link is reported', () => {
    const found = lintText(doc('Unreleased', '- **Plugins are installed from a declaration** — the old essay style.'));
    assert(rules(found).includes('issue-link'), `got: ${rules(found)}`);
  });

  await test('`(no issue)` satisfies the issue rule', () => {
    const found = lintText(doc('Unreleased', '- (no issue) — A change with nothing filed for it.'));
    assertEq(found.length, 0, `clean, got: ${JSON.stringify(found)}`);
  });

  await test('an over-long entry is reported with its word count', () => {
    const long = new Array(RULES.maxWords + 5).fill('word').join(' ');
    const found = lintText(doc('Unreleased', `- ${ISSUE} — ${long}.`));
    const cap = found.find((v) => v.rule === 'word-cap');
    assert(cap, `word-cap reported, got: ${rules(found)}`);
    assert(cap.message.startsWith(`${RULES.maxWords + 5} words`), `names the count, got: ${cap.message}`);
  });

  await test('an entry at exactly the cap passes', () => {
    const exact = new Array(RULES.maxWords).fill('word').join(' ');
    const found = lintText(doc('Unreleased', `- ${ISSUE} — ${exact}`));
    assertEq(found.length, 0, `the cap is inclusive, got: ${JSON.stringify(found)}`);
  });

  await test('the links do not count toward the word cap', () => {
    // Only the prose after the separator is measured — otherwise a long URL
    // would eat the budget an entry is supposed to spend on meaning.
    const words = new Array(RULES.maxWords).fill('word').join(' ');
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} ${THANKS} — ${words}`));
    assertEq(found.length, 0, `metadata is not prose, got: ${JSON.stringify(found)}`);
  });

  await test('a missing em dash separator is reported', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} plugins install from settings.json.`));
    assert(rules(found).includes('separator'), `got: ${rules(found)}`);
  });

  await test('a released entry missing its commit link is reported', () => {
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} — Plugins install from settings.json.`));
    assert(rules(found).includes('commit-link'), `got: ${rules(found)}`);
  });

  await test('a commit link mentioned in the prose does not satisfy the released rule', () => {
    // The rule is anchored to the metadata run after the issue link; testing
    // the whole entry let a prose mention stand in for the missing link.
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} — Reverts ${COMMIT} from the last release.`));
    assert(rules(found).includes('commit-link'), `got: ${rules(found)}`);
  });

  await test('an unreleased entry is NOT asked for a commit link', () => {
    // The sha does not exist when the entry is written — demanding it here
    // would make the rule impossible to satisfy.
    const found = lintText(doc('Unreleased', `- ${ISSUE} — Plugins install from settings.json.`));
    assertEq(found.length, 0, `no commit-link demand, got: ${JSON.stringify(found)}`);
  });

  await test('a released `(no issue)` entry is exempt from the commit link', () => {
    // The generator finds commits through `Fixes #N`; with no issue there is
    // nothing to look up, and a hand-typed sha is what this format avoids.
    const found = lintText(doc('3.1.0] - 2026-07-24', '- (no issue) — A change with nothing filed for it.'));
    assertEq(found.length, 0, `exempt, got: ${JSON.stringify(found)}`);
  });

  await test('a second paragraph inside one bullet is reported', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} — The short entry.`,
      '',
      '  And then a whole second paragraph of detail that belongs in the commit.',
      '',
    ].join('\n');
    assert(rules(lintText(text)).includes('one-paragraph'), `got: ${rules(lintText(text))}`);
  });

  await test('a blank line between two entries is not a second paragraph', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} — First entry.`, `- ${ISSUE} — Second entry.`));
    assertEq(found.length, 0, `both clean, got: ${JSON.stringify(found)}`);
  });

  group('changelog: shapes a real CHANGELOG contains');

  // Every case here was a reproduced defect in the first cut: each one either
  // bounced correct work or waved a violation through in silence.

  await test('a keepachangelog link-reference footer is not part of the entry above it', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} — A perfectly correct entry.`,
      '',
      '[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD',
      '[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0',
      '',
    ].join('\n');
    assertEq(lintText(text).length, 0, `the footer is not a second paragraph, got: ${JSON.stringify(lintText(text))}`);
  });

  await test('a CRLF file parses exactly like an LF one', () => {
    // `$` sits before the `\r`, so the whole file used to read as zero entries
    // and the guards passed anything in it.
    const lf = doc('Unreleased', '- An essay entry with no issue link.');
    assertEq(lintText(lf.replace(/\n/g, '\r\n')).length, lintText(lf).length, 'same violations');
    assert(lintText(lf).length > 0, 'and the LF case really does violate');
  });

  await test('a bullet inside a fenced code block is an example, not an entry', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      '```markdown',
      '- An example of the OLD format, with no link and a great many words indeed.',
      '```',
      '',
      `- ${ISSUE} — A real entry.`,
    ].join('\n');
    assertEq(lintText(text).length, 0, `the fenced example is not judged, got: ${JSON.stringify(lintText(text))}`);
  });

  await test('a bracketed prose heading with a digit is not a released section', () => {
    // "Any label with a digit" classified `## [Plans for 2026]` as a released
    // version, and its bullets then demanded commit links.
    const text = doc('Plans for 2026', '- ship the roadmap, someday, with no links at all');
    assertEq(parseEntries(text).length, 0, 'its bullets are not entries');
    assertEq(lintText(text).length, 0, `not judged, got: ${JSON.stringify(lintText(text))}`);
  });

  await test('a `##` heading that is not a version section ends the section', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} — A real entry.`,
      '',
      '## Migration notes',
      '',
      '- run the thing by hand, then check the output, because this is prose and not a changelog entry',
    ].join('\n');
    assertEq(lintText(text).length, 0, `prose bullets are not entries, got: ${JSON.stringify(lintText(text))}`);
  });

  await test('a `*` bullet is an entry too', () => {
    const found = lintText(doc('Unreleased', `* ${new Array(60).fill('word').join(' ')}`));
    assert(rules(found).includes('word-cap'), `judged, got: ${rules(found)}`);
  });

  await test('an em dash inside the prose does not stand in for the separator', () => {
    // The separator is anchored to the end of the links; searching the whole
    // entry accepted this and then counted words from the wrong offset.
    const found = lintText(doc('Unreleased', `- ${ISSUE} The installer — which reads settings.json — now runs.`));
    assert(rules(found).includes('separator'), `got: ${rules(found)}`);
  });

  group('changelog: the CLI and --added-only');

  await test('a clean file exits 0 and says nothing', () => {
    const dir = mkTmp();
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', `- ${ISSUE} — A short entry.`));
    const { code, out } = runCli(file, [], dir);
    assertEq(code, 0, 'exit 0');
    assertEq(out.trim(), '', `silent, got: ${out}`);
    cleanup(dir);
  });

  await test('a violating file exits 1 and names the line and rule', () => {
    const dir = mkTmp();
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', '- An entry with no issue link at all.'));
    const { code, out } = runCli(file, [], dir);
    assertEq(code, 1, 'exit 1');
    assert(/line \d+ \[issue-link\]/.test(out), `names line + rule, got: ${out}`);
    cleanup(dir);
  });

  await test('--added-only ignores a legacy entry the change did not touch', () => {
    // The whole point: adopting the format must not bounce a repo's history.
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link, plenty of words.'));
    assertEq(runCli(path.join(dir, 'CHANGELOG.md'), [], dir).code, 1, 'the legacy entry does violate');
    assertEq(runCli(path.join(dir, 'CHANGELOG.md'), ['--added-only'], dir).code, 0, 'but nothing was added');
    cleanup(dir);
  });

  await test('--added-only catches a new violating entry beside a legacy one', () => {
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link.'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- Another essay entry with no link.\n`);
    const { code, out } = runCli(file, ['--added-only'], dir);
    assertEq(code, 1, 'the added entry is judged');
    assert(out.includes('Another essay entry') || /issue-link/.test(out), `reports it, got: ${out}`);
    cleanup(dir);
  });

  await test('--added-only accepts a new entry in the format', () => {
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link.'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- ${ISSUE} — A properly formatted new entry.\n`);
    assertEq(runCli(file, ['--added-only'], dir).code, 0, 'clean');
    cleanup(dir);
  });

  await test('--staged judges the index, not the working tree', () => {
    const dir = mkRepo(doc('Unreleased', `- ${ISSUE} — A clean entry.`));
    const file = path.join(dir, 'CHANGELOG.md');
    // Stage a good entry, then leave a bad one only in the working tree.
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- ${ISSUE} — Staged and fine.\n`);
    git(dir, 'add', 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- unstaged essay with no link.\n`);
    assertEq(runCli(file, ['--added-only', '--staged'], dir).code, 0, 'the index is clean');
    assertEq(runCli(file, ['--added-only'], dir).code, 1, 'the working tree is not');
    cleanup(dir);
  });

  await test('an untracked CHANGELOG is judged in full', () => {
    // Nothing to diff against, so every entry is new — a first CHANGELOG must
    // not slip in unjudged.
    const dir = mkTmp();
    git(dir, 'init', '-q', '-b', 'main');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', '- An essay entry with no issue link.'));
    assertEq(runCli(file, ['--added-only'], dir).code, 1, 'judged');
    cleanup(dir);
  });

  await test('--added-only judges an entry when only its CONTINUATION line changed', () => {
    // Editing a wrapped entry's second line rewrites the entry; anchoring on
    // its first line alone let the edit walk past both hooks.
    const dir = mkRepo([...doc('Unreleased').split('\n'), `- ${ISSUE} — Short`, '  and a wrap.', ''].join('\n'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  and a wrap.', `  ${new Array(60).fill('word').join(' ')}`));
    const { code, out } = runCli(file, ['--added-only'], dir);
    assertEq(code, 1, `judged, got: ${out}`);
    assert(out.includes('word-cap'), `names the rule, got: ${out}`);
    cleanup(dir);
  });

  await test('a diff content line starting with + does not misnumber the lines after it', () => {
    // `+++` was skipped as a header without advancing the cursor, so every
    // added line after it in the hunk was numbered low and escaped judgment.
    const dir = mkRepo(doc('Unreleased'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}++ a note line\n- an added essay entry with no issue link at all\n`);
    const { code, out } = runCli(file, ['--added-only'], dir);
    assertEq(code, 1, `the entry after it is still judged, got: ${out}`);
    cleanup(dir);
  });

  await test('every violation survives being piped to a consumer', () => {
    // standards.sh derives a COUNT from this output. `process.exit()` discards
    // whatever console.error still has buffered when stderr is a pipe, so a
    // large file reported a short, varying list — and a count of 0 would have
    // read as "this repo is already migrated". The invariant is asserted here;
    // the truncation itself was timing-dependent and does not reproduce
    // reliably, so this pins the contract rather than the race.
    const dir = mkTmp();
    const file = path.join(dir, 'CHANGELOG.md');
    const bullets = Array.from({ length: 1000 }, (_, i) => `- **Essay ${i}** with no link and no separator at all.`);
    fs.writeFileSync(file, doc('1.0.0] - 2020-01-01', ...bullets));
    const { code, out } = runCli(file, [], dir);
    assertEq(code, 1, 'exit 1');
    const reported = new Set(out.split('\n').map((l) => /^ {2}line (\d+)/.exec(l)).filter(Boolean).map((m) => m[1]));
    assertEq(reported.size, 1000, `every entry reported, got ${reported.size}`);
    cleanup(dir);
  });

  await test('a missing file exits 0 rather than erroring', () => {
    const dir = mkTmp();
    assertEq(runCli(path.join(dir, 'CHANGELOG.md'), [], dir).code, 0, 'fail open');
    cleanup(dir);
  });

  return summary();
};

module.exports = run;
