// Tests for packages/core/test/lib/lexer.js, the line lexer `workkit tools`,
// `workkit convert` and safety:test-bar read through: which `/` divides and
// which opens a regex literal, seen in the text maskSpans leaves.

const path = require('path');
const { describe, test, expect } = require('./lib/harness');

const { maskSpans } = require(path.join(__dirname, '..', 'packages', 'core', 'test', 'lib', 'lexer.js'));

// Each line masked alone, a comment to `_` and a string, template or regex to `#`.
const masked = (lines) => lines.map((line) => maskSpans(line, { comment: '_', literal: '#' }).code);

describe('lexer: a / after a postfix step', () => {
  test('a / after a postfix ++ divides, so the rest of its line stays code', () => {
    expect(masked([
      "i++ / 2; needs('x')",
      "i++/2; needs('x')",
      "a[0]++ / 2; needs('x')",
    ])).toEqual([
      'i++ / 2; needs(###)',
      'i++/2; needs(###)',
      'a[0]++ / 2; needs(###)',
    ]);
  });

  test('a / after a postfix -- divides, so the rest of its line stays code', () => {
    expect(masked([
      "i-- / 2; needs('x')",
      "i--/2; needs('x')",
      "a[0]-- / 2; needs('x')",
    ])).toEqual([
      'i-- / 2; needs(###)',
      'i--/2; needs(###)',
      'a[0]-- / 2; needs(###)',
    ]);
  });

  test('a / after =, after (, after a binary + that follows a postfix ++ and after a prefix ++ still opens a regex literal', () => {
    expect(masked([
      "const re = /a'b/; needs('x')",
      "f( /a'b/); needs('x')",
      "x = a++ + /a'b/.source; needs('x')",
      "x = ++/a'b/.lastIndex; needs(\"x\")",
      "return ++/a'b/.lastIndex; needs(\"x\")",
      "typeof ++/a'b/.lastIndex; needs(\"x\")",
    ])).toEqual([
      'const re = #####; needs(###)',
      'f( #####); needs(###)',
      'x = a++ + #####.source; needs(###)',
      'x = ++#####.lastIndex; needs(###)',
      'return ++#####.lastIndex; needs(###)',
      'typeof ++#####.lastIndex; needs(###)',
    ]);
  });
});
