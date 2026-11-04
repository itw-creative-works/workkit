/**
 * workflow/lib/read.js: the one read of a file that may not be there, as text
 * or as JSON, for the kit's Node scripts; every caller keeps its own reaction
 * to null.
 * Usage: const { readOrNull, readJsonOrNull } = require('../lib/read');
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

module.exports = { readOrNull, readJsonOrNull };
