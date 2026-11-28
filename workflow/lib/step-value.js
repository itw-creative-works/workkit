/**
 * workflow/lib/step-value.js: the one append a CI step's value takes, to the
 * file GITHUB_ENV or GITHUB_OUTPUT names, for the scripts under .github/scripts/.
 * Usage: const { appendTo } = require('../../workflow/lib/step-value');
 */

const fs = require('fs');
const { sayAs } = require('./say');

/**
 * Appends <text> to the file the variable <name> names, the way a step hands GitHub a value;
 * with <name> unset or empty nothing is written and <who> says so on stderr.
 * @param {string} who - the script, the prefix of its line
 * @param {string} name - GITHUB_ENV or GITHUB_OUTPUT
 * @param {string} text - whole lines, each ending in a newline
 * @returns {number} the script's exit code: 0, or 1 with no file
 */
const appendTo = (who, name, text) => {
  const file = process.env[name];
  if (!file) {
    sayAs(who)(`${name} names no file`);
    return 1;
  }
  fs.appendFileSync(file, text);
  return 0;
};

module.exports = { appendTo };
