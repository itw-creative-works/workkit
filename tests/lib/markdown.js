// The one reader of a markdown section: the docs parity checks read one section
// each rather than the whole file, so a phrase elsewhere in the file cannot
// stand in for the section's rule.

const fs = require('fs');
const path = require('path');
const { assert } = require('./harness');

const REPO = path.join(__dirname, '..', '..');

/**
 * The body under a markdown heading, up to the next heading of the same or a
 * higher level, with its leading blank lines dropped.
 * @param {string} file - path of the markdown file
 * @param {string} heading - the heading's leading text, hashes included (`## Skills`)
 * @returns {string} the section's body, the heading line excluded
 */
const section = (file, heading) => {
  const level = heading.match(/^#+/)[0].length;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(heading));
  assert(start >= 0, `${path.relative(REPO, file)} has no "${heading}" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#+ /.test(l) && l.match(/^#+/)[0].length <= level);
  return rest.slice(0, end < 0 ? rest.length : end).join('\n').replace(/^\s+/, '');
};

module.exports = { section };
