/**
 * workflow/lib/day.js: a day in the local calendar, the one spelling the kit's
 * Node commands share for a dated line: a release heading, a publish commit,
 * a job's log stamp.
 * Usage: const { today } = require('../lib/day');
 */

const { pad } = require('../../hooks/mods/log.js');

/**
 * The local date of <now>, as `date '+%Y-%m-%d'` prints it.
 * @param {Date} [now] today's moment by default
 * @returns {string}
 */
const today = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

module.exports = { today };
