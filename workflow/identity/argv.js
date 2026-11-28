/**
 * workflow/identity/argv.js: what the shim and its gate know of gh's argv: the
 * subcommand's place, the subcommands that post nothing, the short flags that
 * take a value as their long names, an issue or pull request URL, and the verbs
 * a cloud session hands to rest.js. It requires nothing, so a call the gate
 * never sees loads no gate.
 * Usage: const { subAt, spellingsOf, ISSUE_URL } = require('./argv');
 */

// The subcommands that post nothing, so they stay the owner's under every verb.
const READ_SUBCOMMANDS = ['list', 'view', 'status', 'checks', 'diff'];

// The verbs a cloud session's shim hands to rest.js, so the gate's reads go there too.
const CLOUD_VERBS = new Set(['issue', 'label', 'pr', 'release']);

// The short flags the gate reads that take a value, as their long names, by verb.
const PR_ALIASES = { '-R': '--repo', '-b': '--body', '-F': '--body-file', '-t': '--title', '-l': '--label' };
const ALIASES = {
  issue: { ...PR_ALIASES, '-r': '--reason' },
  pr: PR_ALIASES,
  label: { '-R': '--repo' },
  api: { '-X': '--method', '-f': '--raw-field', '-F': '--field' },
};

const ISSUE_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/([0-9]+)([/?#].*)?$/;

/**
 * The subcommand's place: the first word after the verb that is neither a
 * flag nor the value of `-R`/`--repo`, -1 for none. The rule's one home:
 * ./gate.js, ./rest.js and the shim's bookkeeping test (`botVerb` in ./call.js) call it.
 * @param {string[]} rest gh's argv after the verb
 * @returns {number}
 */
function subAt(rest) {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '-R' || rest[i] === '--repo') i++;
    else if (!rest[i].startsWith('-')) return i;
  }
  return -1;
}

/**
 * Every spelling of some long flags under a verb: the long names, then each
 * short one ALIASES gives that verb for one of them.
 * @param {string} verb a key of ALIASES
 * @param {string[]} longs the long names
 * @returns {string[]}
 */
const spellingsOf = (verb, longs) => [
  ...longs,
  ...Object.keys(ALIASES[verb]).filter((short) => longs.includes(ALIASES[verb][short])),
];

module.exports = {
  subAt, spellingsOf, READ_SUBCOMMANDS, CLOUD_VERBS, ALIASES, ISSUE_URL,
};
