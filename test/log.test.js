// Tests for the two indenters of packages/core/test/lib/log.js, which keep a quoted
// text and a case's own prints off column zero.

const { Writable } = require('stream');
const {
  describe, test, expect, indentRest, indentWriter,
} = require('./lib/harness');

describe('log: the indenters', () => {
  test('indentRest leaves a one-line text as it is and prefixes every later line of a three-line text', () => {
    expect(indentRest('only line'), 'a one-line text is unchanged').toBe('only line');
    expect(indentRest('first\nsecond\nthird'), 'every line after the first at the case indent').toBe('first\n    second\n    third');
  });

  test('indentWriter carries a line across chunks and indents each line once', () => {
    const written = [];
    const write = indentWriter((chunk) => written.push(chunk));
    for (const chunk of ['ab', 'c\nd', '\n']) write(chunk);
    expect(written.join(''), 'every line at the case indent, a split line once').toBe('    abc\n    d\n');
  });

  // A real stream calls a write's callback on a later tick, so one turn of the loop has run it.
  test('indentWriter writes a Buffer chunk indented and calls the callback passed with a chunk', async () => {
    const written = [];
    const sink = new Writable({ write(chunk, encoding, done) { written.push(String(chunk)); done(); } });
    const write = indentWriter(sink.write.bind(sink));
    let called = false;
    write(Buffer.from('one\ntwo\n'), () => { called = true; });
    await new Promise((resolve) => { setImmediate(resolve); });
    expect(written.join(''), 'the Buffer\'s lines at the case indent').toBe('    one\n    two\n');
    expect(called, 'the callback passed with the chunk was called').toBeTruthy();
  });

  test('indentWriter over a character split across two Buffer chunks writes it whole', () => {
    const written = [];
    const sink = new Writable({ write(chunk, encoding, done) { written.push(chunk); done(); } });
    const write = indentWriter(sink.write.bind(sink));
    write(Buffer.from([0xe2, 0x9c]));
    write(Buffer.from([0x93]));
    expect(Buffer.concat(written).toString(), 'the check mark at the case indent, its bytes whole').toBe('    ✓');
  });
});
