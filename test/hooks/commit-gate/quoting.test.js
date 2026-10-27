// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: a quoted message never hides a pathspec; and the
// quote strip that judgment reads, stripQuotes and findGitCommit in
// hooks/mods/command.js, the port of hook_strip_quotes and
// hook_find_git_commit. Each case ports the HEAD case its name quotes.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const {
  T, mkRepo, stage, write, judge, blocks, passes,
} = require('./helpers');

const strip = (text) => mods('command').stripQuotes(text);

const cases = async () => {
  group('commit-gate: a quoted message never hides a pathspec (issue #25)');

  await test('ports "quoted and unquoted pathspec commits gate identically"', async () => {
    for (const message of ['"docs"', 'docs']) {
      const r = mkRepo();
      write(r, 'app.js', 'const x = 1;\n');
      blocks(await judge(r, `git commit -m ${message} app.js`), T.noReview, `${message} form blocked for the review reason`);
    }
  });

  await test('ports "a value-taking flag does not have its value read as a pathspec"', async () => {
    for (const flag of ['--author "Jane Doe <j@d.c>"', '--date "2020-01-01"', '--trailer "Co-Authored-By: X <x@y.z>"']) {
      const r = mkRepo();
      stage(r, 'README.md', '# docs\n');
      passes(await judge(r, `git commit -m "docs" ${flag}`), '', `${flag} allowed`);
    }
  });

  await test('ports "a short flag with its value attached does not swallow the pathspec"', async () => {
    const r = mkRepo();
    write(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git commit -m"docs" app.js'), T.noReview, 'the attached value consumes nothing');
  });

  await test('ports "an empty quote pair spliced into the command still gates"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git com""mit -m "x"'), T.noReview, '`git com""mit` is a real commit');
  });

  group('stripQuotes: a backslash outside quotes escapes one character, as in the shell');

  await test('ports "an escaped double quote outside quotes opens no span: the backticks stay, the real span goes"', () => {
    assertEq(strip("echo \\\"a `b` 'c d'"), 'echo \\"a `b` _hookq_', 'only the single-quoted span is replaced');
  });

  await test('ports "an escaped single quote outside quotes opens no span"', () => {
    assertEq(strip("echo \\' a 'b c'"), "echo \\' a _hookq_", 'the escaped quote is a literal');
  });

  await test('ports "escaped double quotes and a backtick inside single quotes are all one span"', () => {
    assertEq(strip("gh issue comment 3 --body 'say \\\"hi\\\" `foo` \\\"bye\\\"'"), 'gh issue comment 3 --body _hookq_', 'the whole body is data');
  });

  await test('ports "escapes inside double quotes are unchanged: the span is one placeholder"', () => {
    assertEq(strip('"a \\"b\\" c"'), '_hookq_', 'the escaped quotes never close the span');
  });

  await test('ports "after an escaped quote outside quotes, a wrapped commit is still found"', () => {
    for (const command of [
      "echo \\\" 'a b' ; echo \"c\" ; bash -c 'git commit -m x'",
      "echo \\\"a\\\" && sh -c \"git commit -m x\"",
      "echo \\' ; eval 'git commit -m y'",
      "echo it\\'s 'done' && bash -c 'git commit -m x'",
    ]) {
      assertEq(mods('command').findGitCommit(command).wrapped, true, `wrapped commit found in: ${command}`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
