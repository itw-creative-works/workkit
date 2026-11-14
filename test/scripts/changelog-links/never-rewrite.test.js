// Tests for workflow/changelog/changelog-links.js, the release-time CHANGELOG backfill:
// what it must never rewrite, and the refusals that stop it writing at all.
// The shared prologue is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { skipWithoutNodeStub } = require('../../lib/platform');
const {
  cleanup, git, makeGhStub, CHANGELOG, mkRepo, runScript, readLog,
} = require('./helpers');

describe('changelog-links: what it must never rewrite', { skip: skipWithoutNodeStub() }, () => {
  // A wrong link written into the file is permanent, so each shape is pinned.

  test('an example bullet inside a fenced block is left alone', () => {
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
    expect(readLog(dir).includes(fenced), 'the documented example is not an entry').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a Contributors heading inside a fenced example does not truncate the file', () => {
    // The rebuild cuts the file at the Contributors heading and re-emits the
    // tail, so the heading is only this section's when the whole remainder has
    // this section's shape; a fenced example above it is not.
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
    expect(text.includes('## [1.0.0] - 2020-01-01'), `the released section survives, got: ${text}`).toBeTruthy();
    expect(text.includes('- (no issue) - The first release.'), 'its entry survives').toBeTruthy();
    expect((text.match(/```/g) || []).length, 'the fence is still closed').toBe(2);
    cleanup(dir); cleanup(stub.dir);
  });

  test('a trailing rule that is not part of the section is kept', () => {
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
    expect((text.match(/^---$/gm) || []).length, `the original rule plus the section's, got: ${text}`).toBe(2);
    cleanup(dir); cleanup(stub.dir);
  });

  test('an entry in an already-released section is left alone', () => {
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
    expect(readLog(dir).includes(old), 'history is not rewritten').toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('an entry whose issue has no closing commit is named, not passed in silence', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#99](https://github.com/o/r/issues/99) - Nothing closes this one.'),
      ['feat: unrelated work with no trailer'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub);
    expect(out.includes('#99 has no closing commit'), `reports it, got: ${out}`).toBeTruthy();
    expect(out.includes('Fixes #99'), `says how to fix it, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a flag with no value is a usage error, not a stack trace', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    for (const flag of ['--file', '--range']) {
      const { code, out } = runScript(dir, stub, [flag]);
      expect(code, `${flag} exits 2`).toBe(2);
      expect(out.includes(`${flag} needs a value`), `names the flag, got: ${out}`).toBeTruthy();
      expect(!out.includes('TypeError'), `no stack trace, got: ${out}`).toBeTruthy();
    }
    cleanup(dir); cleanup(stub.dir);
  });

  test('a range git cannot read fails with a readable message', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub, ['--range', 'v9.9.9..HEAD']);
    expect(code, 'exit 1').toBe(1);
    expect(out.includes('cannot read the range'), `says so, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('--dry-run reports the count and writes nothing', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) - Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4'],
    );
    const before = readLog(dir);
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--dry-run']);
    expect(out.includes('would fill 1'), `reports the count, got: ${out}`).toBeTruthy();
    expect(readLog(dir), 'file untouched').toBe(before);
    cleanup(dir); cleanup(stub.dir);
  });

  test('--range limits which commits are considered', () => {
    const { dir } = mkRepo(
      CHANGELOG('- [#4](https://github.com/o/r/issues/4) - Plugins install from settings.json.'),
      ['refactor: x\n\nFixes #4', 'chore: later work'],
    );
    const stub = makeGhStub();
    const { out } = runScript(dir, stub, ['--range', 'HEAD~1..HEAD', '--dry-run']);
    expect(out.includes('nothing to fill in'), `the closing commit is outside the range, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a repo with no GitHub remote exits non-zero instead of writing a broken link', () => {
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    expect(code, 'exit 1').toBe(1);
    expect(out.includes('not a GitHub remote'), `says why, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });

  test('a repo with no origin remote gets its own message', () => {
    // Distinct from "not a GitHub remote": the fix here is adding a remote,
    // not changing one.
    const { dir } = mkRepo(CHANGELOG('- [#4](x) - Text.'), ['feat: x\n\nFixes #4']);
    git(dir, 'remote', 'remove', 'origin');
    const stub = makeGhStub();
    const { code, out } = runScript(dir, stub);
    expect(code, 'exit 1').toBe(1);
    expect(out.includes('no origin remote'), `says so, got: ${out}`).toBeTruthy();
    expect(!out.includes('not a GitHub remote'), `not the wrong message, got: ${out}`).toBeTruthy();
    cleanup(dir); cleanup(stub.dir);
  });
});
