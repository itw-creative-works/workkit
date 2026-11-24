/**
 * workflow/lib/day.js: today in the local calendar, the one spelling the kit's
 * Node commands share for a dated line: a release heading, a publish commit.
 * Usage: const { today } = require('../lib/day');
 */

/**
 * Today in the local calendar, as `date '+%Y-%m-%d'` prints it.
 * @returns {string}
 */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

module.exports = { today };
