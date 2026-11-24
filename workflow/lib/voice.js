/**
 * workflow/lib/voice.js: the kit's Node voice, the Node half of
 * workflow/lib/voice.sh (workflow/README.md § Output): the color gate, the
 * palette, each level's glyph and colors and the line they make, the four
 * levels, a tool's lines warned one by one, and a wait's one line. The tower's
 * logger builds its lines here too. Every variable is read at the call.
 * Usage: const { ok, skip, info, warn, warnLines, wait, colorOn, setQuiet } = require('../lib/voice');
 */

const { writeErr, writeOut } = require('./say');

// The escapes `wk_palette` sets; RESET closes every one of them.
const PALETTE = {
  RESET: '\u001b[0m',
  GREEN: '\u001b[0;32m',
  YELLOW: '\u001b[0;33m',
  RED: '\u001b[0;31m',
  CYAN: '\u001b[0;36m',
  DIM: '\u001b[0;90m',
  BOLD: '\u001b[1m',
};
const {
  GREEN, YELLOW, RED, CYAN, DIM, BOLD,
} = PALETTE;

// Each level's [glyph, glyph color, task color, message color], as voice.sh's.
const STYLES = {
  ok: ['✓', `${BOLD}${GREEN}`, BOLD, ''],
  skip: ['·', DIM, DIM, DIM],
  info: ['›', CYAN, BOLD, ''],
  warn: ['⚠', YELLOW, `${BOLD}${YELLOW}`, YELLOW],
  error: ['✖', RED, `${BOLD}${RED}`, RED],
};

/**
 * Whether lines are painted, `wk_color_on`'s rule leg for leg: WORKKIT_COLOR=0,
 * NO_COLOR or a dumb TERM is a final no; WORKKIT_COLOR=1 stands in for a
 * terminal, for a piped test reading styles.
 * @param {{isTTY?: boolean}} [stream] the stream a terminal is asked of
 * @returns {boolean}
 */
const colorOn = (stream) => {
  if (process.env.WORKKIT_COLOR === '0') return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.env.WORKKIT_COLOR === '1') return true;
  return Boolean(stream && stream.isTTY);
};

/**
 * `text` in `code`, closed after, when painting and the code is not empty.
 * @param {string} text
 * @param {string} code an escape of PALETTE, or several run together
 * @param {boolean} on whether to paint
 * @returns {string}
 */
const paint = (text, code, on) => (on && code ? `${code}${text}${PALETTE.RESET}` : text);

/**
 * The `task:` split of `wk_say`: a message opening with a lowercase letter has
 * the text before its first `: ` as its task, unless that text holds a space.
 * @param {string} message
 * @returns {{task: string, rest: string}}
 */
const split = (message) => {
  const at = message.indexOf(': ');
  const task = at > 0 && /^[a-z]/.test(message) ? message.slice(0, at) : '';
  if (!task || task.includes(' ')) return { task: '', rest: message };
  return { task, rest: message.slice(at + 2) };
};

/**
 * One level's line as `wk_say` makes it, with no indent and no newline: the
 * glyph, the task and the message, each in its color when `on`.
 * @param {'ok'|'skip'|'info'|'warn'|'error'} level
 * @param {*} message
 * @param {boolean} on whether to paint
 * @returns {string}
 */
const said = (level, message, on) => {
  const [glyph, glyphColor, taskColor, messageColor] = STYLES[level];
  const { task, rest } = split(String(message));
  const body = paint(rest, messageColor, on);
  return `${paint(glyph, glyphColor, on)} ${task ? `${paint(`${task}:`, taskColor, on)} ${body}` : body}`;
};

/** A level's line for the engine: the indent first, the palette judged on stdout as lib.sh judges it. */
const lineOf = (level, message) => `${process.env.WK_LOG_INDENT ?? ''}${said(level, message, colorOn(process.stdout))}\n`;

/** A reporting line on stdout, or on stderr when WK_LOG_STDERR=1 (`wk_out`). */
const out = (line) => {
  if (process.env.WK_LOG_STDERR === '1') writeErr(line);
  else writeOut(line);
};

// The process's own quiet, the shell's unexported QUIET: no child inherits it.
let quietSet = false;

/**
 * Silence skip, info and the wait line for this process alone, as a script's
 * `QUIET=1` shell variable does; QUIET=1 in the environment still counts.
 * @param {boolean} on
 */
const setQuiet = (on) => { quietSet = Boolean(on); };

const quiet = () => quietSet || process.env.QUIET === '1';

/** `wk_ok`: something was done. */
const ok = (message) => { out(lineOf('ok', message)); };

/** `wk_skip`: nothing to do; silent under QUIET=1. */
const skip = (message) => { if (!quiet()) out(lineOf('skip', message)); };

/** `wk_info`: worth knowing; silent under QUIET=1. */
const info = (message) => { if (!quiet()) out(lineOf('info', message)); };

/** `wk_warn`: needs judgment, always on stderr. */
const warn = (message) => { writeErr(lineOf('warn', message)); };

/**
 * `wk_warn_lines`: each non-blank line of `text` warned on its own, prefixed
 * `<topic>: ` unless it opens with `<topic>:` already.
 * @param {string} topic
 * @param {string} text
 */
const warnLines = (topic, text) => {
  for (const line of String(text).split('\n')) {
    if (line) warn(line.startsWith(`${topic}:`) ? line : `${topic}: ${line}`);
  }
};

/**
 * The line `wk_spin` prints off a terminal, printed everywhere: `⏳ <message>...`
 * once on stderr, none under QUIET=1. The caller then runs its command.
 * @param {string} message
 */
const wait = (message) => {
  if (!quiet()) writeErr(`${process.env.WK_LOG_INDENT ?? ''}⏳ ${message}...\n`);
};

module.exports = {
  colorOn, ok, skip, info, warn, warnLines, wait, setQuiet, PALETTE, paint, said,
};
