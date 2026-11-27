// Tests for the levels of workflow/lib/voice.js: the one home of everything the
// engine, the jobs and the tower say to a person. Every case reads the bytes a
// real node printed (test/lib/speak.js); WORKKIT_COLOR lets a pipe read the
// styled shape back, and nothing else is stubbed. The spinner is test/scripts/spin.test.js's.

const { describe, test, expect } = require('../lib/harness');
const { speak } = require('../lib/speak');

const ESCAPE = '\u001b';
// A real TERM, so an escape that reaches a pipe here is the color gate's doing
// rather than the dumb-TERM check answering for it.
const TERM = 'xterm-256color';

describe('voice: the color gate', () => {
  test('NO_COLOR beats the seam that asked for color', () => {
    const { stdout: out, stderr: err } = speak(["v.ok('engine: linked');", "v.warn('gh: careful');"],
      { TERM, WORKKIT_COLOR: '1', NO_COLOR: '1' });
    expect(!`${out}${err}`.includes(ESCAPE), `nothing is styled, got: ${JSON.stringify(out + err)}`).toBeTruthy();
    expect(out, `and the words are the same, got: ${JSON.stringify(out)}`).toBe('✓ engine: linked\n');
  });
});

describe('voice: plain', () => {
  test('a relayed line loses the indent and the glyph it arrived with, and nothing else', () => {
    const { stdout: out } = speak([
      "process.stdout.write(v.plain('  ✓ engine: linked a → b\\n· engine: current\\nplain line\\n'));",
    ], { TERM });
    expect(out, `only the opening goes, got: ${JSON.stringify(out)}`).toBe('engine: linked a → b\nengine: current\nplain line\n');
  });
});
