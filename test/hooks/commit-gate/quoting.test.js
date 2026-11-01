// Tests for the quote strip the Bash guards read, stripQuotes in
// hooks/mods/command.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');

const strip = (text) => mods('command').stripQuotes(text);

const cases = async () => {
  group('stripQuotes: a backslash outside quotes escapes one character, as in the shell');

  await test('an escaped double quote outside quotes opens no span: the backticks stay, the real span goes', () => {
    assertEq(strip("echo \\\"a `b` 'c d'"), 'echo \\"a `b` _hookq_', 'only the single-quoted span is replaced');
  });

  await test('an escaped single quote outside quotes opens no span', () => {
    assertEq(strip("echo \\' a 'b c'"), "echo \\' a _hookq_", 'the escaped quote is a literal');
  });

  await test('escaped double quotes and a backtick inside single quotes are all one span', () => {
    assertEq(strip("gh issue comment 3 --body 'say \\\"hi\\\" `foo` \\\"bye\\\"'"), 'gh issue comment 3 --body _hookq_', 'the whole body is data');
  });

  await test('escapes inside double quotes are unchanged: the span is one placeholder', () => {
    assertEq(strip('"a \\"b\\" c"'), '_hookq_', 'the escaped quotes never close the span');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
