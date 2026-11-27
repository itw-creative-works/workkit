/**
 * workflow/lib/voice.js: the kit's voice (workflow/README.md § Output): the
 * color gate, the palette, each level's glyph and colors and the line they
 * make, the five levels, a relayed line made plain, a tool's lines warned
 * one by one, a wait's one line, and the headings and closing line. The
 * tower's logger builds its lines here too. Every variable is read at the call.
 * Usage: const { ok, skip, info, warn, error, plain, warnLines, wait, colorOn, setQuiet, quiet, title, section, done } = require('../lib/voice');
 */

const { writeErr, writeOut } = require('./say');

// The palette's escapes; RESET closes every one of them.
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

// Each level's [glyph, glyph color, task color, message color].
const STYLES = {
  ok: ['✓', `${BOLD}${GREEN}`, BOLD, ''],
  skip: ['·', DIM, DIM, DIM],
  info: ['›', CYAN, BOLD, ''],
  warn: ['⚠', YELLOW, `${BOLD}${YELLOW}`, YELLOW],
  error: ['✖', RED, `${BOLD}${RED}`, RED],
};

/**
 * Whether lines are painted: WORKKIT_COLOR=0,
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
 * The `task:` split of a line: a message opening with a lowercase letter has
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
 * One level's line, with no indent and no newline: the
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

// The indent title and section set, for this process alone: no child inherits it.
let indentSet = null;

/**
 * The indent a line opens with: the one title or section set in this process,
 * else WK_LOG_INDENT, else none.
 * @returns {string}
 */
const indent = () => indentSet ?? process.env.WK_LOG_INDENT ?? '';

/** A level's line for the engine: the indent first, the palette judged on stdout. */
const lineOf = (level, message) => `${indent()}${said(level, message, colorOn(process.stdout))}\n`;

/** A reporting line on stdout, or on stderr when WK_LOG_STDERR=1. */
const out = (line) => {
  if (process.env.WK_LOG_STDERR === '1') writeErr(line);
  else writeOut(line);
};

// The process's own quiet: no child inherits it.
let quietSet = false;

/**
 * Silence skip, info and the wait line for this process alone; QUIET=1 in
 * the environment still counts.
 * @param {boolean} on
 */
const setQuiet = (on) => { quietSet = Boolean(on); };

const quiet = () => quietSet || process.env.QUIET === '1';

/** Something was done. */
const ok = (message) => { out(lineOf('ok', message)); };

/** Nothing to do; silent under QUIET=1. */
const skip = (message) => { if (!quiet()) out(lineOf('skip', message)); };

/** Worth knowing; silent under QUIET=1. */
const info = (message) => { if (!quiet()) out(lineOf('info', message)); };

/** Needs judgment, always on stderr. */
const warn = (message) => { writeErr(lineOf('warn', message)); };

/** A stop, always on stderr. */
const error = (message) => { writeErr(lineOf('error', message)); };

// A relayed line's indent and glyph, and the palette's escapes.
const GLYPH = /^ *(✓|·|›|⚠|✖|⏳) /;
const ESCAPE = /\u001b\[[0-9;]*m/g;

/**
 * Each line of `text` with its colors, its indent and its glyph taken off,
 * so a relay re-says it under its own.
 * @param {string} text
 * @returns {string}
 */
const plain = (text) => String(text).split('\n').map((line) => line.replace(ESCAPE, '').replace(GLYPH, '')).join('\n');

/**
 * Each non-blank line of `text` warned on its own, prefixed
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
 * A wait's one line, the spinner's line off a terminal: `⏳ <message>...`
 * once on stderr, none under QUIET=1. The caller then runs its command.
 * @param {string} message
 */
const wait = (message) => {
  if (!quiet()) writeErr(`${indent()}⏳ ${message}...\n`);
};

/**
 * A command's heading in bold. The lines after it are indented
 * two spaces, whatever QUIET says: the indent is the run's shape, not output.
 * @param {string} message
 */
const title = (message) => {
  indentSet = '  ';
  if (!quiet()) out(`${paint(message, BOLD, colorOn(process.stdout))}\n`);
};

/**
 * An empty line, then a section's heading in bold cyan; the
 * indent is set as title sets it.
 * @param {string} message
 */
const section = (message) => {
  indentSet = '  ';
  if (!quiet()) out(`\n${paint(message, `${BOLD}${CYAN}`, colorOn(process.stdout))}\n`);
};

/**
 * The closing line when nothing is left to do, `✨ <message>` in
 * bold green; silent under QUIET=1.
 * @param {string} message
 */
const done = (message) => {
  if (!quiet()) out(`${paint(`✨ ${message}`, `${BOLD}${GREEN}`, colorOn(process.stdout))}\n`);
};

module.exports = {
  colorOn, ok, skip, info, warn, error, plain, warnLines, wait, setQuiet, PALETTE, paint, said, ESCAPE, title, section, done, indent, quiet,
};
