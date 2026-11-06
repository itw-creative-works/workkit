// The one JavaScript line lexer of the kit: which spans of a line are strings,
// templates, regex literals or comments rather than code. `workkit tools`
// (test/tools.js) and safety:test-bar (hooks/mods/test-bar.js) read through it.

// A `/` opens a regex literal at the line's start, after an operator or an
// opener (an arrow's `>` included) or after a keyword that takes a value;
// anywhere else it divides.
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|await|void|yield|delete|throw|new))\s*$/;

/**
 * Whether the `/` at `i`, met outside any span, opens a regex literal rather
 * than dividing: the text before it decides.
 * @param {string} line the line
 * @param {number} i the index of the `/`
 * @returns {boolean}
 */
export const opensRegex = (line, i) => REGEX_AFTER.test(line.slice(0, i));

/**
 * The index of the unescaped `/` closing the regex literal opened at `i`, a
 * `/` inside a `[...]` class left alone; the line's length when it never
 * closes, since a regex never runs past its line.
 * @param {string} line the line
 * @param {number} i the index of the opening `/`
 * @returns {number}
 */
export const regexEnd = (line, i) => {
  let inClass = false;
  for (let j = i + 1; j < line.length; j += 1) {
    if (line[j] === '\\') j += 1;
    else if (line[j] === '[') inClass = true;
    else if (line[j] === ']') inClass = false;
    else if (line[j] === '/' && !inClass) return j;
  }
  return line.length;
};

/**
 * One line's spans that are not code, each with its delimiters inside it: a
 * `'...'`, `"..."` or backtick string (a template's `${}` counts as string), a
 * regex literal, a trailing `//` comment and a `/* *\/` comment. An escape in
 * code stays code. Only a template or a block comment runs past its line.
 * @param {string} line the line
 * @param {string} [open] what the line before left open: '', '`' or '/*'
 * @returns {{ spans: Array<{ start: number, end: number, comment: boolean }>, open: string }}
 *   the spans in order, `end` exclusive, and what this line leaves open
 */
export const lexLine = (line, open = '') => {
  const spans = [];
  let quote = open;
  let start = 0;
  const close = (end) => {
    spans.push({ start, end, comment: quote === '/*' });
    quote = '';
  };
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote === '/*') {
      if (c === '*' && line[i + 1] === '/') {
        i += 1;
        close(i + 1);
      }
    } else if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) close(i + 1);
    } else if (c === '\\') {
      i += 1;
    } else if (c === '/' && line[i + 1] === '/') {
      spans.push({ start: i, end: line.length, comment: true });
      return { spans, open: '' };
    } else if (c === '/' && line[i + 1] === '*') {
      [quote, start] = ['/*', i];
      i += 1;
    } else if (c === '/' && opensRegex(line, i)) {
      start = i;
      i = regexEnd(line, i);
      close(Math.min(i + 1, line.length));
    } else if (c === "'" || c === '"' || c === '`') {
      [quote, start] = [c, i];
    }
  }
  const left = quote;
  if (quote) close(line.length);
  return { spans, open: left === '`' || left === '/*' ? left : '' };
};
