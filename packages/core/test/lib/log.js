// Keeping printed text off column zero under a case's mark: the case indent,
// a quoted text's later lines indented, and a writer indenting every line.

import { StringDecoder } from 'node:string_decoder';

// The indent of every line the runner prints under a case's mark.
export const CASE_INDENT = '    ';

/** The text with every line after the first prefixed by `indent`, so a quoted text never reaches column zero. */
export const indentRest = (text, indent = CASE_INDENT) => String(text).split('\n').join(`\n${indent}`);

/** A writer passing each chunk (a Buffer decoded by the writer's one StringDecoder) to `write` with CASE_INDENT at the start of every line, a line split across chunks included, its other arguments as given. */
export const indentWriter = (write) => {
  let atLineStart = true;
  const decoder = new StringDecoder('utf8');
  return (chunk, ...rest) => {
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk);
    const out = text.replace(/[^\n]+/g, (line, at) => (at > 0 || atLineStart ? `${CASE_INDENT}${line}` : line));
    if (text) atLineStart = text.endsWith('\n');
    return write(out, ...rest);
  };
};
