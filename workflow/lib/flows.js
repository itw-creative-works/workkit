/**
 * workflow/lib/flows.js: the questions asked at a terminal: whether one is
 * there, a yes or no, the Enter gate before a browser opens, and a poll.
 * Each takes `io`, `{ stdin, stderr }`, the process's own by default.
 * Usage: const { interactive, askYes, readLine, enterToOpen, opener, openUrl, poll } = require('../lib/flows');
 */

const { onPath, spawnSync } = require('./run');
const { writeErr } = require('./say');
const { startSpinner } = require('./spin');
const {
  PALETTE, colorOn, paint, indent,
} = require('./voice');

const IO = { stdin: process.stdin, stderr: process.stderr };

// The answers askYes takes as yes.
const YES = new Set(['y', 'Y', 'yes', 'YES']);

// What a stream holds past the last answer read from it, kept for the next
// read, as a pipe keeps it.
const unread = new WeakMap();

/** <text> in the palette's <name>, where the palette is on (judged on stdout). */
const painted = (text, name) => paint(text, PALETTE[name], colorOn(process.stdout));

/** <text> on the caller's stderr; the process's own straight to its descriptor. */
const say = (io, text) => {
  if (io.stderr === process.stderr) writeErr(text);
  else io.stderr.write(text);
};

/**
 * The next answer <pick> finds in what <stdin> holds: `{ answer }`, `{ end }`
 * when the stream closes first, `{ timeout }` after <ms>. <pick> answers
 * `{ answer, rest }`, `answer` undefined to wait on with `rest` kept.
 * @param {import('stream').Readable} stdin
 * @param {(text: string) => {answer?: string, rest: string}} pick
 * @param {number} [ms]
 * @returns {Promise<{answer?: string, end?: boolean, timeout?: boolean}>}
 */
const take = (stdin, pick, ms) => new Promise((resolve) => {
  let held = unread.get(stdin) ?? '';
  let timer;
  let settled = false;
  const finish = (result, rest) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    stdin.pause();
    unread.set(stdin, rest);
    resolve(result);
  };
  const tryPick = () => {
    const { answer, rest } = pick(held);
    held = rest;
    if (answer !== undefined) finish({ answer }, rest);
    return answer !== undefined;
  };
  function onData(chunk) {
    held += String(chunk);
    tryPick();
  }
  function onEnd() {
    finish({ end: true }, '');
  }
  if (tryPick()) return;
  if (stdin.readableEnded) {
    onEnd();
    return;
  }
  stdin.on('data', onData);
  stdin.on('end', onEnd);
  if (ms !== undefined) timer = setTimeout(() => finish({ timeout: true }, held), ms);
  stdin.resume();
});

/** One line, as `read -r` takes it: up to the newline, its spaces and tabs trimmed at both ends. */
const line = (text) => {
  const at = text.indexOf('\n');
  if (at < 0) return { rest: text };
  return { answer: text.slice(0, at).replace(/^[ \t]+|[ \t]+$/g, ''), rest: text.slice(at + 1) };
};

/**
 * One line read as `read -r` reads it, after whatever an earlier question left
 * unread on the same stdin; a last line with no newline is still the answer.
 * @param {{stdin: object}} [io]
 * @returns {Promise<string>} the line trimmed, '' for a closed stdin with nothing left
 */
const readLine = async (io = IO) => {
  let seen = '';
  const read = await take(io.stdin, (text) => {
    seen = text;
    return line(text);
  });
  return read.end ? line(`${seen}\n`).answer : read.answer;
};

/**
 * One key of a poll, read one at a time: Enter (or a raw
 * terminal's carriage return) is `enter`, `s` or `S` is `s`, a raw terminal's
 * Ctrl-C is `int`; any other key is read and dropped.
 */
const key = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    const rest = text.slice(i + 1);
    if (text[i] === '\n' || text[i] === '\r') return { answer: 'enter', rest };
    if (text[i] === 's' || text[i] === 'S') return { answer: 's', rest };
    if (text[i] === '\u0003') return { answer: 'int', rest };
  }
  return { rest: '' };
};

/**
 * `interactive`: whether stdin is a terminal.
 * @param {{stdin: object}} [io]
 * @returns {boolean}
 */
const interactive = (io = IO) => Boolean(io.stdin.isTTY);

/**
 * <prompt> and its hint on stderr, then one line read. Empty is
 * <fallback>; a closed stdin is no whatever it is, after a newline.
 * @param {string} prompt
 * @param {'y'|'n'} fallback the answer an empty line gives
 * @param {{stdin: object, stderr: object}} [io]
 * @returns {Promise<boolean>} whether the answer is yes
 */
const askYes = async (prompt, fallback, io = IO) => {
  say(io, `${prompt} ${fallback === 'y' ? '[Y/n]' : '[y/N]'} `);
  const read = await take(io.stdin, line);
  if (read.end) {
    say(io, '\n');
    return false;
  }
  return YES.has(read.answer || fallback);
};

/**
 * This machine's browser opener, `open` on macOS and `xdg-open`
 * elsewhere, when it is on PATH.
 * @param {{ platform?: string, env?: object }} [context] the system and the variables PATH is read from
 * @returns {string|null} its name, or null for none
 */
const opener = ({ platform = process.platform, env = process.env } = {}) => {
  const name = platform === 'darwin' ? 'open' : 'xdg-open';
  return onPath(name, { env }) ? name : null;
};

/**
 * <url>, which the caller has printed, handed to this machine's
 * opener (`opener`); with none on PATH, one dim line points back at the printed URL.
 * @param {string} url
 * @param {{stderr: object}} [io]
 * @returns {true}
 */
const openUrl = (url, io = IO) => {
  const found = opener();
  if (found) {
    spawnSync(found, [url], { stdio: 'ignore', windowsHide: true });
  } else {
    say(io, `${indent()}${painted('(no browser could be launched: open the URL above by hand)', 'DIM')}\n`);
  }
  return true;
};

/**
 * <what> and the URL on stderr, the green `?` Enter gate
 * naming <label>, one line read whatever it holds, then openUrl.
 * @param {string} url
 * @param {string} label what the URL is, in the gate's words
 * @param {string} what what to do there
 * @param {{stdin: object, stderr: object}} [io]
 * @returns {Promise<true>}
 */
const enterToOpen = async (url, label, what, io = IO) => {
  say(io, `\n${indent()}${what}\n${indent()}URL: ${painted(url, 'CYAN')}\n\n`);
  say(io, `${painted('?', 'GREEN')} Press Enter to open ${label} in your browser... `);
  await take(io.stdin, line);
  return openUrl(url, io);
};

/**
 * One wait of a poll: up to <seconds> for a key, on a terminal in raw mode so
 * a key needs no Enter and is not echoed.
 * @returns {Promise<'enter'|'s'|'int'|'timeout'>}
 */
const keyWithin = async (stdin, seconds) => {
  const raw = Boolean(stdin.isTTY) && typeof stdin.setRawMode === 'function';
  const was = raw && stdin.isRaw;
  if (raw) stdin.setRawMode(true);
  try {
    const read = await take(stdin, key, seconds * 1000);
    if (read.end) return 's';
    return read.timeout ? 'timeout' : read.answer;
  } finally {
    if (raw) stdin.setRawMode(was);
  }
};

/**
 * The key hint on stderr, then <check> until it answers true. Each miss
 * waits <seconds> under a countdown drawn with spin's frames (or the
 * `⏳` line where spin draws no frames); Enter checks now, `s` or a closed
 * stdin skips. An interrupt clears the countdown, then goes on as one.
 * @param {string} message
 * @param {number} seconds the wait between two checks
 * @param {() => (boolean|Promise<boolean>)} check
 * @param {{stdin: object, stderr: object}} [io]
 * @returns {Promise<boolean>} true once <check> did, false for a skip
 */
const poll = async (message, seconds, check, io = IO) => {
  say(io, `\n${indent()}${painted('(enter)=check now, (s)=skip', 'DIM')}\n\n`);
  let stop = null;
  // A real SIGINT is raised again on this process, as the trap does; a raw
  // terminal's Ctrl-C goes to the process group, as the terminal sends it.
  const interrupt = (target = process.pid) => {
    stop?.();
    process.kill(target, 'SIGINT');
  };
  const onSigint = () => interrupt();
  process.once('SIGINT', onSigint);
  try {
    for (;;) {
      if (await check()) return true;
      stop = startSpinner(message, Math.floor(Date.now() / 1000) + Number(seconds));
      if (stop === null) say(io, `${indent()}⏳ ${message}...\n`);
      const pressed = await keyWithin(io.stdin, Number(seconds));
      stop?.();
      stop = null;
      if (pressed === 'int') {
        process.off('SIGINT', onSigint);
        interrupt(process.platform === 'win32' ? process.pid : 0);
        return false;
      }
      if (pressed === 's') return false;
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
};

module.exports = {
  interactive, askYes, readLine, enterToOpen, opener, openUrl, poll,
};
