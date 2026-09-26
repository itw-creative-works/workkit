//
// Tests for workflow/changelog-links.js, the release-time CHANGELOG backfill:
// what it must never rewrite, and the refusals that stop it writing at all.
// The shared prologue (the git and gh fixtures, the script runner, the Windows skip) is ./helpers.js.
//

const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  skipOnWindows, cleanup, git, makeGhStub, CHANGELOG, mkRepo, runScript, readLog,
} = require('./helpers');

const run = async () => {
  skipOnWindows();

  group('changelog-links: what it must never rewrite');

  // Both cases wrote real commit links into the file on the first cut. The
  // damage is permanent, so each one is pinned.

  await test('an example bullet inside a fenced block is left alone', () => {
    const fenced = '- [#4](https://github.com/o/r/issues/4) - What changed.';
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '```markdown',
      fenced,
      '```',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(fenced), 'the documented example is not an entry');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a Contributors heading inside a fenced example does not truncate the file', () => {
    // The rebuild cuts the file at the Contributors heading and re-emits the
    // tail. Taking the FIRST match discarded everything below a heading that
    // merely appeared in a fenced example: every released section, gone, on a
    // write. The heading is only this section's when the whole remainder has
    // this section's shape.
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- [#4](../../issues/4) - Text.',
      '',
      '## Format',
      '',
      'The file ends with a contributors block:',
      '',
      '```markdown',
      '## Contributors',
      '',
      '- [@someone]',
      '```',
      '',
      '## [1.0.0] - 2020-01-01',
      '- (no issue) - The first release.',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assert(text.includes('## [1.0.0] - 2020-01-01'), `the released section survives, got: ${text}`);
    assert(text.includes('- (no issue) - The first release.'), 'its entry survives');
    assertEq((text.match(/```/g) || []).length, 2, 'the fence is still closed');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a trailing rule that is not part of the section is kept', () => {
    // `---` above the heading belongs to the rebuilt section. A CHANGELOG whose
    // last content line is its own rule must not lose it on the first backfill.
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- [#4](../../issues/4) - Text.',
      '',
      '---',
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub({ login: 'who' });
    runScript(dir, stub);
    const text = readLog(dir);
    assertEq((text.match(/^---$/gm) || []).length, 2, `the original rule plus the section's, got: ${text}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry in an already-released section is left alone', () => {
    // An old release whose issue number recurs in this range must not be
    // stamped with this release's sha.
    const old = '- [#4](https://github.com/o/r/issues/4) - The 2020 entry.';
    const { dir } = mkRepo([
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '## [1.0.0] - 2020-01-01',
      '',
      '### Added',
      '',
      old,
      '',
    ].join('\n'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    runScript(dir, stub);
    assert(readLog(dir).includes(old), 'history is not rewritten');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('an entry whose issue has no closing commit is named, not passed in silence', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#99](https://github.com/o/r/issues/99) - Nothing closes this one.'),
      ['feat: unrelated work with no trailer'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub);
    assert(out.includes('#99 has no closing commit'), `reports it, got: ${out}`);
    assert(out.includes('Fixes #99'), `says how to fix it, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a flag with no value is a usage error, not a stack trace', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    for (const flag of ['--file', '--range']) {
      const { code, out } = runScript(dir, stub, [flag]);
      assertEq(code, 2, `${flag} exits 2`);
      assert(out.includes(`${flag} needs a value`), `names the flag, got: ${out}`);
      assert(!out.includes('TypeError'), `no stack trace, got: ${out}`);
    }
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a range git cannot read fails with a readable message', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub, ['--range', 'v9.9.9..HEAD']);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('cannot read the range'), `says so, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--dry-run reports the count and writes nothing', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) - Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const before = readLog(dir);
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--dry-run']);
    assert(out.includes('would fill 1'), `reports the count, got: ${out}`);
    assertEq(readLog(dir), before, 'file untouched');
    cleanup(dir); cleanup(stub.dir);
  });

  await test('--range limits which commits are considered', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) - Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4', 'chore: later work'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--range', 'HEAD~1..HEAD', '--dry-run']);
    assert(out.includes('nothing to fill in'), `the closing commit is outside the range, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a repo with no GitHub remote exits non-zero instead of writing a broken link', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('not a GitHub remote'), `says why, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  await test('a repo with no origin remote gets its own message', () => {
    // Distinct from "not a GitHub remote": the fix here is adding a remote,
    // not changing one.
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'remove', 'origin');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    assertEq(code, 1, 'exit 1');
    assert(out.includes('no origin remote'), `says so, got: ${out}`);
    assert(!out.includes('not a GitHub remote'), `not the wrong message, got: ${out}`);
    cleanup(dir); cleanup(stub.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
