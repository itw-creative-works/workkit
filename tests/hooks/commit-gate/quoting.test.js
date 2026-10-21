// Tests for hooks/safety/commit-gate: a quoted message never hides a pathspec;
// and hook_strip_quotes (hooks/lib/commit.sh), the strip that judgment reads.
// The shared prologue (the hook runner, the repo and marker factories, the fixtures) is ./helpers.js.

const path = require('path');
const fs = require('fs');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { skipWithoutDigest, mkRepo, stage, runHook, cleanup } = require('./helpers');
const { runLib } = require('../../lib/hook-lib');

// What hook_strip_quotes hands a caller, read the way every caller reads it:
// through a command substitution. The text rides in an env var, so no quoting
// stands between a fixture and the strip.
const strip = (text) => {
  const out = runLib('printf \'%s\' "$(hook_strip_quotes "$STRIP_IN")"', { STRIP_IN: text });
  assertEq(out.code, 0, `the strip runs clean, stderr: ${out.stderr}`);
  return out.stdout;
};

const run = async () => {
  skipWithoutDigest();

  group('commit-gate: a quoted message never hides a pathspec (issue #25)');

  await test('quoted and unquoted pathspec commits gate identically', () => {
    // Deleting the quoted message from the detection copy would leave -m to
    // consume the pathspec, so the file list would read empty and the gate
    // would skip every check, review and tests included.
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
    // Quoted spans are visible tokens, so a flag missing from the walk's skip
    // list would count its value as a file and gate a docs-only commit as code.
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

  group('hook_strip_quotes: a backslash outside quotes escapes one character, as in the shell');

  await test('an escaped double quote outside quotes opens no span: the backticks stay, the real span goes', () => {
    assertEq(strip("echo \\\"a `b` 'c d'"), 'echo \\\"a `b` _hookq_', 'only the single-quoted span is replaced');
  });

  await test('an escaped single quote outside quotes opens no span', () => {
    // The Names rule: a backslash and the character after it pass through, so
    // the quote that opens the real span is the one before `b`.
    assertEq(strip("echo \\' a 'b c'"), "echo \\' a _hookq_", 'the escaped quote is a literal');
  });

  await test('escaped double quotes and a backtick inside single quotes are all one span', () => {
    const command = "gh issue comment 3 --body 'say \\\"hi\\\" `foo` \\\"bye\\\"'";
    assertEq(strip(command), 'gh issue comment 3 --body _hookq_', 'the whole body is data');
  });

  await test('escapes inside double quotes are unchanged: the span is one placeholder', () => {
    assertEq(strip('"a \\"b\\" c"'), '_hookq_', 'the escaped quotes never close the span');
  });

  await test('after an escaped quote outside quotes, a wrapped commit is still found', () => {
    // The span walk must count spans the way the strip does, or the Nth
    // placeholder names the wrong span and the wrapped commit goes unseen.
    const commands = [
      "echo \\\" 'a b' ; echo \"c\" ; bash -c 'git commit -m x'",
      "echo \\\"a\\\" && sh -c \"git commit -m x\"",
      "echo \\' ; eval 'git commit -m y'",
      "echo it\\'s 'done' && bash -c 'git commit -m x'",
    ];
    for (const command of commands) {
      const out = runLib('hook_find_git_commit "$FIND_IN"; printf \'%s\' "$HOOK_WRAPPED_COMMIT"', { FIND_IN: command });
      assertEq(out.code, 0, `the finder runs clean, stderr: ${out.stderr}`);
      assertEq(out.stdout, '1', `wrapped commit found in: ${command}`);
    }
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
