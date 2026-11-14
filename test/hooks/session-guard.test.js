// Tests for docs:session-guard's logic, sessionGuardVerdict(path, text) in
// hooks/mods/session-guard.js: `.workkit/agents/session.md` held to the shape
// of a queue, short bullets and few lines. The wiring cases are
// test/mods/post-tool-use.test.ts.

const { describe, test, expect, WORKKIT_DIR: W } = require('../lib/harness');
const { mods, textOf, sessionFacts } = require('../lib/mods-inputs');

const SESSION = `/w/repo/${W}/agents/session.md`;
const verdict = (text, file = SESSION) => textOf(mods('session-guard').sessionGuardVerdict(file, text));

/** The template's shape, with `bullets` as its Active entries. */
const doc = (bullets) => ['# Session', '', '## Active', ...bullets, '', '## Queue', '', '## Notes', ''].join('\n');
const notes = (n) => Array.from({ length: n }, (_, i) => `- #${i}: a queued entry.`);

describe('session-guard: the line cap', () => {
  test('a session.md left over 40 content lines is bounced, count named', () => {
    const out = verdict(doc(notes(45)));
    expect(out.includes('45 content lines'), `names the count, got: ${out}`).toBeTruthy();
    expect(out.includes('40'), `names the cap, got: ${out}`).toBeTruthy();
    expect(/queue, not a journal/.test(out), `says what the file is, got: ${out}`).toBeTruthy();
  });

  test('a C:\\ spelled session.md gets the verdict the / spelling gets', () => {
    const file = `C:\\Users\\ian\\repo\\${W}\\agents\\session.md`;
    // The bounce names the file, so the two are compared with that name taken out.
    const unnamed = (out) => out.replace(/^session-guard: \S+/, 'session-guard: <file>');
    expect(unnamed(verdict(doc(notes(45)), file)), 'over the cap, the same bounce').toBe(unnamed(verdict(doc(notes(45)))));
    expect(verdict(doc(notes(45)), file).includes('45 content lines'), 'and it is a bounce').toBeTruthy();
  });

  test('at the cap there is no bounce', () => {
    expect(verdict(doc(notes(40))), 'silent').toBe('');
  });

  // Exactly 40 content lines beside the scaffolding: any scaffolding line
  // wrongly counted makes 41 and bounces.
  test('headings, blockquotes, comments and blank lines do not count', () => {
    const text = [
      '# Session', '', '<!-- a seeded note about what this file is for -->', '', '## Active', ...notes(40), '',
      '## Queue', '', '> This file is a queue, not a journal.', '', '### A sub-heading', '', '## Notes', '',
    ].join('\n');
    expect(verdict(text), 'scaffolding is not content').toBe('');
  });
});

describe('session-guard: the bullet cap', () => {
  test('a bullet over 350 chars is bounced, with its length and its head', () => {
    const long = `- #126 the entry that would not stop ${'x'.repeat(400)}`;
    const out = verdict(doc([long, '- #12: a short one.']));
    expect(out.includes(`${long.length} chars`), `names the length ${long.length}, got: ${out}`).toBeTruthy();
    expect(out.includes('350'), `names the cap, got: ${out}`).toBeTruthy();
    expect(out.includes('#126 the entry that would not stop'), `names the offending bullet, got: ${out}`).toBeTruthy();
  });

  test('a bullet at 350 chars passes', () => {
    const at = `- ${'x'.repeat(348)}`;
    expect(at.length, 'the fixture is exactly at the cap').toBe(350);
    expect(verdict(doc([at])), 'at the cap passes').toBe('');
  });

  test('an indented `*` bullet is judged too', () => {
    expect(verdict(doc([`  * ${'y'.repeat(400)}`])).length > 0, 'blocks').toBeTruthy();
  });

  test('a long line that is not a bullet is not judged as one', () => {
    expect(verdict(doc([`#126 ${'z'.repeat(400)}`])), 'not a bullet').toBe('');
  });
});

describe('session-guard: scope', () => {
  test('another file in .workkit/agents is ignored, however long', () => {
    expect(verdict(doc(notes(60)), `/w/repo/${W}/agents/notes.md`), 'only session.md').toBe('');
  });

  test('a session.md outside .workkit/agents is ignored, however long', () => {
    expect(verdict(doc(notes(60)), '/w/repo/docs/session.md'), 'only the agents folder').toBe('');
  });

  // docs:session warns past the same bar from the same constants: the scaffolding
  // fixture is 40 content lines to both, and one more is 41 to both.
  test('the caps and the content-line regex agree with the docs:session hook: its NOTE bar and this bounce agree', () => {
    const note = (text) => (mods('session').sessionContext(sessionFacts({ state: text })).context || '')
      .split('\n').some((l) => l.startsWith('NOTE:'));
    const lines = [
      '# Session', '  ## indented heading', '> quote', '   > indented quote', '<!-- note -->', '  <!-- indented -->',
      '', '   ', '\t', ...notes(40),
    ];
    expect(verdict(lines.join('\n')), 'the guard counts 40: at the cap').toBe('');
    expect(note(lines.join('\n')), 'docs:session counts 40: no NOTE').toBe(false);
    const over = [...lines, '- #41: one more.'].join('\n');
    expect(verdict(over).includes('41 content lines'), `one more is 41 to the guard, got: ${verdict(over)}`).toBeTruthy();
    expect(note(over), 'and 41 to docs:session').toBe(true);
    const bullet = `- ${'x'.repeat(349)}`;
    expect(verdict(doc([bullet])).includes('351 chars'), "the guard's bullet cap is 350").toBeTruthy();
  });
});
