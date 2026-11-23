// The one shape of a `hooks.<event>` declaration and its check, shared by the
// ship hooks (hooks.js) and CI's hook steps (.github/scripts/ci-hooks.js), which
// CI loads on the kit's Node.
// Usage: const { HooksError, commandsOf } = require('./entries');

const { isPlain } = require('../../hooks/mods/settings.js');

/** A settings shape the hooks cannot run from; its message is the line to print. */
class HooksError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HooksError';
  }
}

/**
 * The entries a settings object declares for an event, validated whole before any runs.
 * @param {object} settings - settings whose `hooks` is an object
 * @param {string} event - the event name
 * @returns {{command: string, local: boolean}[]} the entries in order; [] when none is declared, the default
 * @throws {HooksError} when the declaration has the wrong shape
 */
const commandsOf = (settings, event) => {
  const entries = settings.hooks[event];
  if (!Array.isArray(entries)) throw new HooksError(`hooks.${event} in the settings is not an array, so no ${event} hook ran`);
  return entries.map((entry, i) => {
    if (!isPlain(entry) || typeof entry.command !== 'string' || entry.command.trim() === '') {
      throw new HooksError(`hooks.${event}[${i}] in the settings has no non-empty string command, so no ${event} hook ran`);
    }
    if ('local' in entry && entry.local !== true && entry.local !== false) {
      throw new HooksError(`hooks.${event}[${i}] in the settings has a local that is not true or false, so no ${event} hook ran`);
    }
    return { command: entry.command, local: entry.local === true };
  });
};

module.exports = { HooksError, commandsOf };
