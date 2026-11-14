// Tests for workflow/changelog/lint.js (`workkit changelog lint`): the CHANGELOG
// entry rules and the CLI docs:changelog-guard and safety:commit-gate call. The
// added-only tests build real git repos: which lines a change added is a question
// only git answers.

const path = require('path');
const fs = require('fs');
const { spawnSync, execFileSync } = require('child_process');
const { describe, test, expect, mkTmp, SPAWN_DEADLINE } = require('../lib/harness');

const MODULE = path.join(__dirname, '..', '..', 'workflow', 'changelog', 'lint.js');
const { parseEntries, lintText, RULES } = require(MODULE);

const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const ISSUE = '[#4](https://github.com/o/r/issues/4)';
const COMMIT = '[`1de1308`](https://github.com/o/r/commit/1de1308)';
const THANKS = 'Thanks [@who](https://github.com/who)!';
// ` - ` in the fixtures below is the CHANGELOG entry separator (a spaced hyphen).

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
  const dir = mkTmp('cl-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), initialContent);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
};

const runCli = (file, args, cwd) => {
  const res = spawnSync('node', [MODULE, file, ...args], { cwd, encoding: 'utf8', timeout: SPAWN_DEADLINE });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
};

// A CHANGELOG whose released history is out of format and whose [Unreleased]
// section is the part still being written, the shape every repo has while it
// is adopting the format.
const mixed = (unreleased) => [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  unreleased,
  '',
  '## [1.0.0] - 2020-01-01',
  '',
  '### Added',
  '',
  '- A legacy released entry with no link, no separator, and a great many words about nothing in particular.',
  '',
].join('\n');

describe('changelog: parsing', () => {
  test('a bullet under a version section is an entry; a preamble bullet is not', () => {
    const text = [
      '# Changelog',
      '',
      '- this is a legend line, not an entry',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} - A short entry.`,
    ].join('\n');
    const entries = parseEntries(text);
    expect(entries.length, 'only the sectioned bullet counts').toBe(1);
    expect(entries[0].kind, 'classified as unreleased').toBe('unreleased');
  });

  test('a `## [3.1.0] - date` heading is a released section', () => {
    const entries = parseEntries(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} - Text.`));
    expect(entries[0].kind, 'version headings are released').toBe('released');
  });

  test('a wrapped entry is one entry, not several', () => {
    const text = doc('Unreleased', `- ${ISSUE} - First line of the sentence`, '  wrapped onto a second line.');
    // The blank line the doc() helper inserts sits after the wrap, so the
    // continuation must attach to the bullet above it.
    const entries = parseEntries(text.replace(`- First line of the sentence\n\n  wrapped`, '- First line of the sentence\n  wrapped'));
    expect(entries.length, 'one entry').toBe(1);
    expect(entries[0].prose.includes('wrapped onto a second line'), `continuation joined, got: ${entries[0].prose}`).toBeTruthy();
  });
});

describe('changelog: the rules', () => {
  test('the canonical unreleased entry passes', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} - Plugins install from settings.json instead of being tracked as files.`));
    expect(found.length, `clean, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('the canonical released entry passes', () => {
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} ${THANKS} - Plugins install from settings.json.`));
    expect(found.length, `clean, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('an entry with no issue link is reported', () => {
    const found = lintText(doc('Unreleased', '- **Plugins are installed from a declaration** - the old essay style.'));
    expect(rules(found).includes('issue-link'), `got: ${rules(found)}`).toBeTruthy();
  });

  test('`(no issue)` satisfies the issue rule', () => {
    const found = lintText(doc('Unreleased', '- (no issue) - A change with nothing filed for it.'));
    expect(found.length, `clean, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('an over-long entry is reported with its word count', () => {
    const long = new Array(RULES.maxWords + 5).fill('word').join(' ');
    const found = lintText(doc('Unreleased', `- ${ISSUE} - ${long}.`));
    const cap = found.find((v) => v.rule === 'word-cap');
    expect(cap, `word-cap reported, got: ${rules(found)}`).toBeTruthy();
    expect(cap.message.startsWith(`${RULES.maxWords + 5} words`), `names the count, got: ${cap.message}`).toBeTruthy();
  });

  test('an entry at exactly the cap passes', () => {
    const exact = new Array(RULES.maxWords).fill('word').join(' ');
    const found = lintText(doc('Unreleased', `- ${ISSUE} - ${exact}`));
    expect(found.length, `the cap is inclusive, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('the links do not count toward the word cap', () => {
    // Only the prose after the separator is measured. Otherwise a long URL
    // would eat the budget an entry is supposed to spend on meaning.
    const words = new Array(RULES.maxWords).fill('word').join(' ');
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} ${COMMIT} ${THANKS} - ${words}`));
    expect(found.length, `metadata is not prose, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('a missing separator is reported', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} plugins install from settings.json.`));
    expect(rules(found).includes('separator'), `got: ${rules(found)}`).toBeTruthy();
  });

  test('the old em dash separator is reported, never accepted (#248)', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} \u2014 Plugins install from settings.json.`));
    expect(rules(found).includes('separator'), `got: ${rules(found)}`).toBeTruthy();
  });

  test('a released entry missing its commit link is reported', () => {
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} - Plugins install from settings.json.`));
    expect(rules(found).includes('commit-link'), `got: ${rules(found)}`).toBeTruthy();
  });

  test('a commit link mentioned in the prose does not satisfy the released rule', () => {
    // The rule is anchored to the metadata run after the issue link, never the
    // whole entry, so a prose mention cannot stand in for the missing link.
    const found = lintText(doc('3.1.0] - 2026-07-24', `- ${ISSUE} - Reverts ${COMMIT} from the last release.`));
    expect(rules(found).includes('commit-link'), `got: ${rules(found)}`).toBeTruthy();
  });

  test('a released `(no issue)` entry is exempt from the commit link', () => {
    // The generator finds commits through `Fixes #N`; with no issue there is
    // nothing to look up, and a hand-typed sha is what this format avoids.
    const found = lintText(doc('3.1.0] - 2026-07-24', '- (no issue) - A change with nothing filed for it.'));
    expect(found.length, `exempt, got: ${JSON.stringify(found)}`).toBe(0);
  });

  test('a second paragraph inside one bullet is reported', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} - The short entry.`,
      '',
      '  And then a whole second paragraph of detail that belongs in the commit.',
      '',
    ].join('\n');
    expect(rules(lintText(text)).includes('one-paragraph'), `got: ${rules(lintText(text))}`).toBeTruthy();
  });

  test('a blank line between two entries is not a second paragraph', () => {
    const found = lintText(doc('Unreleased', `- ${ISSUE} - First entry.`, `- ${ISSUE} - Second entry.`));
    expect(found.length, `both clean, got: ${JSON.stringify(found)}`).toBe(0);
  });
});

describe('changelog: shapes a real CHANGELOG contains', () => {
  // Each shape here, misread, either bounces correct work or waves a violation
  // through in silence.

  test('a keepachangelog link-reference footer is not part of the entry above it', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} - A perfectly correct entry.`,
      '',
      '[Unreleased]: https://github.com/o/r/compare/v1.0.0...HEAD',
      '[1.0.0]: https://github.com/o/r/releases/tag/v1.0.0',
      '',
    ].join('\n');
    expect(lintText(text).length, `the footer is not a second paragraph, got: ${JSON.stringify(lintText(text))}`).toBe(0);
  });

  test('a CRLF file parses exactly like an LF one', () => {
    // `$` sits before the `\r`: an unnormalized file reads as zero entries and
    // the guards pass anything in it.
    const lf = doc('Unreleased', '- An essay entry with no issue link.');
    expect(lintText(lf.replace(/\n/g, '\r\n')).length, 'same violations').toBe(lintText(lf).length);
    expect(lintText(lf).length > 0, 'and the LF case really does violate').toBeTruthy();
  });

  test('a bullet inside a fenced code block is an example, not an entry', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      '```markdown',
      '- An example of the OLD format, with no link and a great many words indeed.',
      '```',
      '',
      `- ${ISSUE} - A real entry.`,
    ].join('\n');
    expect(lintText(text).length, `the fenced example is not judged, got: ${JSON.stringify(lintText(text))}`).toBe(0);
  });

  test('a bracketed prose heading with a digit is not a released section', () => {
    // A label with a digit is not a version: `## [Plans for 2026]` is prose,
    // and its bullets demand no commit links.
    const text = doc('Plans for 2026', '- ship the roadmap, someday, with no links at all');
    expect(parseEntries(text).length, 'its bullets are not entries').toBe(0);
    expect(lintText(text).length, `not judged, got: ${JSON.stringify(lintText(text))}`).toBe(0);
  });

  test('a `##` heading that is not a version section ends the section', () => {
    const text = [
      '## [Unreleased]',
      '',
      '### Added',
      `- ${ISSUE} - A real entry.`,
      '',
      '## Migration notes',
      '',
      '- run the thing by hand, then check the output, because this is prose and not a changelog entry',
    ].join('\n');
    expect(lintText(text).length, `prose bullets are not entries, got: ${JSON.stringify(lintText(text))}`).toBe(0);
  });

  test('a `*` bullet is an entry too', () => {
    const found = lintText(doc('Unreleased', `* ${new Array(60).fill('word').join(' ')}`));
    expect(rules(found).includes('word-cap'), `judged, got: ${rules(found)}`).toBeTruthy();
  });

  test('a spaced hyphen inside the prose does not stand in for the separator', () => {
    // The separator is anchored to the end of the links, so a prose hyphen
    // neither satisfies it nor moves the offset the words are counted from.
    const found = lintText(doc('Unreleased', `- ${ISSUE} The installer - which reads settings.json - now runs.`));
    expect(rules(found).includes('separator'), `got: ${rules(found)}`).toBeTruthy();
  });
});

describe('changelog: the CLI and --added-only', () => {
  test('a clean file exits 0 and says nothing', () => {
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', `- ${ISSUE} - A short entry.`));
    const { code, out } = runCli(file, [], dir);
    expect(code, 'exit 0').toBe(0);
    expect(out.trim(), `silent, got: ${out}`).toBe('');
    cleanup(dir);
  });

  test('a violating file exits 1 and names the line and rule', () => {
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', '- An entry with no issue link at all.'));
    const { code, out } = runCli(file, [], dir);
    expect(code, 'exit 1').toBe(1);
    expect(/line \d+ \[issue-link\]/.test(out), `names line + rule, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });

  test('--added-only ignores a legacy entry the change did not touch', () => {
    // The whole point: adopting the format must not bounce a repo's history.
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link, plenty of words.'));
    expect(runCli(path.join(dir, 'CHANGELOG.md'), [], dir).code, 'the legacy entry does violate').toBe(1);
    expect(runCli(path.join(dir, 'CHANGELOG.md'), ['--added-only'], dir).code, 'but nothing was added').toBe(0);
    cleanup(dir);
  });

  test('--added-only catches a new violating entry beside a legacy one', () => {
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link.'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- Another essay entry with no link.\n`);
    const { code, out } = runCli(file, ['--added-only'], dir);
    expect(code, 'the added entry is judged').toBe(1);
    expect(out.includes('Another essay entry') || /issue-link/.test(out), `reports it, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });

  test('--added-only accepts a new entry in the format', () => {
    const dir = mkRepo(doc('Unreleased', '- A legacy entry, no issue link.'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- ${ISSUE} - A properly formatted new entry.\n`);
    expect(runCli(file, ['--added-only'], dir).code, 'clean').toBe(0);
    cleanup(dir);
  });

  test('--staged judges the index, not the working tree', () => {
    const dir = mkRepo(doc('Unreleased', `- ${ISSUE} - A clean entry.`));
    const file = path.join(dir, 'CHANGELOG.md');
    // Stage a good entry, then leave a bad one only in the working tree.
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- ${ISSUE} - Staged and fine.\n`);
    git(dir, 'add', 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}- unstaged essay with no link.\n`);
    expect(runCli(file, ['--added-only', '--staged'], dir).code, 'the index is clean').toBe(0);
    expect(runCli(file, ['--added-only'], dir).code, 'the working tree is not').toBe(1);
    cleanup(dir);
  });

  test('an untracked CHANGELOG is judged in full', () => {
    // Nothing to diff against, so every entry is new. A first CHANGELOG must
    // not slip in unjudged.
    const dir = mkTmp('cl-');
    git(dir, 'init', '-q', '-b', 'main');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('Unreleased', '- An essay entry with no issue link.'));
    expect(runCli(file, ['--added-only'], dir).code, 'judged').toBe(1);
    cleanup(dir);
  });

  test('--added-only judges an entry when only its CONTINUATION line changed', () => {
    // Editing a wrapped entry's second line rewrites the entry, so both hooks
    // judge it whole.
    const dir = mkRepo([...doc('Unreleased').split('\n'), `- ${ISSUE} - Short`, '  and a wrap.', ''].join('\n'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('  and a wrap.', `  ${new Array(60).fill('word').join(' ')}`));
    const { code, out } = runCli(file, ['--added-only'], dir);
    expect(code, `judged, got: ${out}`).toBe(1);
    expect(out.includes('word-cap'), `names the rule, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });

  test('a diff content line starting with + does not misnumber the lines after it', () => {
    // A content line `+++` is not a header: skipped without advancing the
    // cursor, every added line after it would be numbered low and go unjudged.
    const dir = mkRepo(doc('Unreleased'));
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}++ a note line\n- an added essay entry with no issue link at all\n`);
    const { code, out } = runCli(file, ['--added-only'], dir);
    expect(code, `the entry after it is still judged, got: ${out}`).toBe(1);
    cleanup(dir);
  });

  test('every violation survives being piped to a consumer', () => {
    // standards.sh derives a count from this output, and `process.exit()` drops
    // buffered stderr on a pipe. The truncation is timing-dependent, so this
    // pins the contract rather than the race.
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    const bullets = Array.from({ length: 1000 }, (_, i) => `- **Essay ${i}** with no link and no separator at all.`);
    fs.writeFileSync(file, doc('1.0.0] - 2020-01-01', ...bullets));
    const { code, out } = runCli(file, [], dir);
    expect(code, 'exit 1').toBe(1);
    const reported = new Set(out.split('\n').map((l) => /^ {2}line (\d+)/.exec(l)).filter(Boolean).map((m) => m[1]));
    expect(reported.size, `every entry reported, got ${reported.size}`).toBe(1000);
    cleanup(dir);
  });

  test('a missing file exits 0 rather than erroring', () => {
    const dir = mkTmp('cl-');
    expect(runCli(path.join(dir, 'CHANGELOG.md'), [], dir).code, 'fail open').toBe(0);
    cleanup(dir);
  });

});

describe('changelog: --unreleased-only (the CI mode)', () => {
  test('released history never fails the check', () => {
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, mixed(`- ${ISSUE} - A clean unreleased entry.`));
    expect(runCli(file, [], dir).code, 'the whole file does violate').toBe(1);
    expect(runCli(file, ['--unreleased-only'], dir).code, 'but published history is not this gate\'s business').toBe(0);
    cleanup(dir);
  });

  test('a violating unreleased entry fails, naming its rule', () => {
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, mixed('- An unreleased entry with no issue link.'));
    const { code, out } = runCli(file, ['--unreleased-only'], dir);
    expect(code, 'exit 1').toBe(1);
    expect(/line \d+ \[issue-link\]/.test(out), `names line + rule, got: ${out}`).toBeTruthy();
    expect(!/great many words/.test(out), 'and reports only the unreleased section').toBeTruthy();
    cleanup(dir);
  });

  test('a released entry missing its commit link is not judged either', () => {
    // The rule that only applies to released sections is the one a CI run has
    // no business enforcing: the links are generated at release time.
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('1.0.0] - 2020-01-01', `- ${ISSUE} - Released without its commit link.`));
    expect(runCli(file, [], dir).code, 'the commit-link rule does apply to it').toBe(1);
    expect(runCli(file, ['--unreleased-only'], dir).code, 'but not in the CI mode').toBe(0);
    cleanup(dir);
  });

  test('a file with no [Unreleased] section passes', () => {
    const dir = mkTmp('cl-');
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, doc('1.0.0] - 2020-01-01', '- An old entry with nothing right about it.'));
    expect(runCli(file, ['--unreleased-only'], dir).code, 'nothing to judge').toBe(0);
    cleanup(dir);
  });
});

describe('changelog: --added-only --base=<ref> (the pull request mode)', () => {
  // A pull request that carries its own release commit: the base has published
  // history out of format, and the head moves the new entries into [1.1.0], so
  // its [Unreleased] is empty again.
  const released = (entry) => mixed('').replace('## [1.0.0]', `## [1.1.0] - 2020-02-01\n\n### Fixed\n\n${entry}\n\n## [1.0.0]`);

  test('an entry the pull request released out of format fails against the base, the legacy one never named', () => {
    const dir = mkRepo(mixed(''));
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, released(`- ${ISSUE} ${COMMIT} An entry with no separator.`));
    git(dir, 'commit', '-qam', 'chore(release): 1.1.0');
    expect(runCli(file, ['--unreleased-only'], dir).code, 'the CI mode sees an empty [Unreleased]').toBe(0);
    const { code, out } = runCli(file, ['--added-only', `--base=${base}`], dir);
    expect(code, `the released entry is judged, got: ${out}`).toBe(1);
    expect(/line \d+ \[separator\]/.test(out), `names line + rule, got: ${out}`).toBeTruthy();
    expect(!/great many words/.test(out), `and never the base's history, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });

  test('an entry the pull request released in format passes against the base', () => {
    const dir = mkRepo(mixed(''));
    const base = git(dir, 'rev-parse', 'HEAD').trim();
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, released(`- ${ISSUE} ${COMMIT} - A released entry.`));
    git(dir, 'commit', '-qam', 'chore(release): 1.1.0');
    const { code, out } = runCli(file, ['--added-only', `--base=${base}`], dir);
    expect(code, `clean, got: ${out}`).toBe(0);
    cleanup(dir);
  });

  test('a --base naming no commit is one line, exit 2, never the whole file judged', () => {
    const dir = mkRepo(mixed(''));
    const { code, out } = runCli(path.join(dir, 'CHANGELOG.md'), ['--added-only', '--base=nope'], dir);
    expect(code, `exit 2, got: ${out}`).toBe(2);
    expect(/--base=nope names no commit/.test(out), `names the ref, got: ${out}`).toBeTruthy();
    expect(!/great many words/.test(out), `and judges nothing, got: ${out}`).toBeTruthy();
    cleanup(dir);
  });
});
