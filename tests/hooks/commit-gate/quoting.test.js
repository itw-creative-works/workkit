//
// Tests for hooks/safety/commit-gate: a quoted message never hides a pathspec (issue #25).
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.
//

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipWithoutDigest, mkRepo, stage, runHook, cleanup } = require('./helpers');

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: a quoted message never hides a pathspec (issue #25)');

  await test('quoted and unquoted pathspec commits gate identically', () => {
    // The quoted message used to be DELETED from the detection copy, leaving
    // -m to consume the pathspec, so the file list read as empty and the gate
    // skipped every check, review and tests included.
    for (const message of ['"docs"', 'docs']) {
      const dir = mkRepo();
      fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
      const { code, stderr } = runHook(dir, `git commit -m ${message} app.js`);
      assertEq(code, 2, `${message} form blocked, got: ${stderr}`);
      assert(stderr.includes('review'), `for the review reason, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a quoted message with nothing staged is still not a pathspec commit', () => {
    // The placeholder must not itself read as a file argument.
    const dir = mkRepo();
    const { code, stderr } = runHook(dir, 'git commit -m "just a message"');
    assertEq(code, 0, `allowed, got: ${stderr}`);
    cleanup(dir);
  });

  await test('a value-taking flag does not have its value read as a pathspec', () => {
    // Once quoted spans became visible tokens, any flag missing from the walk's
    // skip list had its value counted as a file, which forced a docs-only
    // commit to be gated as code and blocked for a missing review.
    for (const flag of ['--author "Jane Doe <j@d.c>"', '--date "2020-01-01"', '--trailer "Co-Authored-By: X <x@y.z>"']) {
      const dir = mkRepo();
      stage(dir, 'README.md', '# docs\n');
      const { code, stderr } = runHook(dir, `git commit -m "docs" ${flag}`);
      assertEq(code, 0, `${flag} allowed, got: ${stderr}`);
      cleanup(dir);
    }
  });

  await test('a short flag with its value attached does not swallow the pathspec', () => {
    // `-m"docs"` arrives as one token whose value is already attached, so it
    // must not consume the next token the way a bare `-m` does.
    const dir = mkRepo();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git commit -m"docs" app.js');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  await test('an empty quote pair spliced into the command still gates', () => {
    // Deleting an empty span rejoins the text around it; a placeholder would
    // not, and `git com""mit` is a real command that must stay detectable.
    const dir = mkRepo();
    stage(dir, 'app.js', 'const x = 1;\n');
    const { code, stderr } = runHook(dir, 'git com""mit -m "x"');
    assertEq(code, 2, `blocked, got: ${stderr}`);
    cleanup(dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
