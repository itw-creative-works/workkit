//
// The tower's voice (issue #237): a glyph per outcome, the `task:` in bold,
// nothing else on the line.
//
// One contract for everything this kit prints. `workflow/lib.sh` is the shell
// half and this is the Node one, and the two are meant to be indistinguishable
// in a scrollback: the same glyphs (`✓` acted, `·` nothing to do, `›` worth
// knowing, `⚠` needs judgment, `✖` stopping, `✨` all current), the same
// colors, and the same split of the first `word:` off the front of a message.
// The table both halves implement: workflow/README.md.
//
// Dependency-free by construction: the API process carries no node_modules at
// all, so chalk is out and the escapes are written by hand.
//
// Usage:
//   const { createLogger } = require('./log');
//   const log = createLogger();
//   log.ok('listening on http://127.0.0.1:8693');
//   log.warn('board: the sweep was dropped');
//

// The escapes, one home. `RESET` closes every one of them.
const RESET = '\u001b[0m';
const GREEN = '\u001b[0;32m';
const YELLOW = '\u001b[0;33m';
const RED = '\u001b[0;31m';
const CYAN = '\u001b[0;36m';
const DIM = '\u001b[0;90m';
const BOLD = '\u001b[1m';

// Color is a TERMINAL's affordance and nothing else's, and this is
// `wk_color_on`'s rule leg for leg (workflow/lib.sh): a pipe, a log file and a
// service manager all get the same words uncolored. Three ways to say no, every
// one of them final: WORKKIT_COLOR=0, NO_COLOR (https://no-color.org), or a
// TERM that cannot render any of it. WORKKIT_COLOR=1 is the yes a piped run (a
// test, a `tee`) uses to read the styled shape back, and it stands in for a
// terminal and for nothing else, so a machine that asked for no color never
// gets some anyway.
function colorOn(stream) {
  if (process.env.WORKKIT_COLOR === '0') { return false; }
  if (process.env.NO_COLOR) { return false; }
  if (process.env.TERM === 'dumb') { return false; }
  if (process.env.WORKKIT_COLOR === '1') { return true; }
  return Boolean(stream && stream.isTTY);
}

function paint(text, code, on) {
  return on && code ? `${code}${text}${RESET}` : text;
}

// The `task:` split, the shell half's rule character for character: a message
// that opens `<word>: <rest>` has that word painted and the rest left to the
// level's own color. One lowercase word only, so a message whose opening clause
// happens to carry a colon prints exactly as it was written.
function split(message) {
  const match = /^([a-z][^\s:]*): ([\s\S]*)$/.exec(String(message));
  return match ? { task: match[1], rest: match[2] } : { task: '', rest: String(message) };
}

/**
 * The tower's logger. No module and no timestamp ride the line: what a reader
 * wants from a tower line is what happened, and the process it happened in is
 * the terminal they started.
 *
 * @returns {{ ok: Function, skip: Function, info: Function, warn: Function, error: Function, section: Function, done: Function }}
 */
function createLogger() {
  // Through `console`, the way the rest of this process prints: the methods
  // already route log/info to stdout and warn/error to stderr, and a caller
  // that swaps one out (a test reading what the machine was told) keeps working.
  const emit = (method, stream, glyph, glyphColor, taskColor, messageColor, message) => {
    const on = colorOn(stream);
    const { task, rest } = split(message);
    const head = paint(glyph, glyphColor, on);
    const body = task
      ? `${paint(`${task}:`, taskColor, on)} ${paint(rest, messageColor, on)}`
      : paint(rest, messageColor, on);
    // eslint-disable-next-line no-console
    console[method](`${head} ${body}`);
  };

  return {
    ok: (message) => emit('log', process.stdout, '✓', `${BOLD}${GREEN}`, BOLD, '', message),
    skip: (message) => emit('log', process.stdout, '·', DIM, DIM, DIM, message),
    info: (message) => emit('info', process.stdout, '›', CYAN, BOLD, '', message),
    warn: (message) => emit('warn', process.stderr, '⚠', YELLOW, `${BOLD}${YELLOW}`, YELLOW, message),
    error: (message) => emit('error', process.stderr, '✖', RED, `${BOLD}${RED}`, RED, message),
    // A run of steps under one title: a blank line, then the title in bold
    // cyan, carrying the emoji the caller chose for what those steps do.
    section: (message) => {
      const on = colorOn(process.stdout);
      // eslint-disable-next-line no-console
      console.log(`\n${paint(String(message), `${BOLD}${CYAN}`, on)}`);
    },
    // The closing line: everything this part of the kit can see is current.
    done: (message) => {
      const on = colorOn(process.stdout);
      // eslint-disable-next-line no-console
      console.log(paint(`✨ ${String(message)}`, `${BOLD}${GREEN}`, on));
    },
  };
}

module.exports = { createLogger };
