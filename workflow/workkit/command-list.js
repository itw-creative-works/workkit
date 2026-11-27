/**
 * workflow/workkit/command-list.js: the kit's one list of its commands, each
 * with the permission its rule lands in, and its three readers. The route, the
 * allow rules, the ship verbs and the command log read it here; it needs no
 * other piece of the command.
 * Usage: const { COMMANDS, commandsWith, commandListed, commandVerbs } = require('./command-list');
 */

// allow keeps `Bash(workkit <command>:*)` at permissions.allow, ask at
// permissions.ask, none keeps no rule (a command that runs other code). The
// entry refuses a first word with no entry here.
const COMMANDS = [
  { command: 'help', permission: 'allow' },
  { command: 'setup', permission: 'allow' },
  { command: 'update', permission: 'allow' },
  { command: 'doctor', permission: 'allow' },
  { command: 'publish', permission: 'allow' },
  { command: 'brief', permission: 'allow' },
  { command: 'log', permission: 'allow' },
  { command: 'test', permission: 'none' },
  { command: 'tools', permission: 'allow' },
  { command: 'convert', permission: 'allow' },
  { command: 'public', permission: 'allow' },
  { command: 'ship items', permission: 'allow' },
  { command: 'ship release', permission: 'allow' },
  { command: 'ship watch', permission: 'allow' },
  { command: 'ship cut', permission: 'allow' },
  { command: 'ship plan', permission: 'allow' },
  { command: 'ship publish', permission: 'allow' },
  { command: 'ship deploy', permission: 'ask' },
  { command: 'review', permission: 'allow' },
  { command: 'triage', permission: 'allow' },
  { command: 'checkpoint', permission: 'allow' },
  { command: 'proof red', permission: 'none' },
  { command: 'changelog', permission: 'allow' },
  { command: 'tower', permission: 'none' },
  { command: 'enable', permission: 'allow' },
  { command: 'decline', permission: 'allow' },
  { command: 'heal', permission: 'allow' },
  { command: 'state', permission: 'allow' },
  { command: 'note', permission: 'allow' },
  { command: 'prove', permission: 'none' },
  { command: 'supervise', permission: 'none' },
  { command: 'watch', permission: 'allow' },
];

/**
 * The commands with <permission>, in the list's order.
 * @param {'allow'|'ask'|'none'} permission
 * @returns {string[]} none for a permission no entry holds
 */
const commandsWith = (permission) => COMMANDS.filter((entry) => entry.permission === permission).map((entry) => entry.command);

/**
 * Whether an entry's first word is <word>: `ship` and
 * `proof` are, `red` is not, and an empty word never is.
 * @param {string} word
 * @returns {boolean}
 */
const commandListed = (word) => COMMANDS.some((entry) => entry.command.split(' ')[0] === word);

/**
 * The second word of each entry whose first word is <word>, in the list's
 * order: `ship` gives its seven verbs, `setup` none.
 * @param {string} word
 * @returns {string[]}
 */
const commandVerbs = (word) => COMMANDS
  .filter((entry) => entry.command.startsWith(`${word} `))
  .map((entry) => entry.command.slice(word.length + 1));

module.exports = {
  COMMANDS, commandsWith, commandListed, commandVerbs,
};
