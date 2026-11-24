/**
 * workflow/lib/read.js: the one read of a file that may not be there, as text
 * or as JSON, whether anything is there at all, and the plain files a folder
 * holds, for the kit's Node scripts; every caller keeps its own reaction to null.
 * Usage: const { readOrNull, readJsonOrNull, present, filesUnder } = require('../lib/read');
 */

const fs = require('fs');
const path = require('path');

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

/**
 * Every plain file under `root`, as `find -type f` lists them: a link is no
 * file, a linked folder is never walked (the root included), and a name
 * `skipName` answers true for is neither listed nor walked into. A folder that
 * cannot be read, the root included, holds nothing.
 * @param {string} root
 * @param {(name: string) => boolean} [skipName]
 * @returns {string[]} the files' paths, `root` joined in front, in name order
 */
const filesUnder = (root, skipName = () => false) => {
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((entry) => {
      if (skipName(entry.name)) return [];
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(at);
      return entry.isFile() ? [at] : [];
    });
  };
  try {
    return fs.lstatSync(root).isDirectory() ? walk(root) : [];
  } catch {
    return [];
  }
};

module.exports = {
  readOrNull, readJsonOrNull, present, filesUnder,
};
