// The painter: the runner's plain lines colored by how each starts after its
// indent, by Node's own rule for the stream (`util.styleText`). Run as a
// script, the filter a terminal view pipes a plain log through: standard input
// to standard output, each whole line painted once its line end arrives.

import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

// The totals line a run ends on, and a describe path's heading.
const TOTALS = /^\d+ passed, \d+ failed\b/;
const HEADING = /^\[.*\]$/s;
// A line's indent, its body and a trailing CR, each kept apart.
const PARTS = /^([ \t]*)(.*?)(\r?)$/s;

// Node's util, loaded only once NO_COLOR is ruled out: loading it under both
// NO_COLOR and FORCE_COLOR prints Node's warning that NO_COLOR is ignored.
const styleText = (...args) => process.getBuiltinModule('node:util').styleText(...args);

// One line, its indent and a trailing CR left as they are.
const paintLine = (line, stream) => {
  const [, indent, body, cr] = line.match(PARTS);
  const style = (format, text) => styleText(format, text, { stream });
  let painted = body;
  if (body.startsWith('✓')) painted = `${style('green', '✓')}${body.slice(1)}`;
  else if (body.startsWith('✗')) painted = style('red', body);
  else if (body.startsWith('⊘') || body.startsWith('slowest:')) painted = style('gray', body);
  else if (body.startsWith('▶') || body.startsWith('Failures:') || HEADING.test(body) || TOTALS.test(body)) painted = style('bold', body);
  return `${indent}${painted}${cr}`;
};

/**
 * <text> with each line colored by how it starts, after its indent: a `✓`
 * mark green, a `✗` line red, a `⊘` or `slowest:` line gray, a `▶`, a
 * `[outer › inner]` heading, the totals line and `Failures:` bold. Any other
 * line is left byte for byte.
 * @param {string} text
 * @param {NodeJS.WritableStream} stream where it goes: color only when it takes color by Node's rule
 * @returns {string} the painted text, or <text> itself for a stream that takes no color
 */
export const paint = (text, stream) => {
  // NO_COLOR wins over FORCE_COLOR here, where Node's own rule lets FORCE_COLOR win.
  if (process.env.NO_COLOR) return text;
  if (styleText('bold', 'x', { stream }) === 'x') return text;
  return text.split('\n').map((line) => paintLine(line, stream)).join('\n');
};

// Whether this file is the script node was started with, by real path rather
// than import.meta.main, which the shell's node floor (WK_NODE_FLOOR) predates.
// An argument that names no file (`node -e ... x`) is no script of ours.
const isScript = () => {
  try {
    return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(import.meta.filename);
  } catch {
    return false;
  }
};

// The filter: a line split across chunks waits for its end; what follows the
// last line end is written when the input ends.
if (isScript()) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  process.stdin.on('data', (chunk) => {
    const text = rest + decoder.write(chunk);
    const end = text.lastIndexOf('\n') + 1;
    rest = text.slice(end);
    if (end > 0) process.stdout.write(paint(text.slice(0, end), process.stdout));
  });
  process.stdin.on('end', () => {
    const last = rest + decoder.end();
    if (last !== '') process.stdout.write(paint(last, process.stdout));
  });
}
