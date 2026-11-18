/**
 * workflow/lib/read.js: the one read of a file that may not be there, as text
 * or as JSON, and whether anything is there at all, for the kit's Node
 * scripts; every caller keeps its own reaction to null.
 * Usage: const { readOrNull, readJsonOrNull, present } = require('../lib/read');
 */

const fs = require('fs');

/**
 * A file's text, or null when it cannot be read.
 * @param {string} file
 * @returns {string|null}
 */
const readOrNull = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * A file's parsed JSON, or null when it cannot be read or does not parse.
 * @param {string} file
 * @returns {*}
 */
const readJsonOrNull = (file) => {
  const text = readOrNull(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Whether anything is at `p`, a dangling link included: the shell's `-e || -L`.
 * @param {string} p
 * @returns {boolean}
 */
const present = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

module.exports = { readOrNull, readJsonOrNull, present };
