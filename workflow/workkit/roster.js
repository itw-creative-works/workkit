/**
 * workflow/workkit/roster.js: doctor's line for the global layer, reported
 * and never written: how many repos this machine's roster has registered (the
 * engine keeps it on every heal).
 * Usage: const { reportGlobals, rosterCount } = require('./roster');
 */

const {
  ok, info, warn,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { readOrNull } = require('../lib/read');
const { rosterFile } = require('../../hooks/mods/log.js');
const { isPlain } = require('../../hooks/mods/settings.js');

/**
 * The repos a roster's text registers, every entry of `repos` whose answer is
 * not `declined`. A `repos` of null, false or none counts none, as does a
 * top level of null; an array counts its elements.
 * @param {string} text the roster file's text
 * @returns {number|null} null for a text that is not JSON or not a roster's shape
 */
const rosterCount = (text) => {
  let top;
  try {
    top = JSON.parse(text);
  } catch {
    return null;
  }
  if (top === null) return 0;
  if (!isPlain(top)) return null;
  const repos = top.repos === undefined || top.repos === null || top.repos === false ? {} : top.repos;
  if (!Array.isArray(repos) && !isPlain(repos)) return null;
  return Object.values(repos).filter((answer) => answer !== 'declined').length;
};

/**
 * The roster's one line. An empty roster is a notice, not a
 * green check: the tower, the board and the brief have nothing to read.
 * @param {object} kit
 * @returns {number} 0
 */
const reportGlobals = (kit) => {
  const file = rosterFile(kit.userDir);
  const named = nativePath(file);
  if (!isFile(file)) {
    info(`roster: ${named} does not exist yet; the first heal writes it`);
    return 0;
  }
  const text = readOrNull(file);
  const count = text === null ? null : rosterCount(text);
  if (count === null) warn(`roster: ${named} cannot be read as JSON (unreadable or not valid JSON); fix or remove it, then re-run a session in any repo`);
  else if (count === 0) info(`roster: no repos registered in ${named} yet; it fills as a session opens in each enabled repo`);
  else ok(`roster: ${count} repo(s) registered in ${named}`);
  return 0;
};

module.exports = { reportGlobals, rosterCount };
