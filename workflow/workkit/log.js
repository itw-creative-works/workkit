/**
 * workflow/workkit/log.js: `workkit log`, the hooks log the hooks module
 * writes, one line per hook fire (docs/hooks.md § The hooks log): its last
 * lines, and with --follow each line added after them.
 * Usage: const { log } = require('./log');
 */

const fs = require('fs');
const { error, skip } = require('../lib/voice');
const { writeOut } = require('../lib/say');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { sizeOf, bytesOf, lastLines } = require('../lib/attach');
const { INT_CODE } = require('../lib/detach');

// The lines printed when -n does not say.
const DEFAULT_LINES = 40;

// How often the follow reads the log again for what was added.
const POLL_MS = 200;

/**
 * The lines added to <file> after byte <from>, printed as they come, until
 * INT, which ends the follow with the code `tail -f` ends with on it. A log
 * cut shorter is read again from its start, as tail reads a truncated file.
 * @param {string} file
 * @param {number} from
 * @returns {Promise<number>} 130
 */
const follow = (file, from) => new Promise((resolve) => {
  let off = from;
  const timer = setInterval(() => {
    const size = sizeOf(file);
    if (size < off) off = 0;
    if (size > off) {
      writeOut(bytesOf(file, off, size));
      off = size;
    }
  }, POLL_MS);
  process.once('SIGINT', () => {
    clearInterval(timer);
    resolve(INT_CODE);
  });
});

/**
 * `workkit log [-n N] [--follow]`: the hooks log's last N lines, 40 unless -n
 * says; --follow then prints each line the hooks add.
 * @param {object} kit
 * @param {...string} args the options
 * @returns {number|Promise<number>} 0; 1 for an option it does not take;
 *   the follow's code once INT ends it
 */
const log = (kit, ...args) => {
  let lines = DEFAULT_LINES;
  let following = false;
  for (let i = 0; i < args.length;) {
    if (args[i] === '-n') {
      if (!/^[0-9]+$/.test(args[i + 1] ?? '')) {
        error('log: -n takes a number of lines');
        return 1;
      }
      lines = Number(args[i + 1]);
      i += 2;
    } else if (args[i] === '--follow') {
      following = true;
      i += 1;
    } else {
      error(`log: unknown option ${args[i]}`);
      return 1;
    }
  }

  const file = kit.hooksLog;
  if (!isFile(file)) {
    skip(`log: no hooks log at ${nativePath(file)} yet; the first hook fire writes it`);
    return 0;
  }
  const bytes = fs.readFileSync(file);
  writeOut(lastLines(bytes, lines));
  return following ? follow(file, bytes.length) : 0;
};

module.exports = { log };
