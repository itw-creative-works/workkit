// Tests for safety:test-reminder's logic, testReminderContext(facts, seen)
// in hooks/mods/test-reminder.js: whether a written code file that no test
// names gets its one line. The facts' shape is test/lib/mods-inputs.js's.
// The per-session and wiring cases are test/mods/post-tool-use.test.ts.

const { describe, test, expect } = require('../lib/harness');
const {
  mods, textOf, reminderFacts, REMINDER_ROOT,
} = require('../lib/mods-inputs');

// `seen` is given repo-relative; the function takes `${root}/${rel}` strings.
const ask = (rel, files, seen = []) => textOf(mods('test-reminder').testReminderContext(
  reminderFacts(rel, files), seen.map((s) => `${REMINDER_ROOT}/${s}`),
));

// The one line, checked as the HEAD suite checked it.
const reminder = (out, file) => {
  expect(out.startsWith(`${file} has no test naming it.`), `names the repo-relative path, got: ${out}`).toBeTruthy();
  expect(out.includes('If not, say why in the Proof: line.'), `points at the Proof: line, got: ${out}`).toBeTruthy();
};

describe('test-reminder: a test naming the file keeps it silent', () => {
  test('a test naming the file by its basename: silent', () => {
    expect(ask('lib/thing.js', { 'lib/thing.js': 'module.exports = 1;\n', 'tests/thing.test.js': '// covers thing.js\n' }), 'the test names it').toBe('');
  });

  test('a test naming the file only through a require path: silent', () => {
    expect(ask('lib/thing.js', { 'lib/thing.js': 'module.exports = 1;\n', 'tests/unit.test.js': "const thing = require('../lib/thing');\n" }), 'the require path names it').toBe('');
  });
});

describe('test-reminder: a file no test names gets one line, once per session', () => {
  test('a test naming only index.json does not silence index.js: the line', () => {
    reminder(ask('lib/index.js', { 'lib/index.js': 'module.exports = 1;\n', 'tests/data.test.js': "const data = require('../lib/index.json');\n" }), 'lib/index.js');
  });

  test('a test naming index.js as a whole word: silent', () => {
    expect(ask('lib/index.js', { 'lib/index.js': 'module.exports = 1;\n', 'tests/index.test.js': '// covers index.js\n' }), 'the whole word names it').toBe('');
  });

  test('a basename shared by two tracked files is named by its parent too', () => {
    const files = { 'a/run.sh': 'echo a\n', 'b/run.sh': 'echo b\n', 'tests/run.test.js': '// covers a/run.sh\n' };
    reminder(ask('b/run.sh', files), 'b/run.sh');
    expect(ask('a/run.sh', files), 'the two-segment tail names it').toBe('');
  });

  test('the same file again in the same session: silent (the seen list holds it)', () => {
    expect(ask('lib/thing.js', { 'lib/thing.js': 'module.exports = 1;\n' }, ['lib/thing.js']), 'asked once per session').toBe('');
  });
});

describe('test-reminder: only code outside a test folder is asked about', () => {
  for (const [why, file] of [
    ['a test file itself', 'tests/thing.test.js'],
    ['a helper under a test folder', 'tests/helpers.js'],
    ['a markdown file', 'README.md'],
    ['a config file', 'eslint.config.js'],
    ['a file under _attic/', '_attic/old.js'],
  ]) {
    test(`${why}: silent`, () => {
      expect(ask(file, { [file]: 'x\n' }), why).toBe('');
    });
  }
});
