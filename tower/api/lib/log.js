// The tower's voice: a glyph per outcome, the `task:` in bold, nothing else on
// the line. Each line is workflow/lib/voice.js's, the kit's one voice
// (workflow/README.md § Output): its color gate, palette, levels and `task:` split.
//
// Usage:
//   const log = createLogger();
//   log.ok('listening on http://127.0.0.1:8693');

const {
  colorOn, paint, said, PALETTE,
} = require('../../../workflow/lib/voice');

const { GREEN, CYAN, BOLD } = PALETTE;

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
  const emit = (method, stream, level, message) => {
    // eslint-disable-next-line no-console
    console[method](said(level, message, colorOn(stream)));
  };

  return {
    ok: (message) => emit('log', process.stdout, 'ok', message),
    skip: (message) => emit('log', process.stdout, 'skip', message),
    info: (message) => emit('info', process.stdout, 'info', message),
    warn: (message) => emit('warn', process.stderr, 'warn', message),
    error: (message) => emit('error', process.stderr, 'error', message),
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
