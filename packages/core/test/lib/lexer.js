// The one JavaScript line lexer of the kit: which spans of a line are strings,
// templates, regex literals or comments rather than code. `workkit tools`
// (test/tools.js), `workkit convert` (lib/convert-read.js) and safety:test-bar
// (hooks/mods/test-bar.js) read through it.

// A `/` opens a regex literal at the line's start, after an operator or an
// opener (an arrow's `>` included) or after a keyword that takes a value;
// anywhere else it divides.
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|await|void|yield|delete|throw|new))\s*$/;

// A `++` or `--` ending the text: postfix when no regex could start before
// it, and a `/` after a postfix step divides.
const STEP_AT_END = /(?:\+\+|--)\s*$/;

/**
 * Whether the `/` at `i`, met outside any span, opens a regex literal rather
 * than dividing: the text before it decides.
 * @param {string} line the line
 * @param {number} i the index of the `/`
 * @returns {boolean}
 */
export const opensRegex = (line, i) => {
  const before = line.slice(0, i);
  const step = before.match(STEP_AT_END);
  if (step && !REGEX_AFTER.test(before.slice(0, step.index))) return false;
  return REGEX_AFTER.test(before);
};

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

/**
 * The index of the first backtick inside a template's `${}` placeholder, or
 * -1 when there is none: a nested template, or a backtick in a string,
 * comment or regex there. `lexLine` reads a placeholder as template text, so
 * any such backtick ends its template early; this reads a placeholder as
 * code, with its own strings, comments, regex literals and braces.
 * @param {string} text the source
 * @returns {number}
 */
export const nestedTemplateAt = (text) => {
  // 'code', 'template', or 'hole' (a placeholder's code, `depth` braces deep).
  let mode = 'code';
  let depth = 0;
  // The end of a string, comment or regex from `from` to `to`, or the
  // backtick inside it when it sits in a placeholder.
  const skipped = (from, to) => {
    const tick = mode === 'hole' ? text.slice(from, to).indexOf('`') : -1;
    return tick === -1 ? { end: to } : { tick: from + tick };
  };
  const lineEnd = (at) => (text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at));
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (mode === 'template') {
      if (c === '\\') i += 1;
      else if (c === '`') mode = 'code';
      else if (c === '$' && text[i + 1] === '{') [mode, depth, i] = ['hole', 1, i + 1];
      continue;
    }
    const lineStart = c === '/' ? text.lastIndexOf('\n', i - 1) + 1 : 0;
    let span = null;
    if (c === '`') {
      if (mode === 'hole') return i;
      mode = 'template';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== c && text[j] !== '\n'; j += 1) if (text[j] === '\\') j += 1;
      span = skipped(i, j);
    } else if (c === '/' && text[i + 1] === '/') {
      span = skipped(i, lineEnd(i) - 1);
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      span = skipped(i, close === -1 ? text.length : close + 1);
    } else if (c === '/' && opensRegex(text.slice(lineStart, i + 1), i - lineStart)) {
      span = skipped(i, lineStart + regexEnd(text.slice(lineStart, lineEnd(i)), i - lineStart));
    } else if (mode === 'hole' && c === '{') {
      depth += 1;
    } else if (mode === 'hole' && c === '}') {
      depth -= 1;
      if (depth === 0) mode = 'template';
    }
    if (span?.tick !== undefined) return span.tick;
    if (span) i = span.end;
  }
  return -1;
};

/**
 * A whole text with each span `lexLine` finds filled, newlines kept, so an
 * index in the result is the same index in the text: a comment with
 * `fill.comment`, a string, template or regex with `fill.literal`, each one
 * character repeated, a null fill keeping that kind as it is.
 * @param {string} text the source
 * @param {{ comment: string | null, literal: string | null }} fill the character per span kind, or null
 * @returns {{ code: string, inTemplate: boolean[] }} the filled text, and for
 *   each line whether a template was open at its start
 */
export const maskSpans = (text, fill) => {
  let open = '';
  const inTemplate = [];
  const code = text.split('\n').map((line) => {
    inTemplate.push(open === '`');
    const lexed = lexLine(line, open);
    open = lexed.open;
    let out = line;
    for (const { start, end, comment } of lexed.spans) {
      const char = comment ? fill.comment : fill.literal;
      if (char !== null) out = `${out.slice(0, start)}${char.repeat(end - start)}${out.slice(end)}`;
    }
    return out;
  }).join('\n');
  return { code, inTemplate };
};
