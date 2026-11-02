/* eslint-disable no-console */
// A case's own log: lines a case writes as it runs, held in the one slot the
// running case owns, which the harness drains as the case ends and prints under
// a failure (and under a pass with TEST_LOG=1). A line written with no case
// running prints at once, indented as a case's lines are.

import util from 'node:util';
import { StringDecoder } from 'node:string_decoder';

// The indent of every line the harness prints under a case's mark.
export const CASE_INDENT = '    ';

// The running case's lines, null while no case runs.
let current = null;

/** Log one line: the parts joined by spaces, a non-string inspected as console.log shows it. */
export const log = (...parts) => {
  const line = parts.map((part) => (typeof part === 'string' ? part : util.inspect(part))).join(' ');
  if (current) current.push(line);
  else console.log(`${CASE_INDENT}${indentRest(line)}`);
};

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

/** Open the slot of a case starting to run. */
export const openCase = () => {
  current = [];
};

/** The running case's lines, in the order written; the slot is closed after. */
export const drain = () => {
  const lines = current ?? [];
  current = null;
  return lines;
};
