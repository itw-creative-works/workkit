/**
 * jobs/lib/notes.js: the jobs' record of what a run did. On a machine each note
 * is one stamped block appended to the job's log; on a runner it is one line
 * under its glyph, since the Actions log is the record there.
 * Usage: const { logStamp, fileNotes, plainNotes, block, heading, captured } = require('../lib/notes');
 */

const fs = require('fs');
const path = require('path');
const { today } = require('../../workflow/lib/day');
const {
  ok, skip, warn, said,
} = require('../../workflow/lib/voice');

/** A number as two digits. */
const pad = (n) => String(n).padStart(2, '0');

/**
 * The stamp a block opens with: `YYYY-MM-DD HH:MM:SS` of `now` in local time,
 * with ` (manual)` after it for a run a person started.
 * @param {Date} now
 * @param {boolean} manual
 * @returns {string}
 */
const logStamp = (now, manual) => {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${today(now)} ${time}${manual ? ' (manual)' : ''}`;
};

/**
 * A child's output as the log holds it: its trailing newlines dropped.
 * @param {string} text
 * @returns {string}
 */
const captured = (text) => text.replace(/\n+$/, '');

/**
 * The line a block opens with, its newline included.
 * @param {string} stamp the stamp, and for a `morning.d` script its name after it
 * @returns {string}
 */
const heading = (stamp) => `--- ${stamp} ---\n`;

/**
 * Appends one block to `file`: the line `--- <stamp> ---`, `lines`, then one
 * empty line. The file's folder is made first.
 * @param {string} file
 * @param {string} stamp
 * @param {string} lines the block's body, its last newline included
 */
const block = (file, stamp, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${heading(stamp)}${lines}\n`);
};

/**
 * The three note levels writing into `file`, each note its own block, its line
 * as the voice says it with no color.
 * @param {string} file
 * @param {string} stamp
 * @returns {{note: function, noteSkip: function, noteWarn: function}}
 */
const fileNotes = (file, stamp) => {
  const as = (level) => (message) => block(file, stamp, `${said(level, message, false)}\n`);
  return { note: as('ok'), noteSkip: as('skip'), noteWarn: as('warn') };
};

/**
 * The three note levels as the voice's own lines, the runner's form.
 * @returns {{note: function, noteSkip: function, noteWarn: function}}
 */
const plainNotes = () => ({ note: ok, noteSkip: skip, noteWarn: warn });

module.exports = {
  logStamp, fileNotes, plainNotes, block, heading, captured,
};
