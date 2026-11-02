// The ship hooks: the commands declared under `hooks.<event>` in the repo's
// merged settings (the kit defaults, then the machine's, then its tracked `.workkit/settings.json`),
// each run through `bash -c` from the repo root in order, stopping at the first
// failure. The ship commands run them once their step succeeds: cut.js
// (afterRelease), publish.js, deploy.js.
// Usage: const { EVENTS, runHooks } = require('./hooks');

const { spawnSync } = require('child_process');
const { isPlain, parseJson } = require('../../hooks/mods/settings.js');
const { sayAs, endOf } = require('../lib/say');
const { settingsAt, readOrNull } = require('../lib/settings');

const EVENTS = ['afterRelease', 'afterPublish', 'afterDeploy'];
const SETTINGS = '.workkit/settings.json';

const say = sayAs('ship-hooks');

/** A settings shape the hooks cannot run from; its message is the line to print. */
class HooksError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HooksError';
  }
}

/**
 * The repo's merged settings, each file read once; a missing or empty file of
 * its own declares nothing. Each layer is checked as it is read, since the
 * loader takes text that does not parse, or a hooks block that is no object,
 * as adding nothing: `misshapen` names the first file whose hooks is no object.
 * @returns {{settings: object, misshapen: string|null}}
 * @throws {HooksError} when the repo's own text does not parse
 */
const readSettings = (root, event) => {
  const file = `${root}/${SETTINGS}`;
  let misshapen = null;
  const settings = settingsAt(root, undefined, (at) => {
    const text = readOrNull(at);
    const name = at === file ? SETTINGS : at;
    if (at === file && text !== null && text.trim() !== '' && parseJson(text) === null) {
      throw new HooksError(`${name} does not parse as JSON, so no ${event} hook ran`);
    }
    const hooks = parseJson(text)?.hooks;
    if (misshapen === null && hooks != null && !isPlain(hooks)) misshapen = name;
    return text;
  });
  return { settings, misshapen };
};

/**
 * The commands an enabled repo declares for an event, validated whole before any runs.
 * @param {object} settings - the merged settings, `enabled` true
 * @param {string} event - the event name
 * @returns {string[]} the commands in order; [] when none is declared, the default
 * @throws {HooksError} when the declaration has the wrong shape
 */
const commandsOf = (settings, event) => {
  const entries = settings.hooks[event];
  if (!Array.isArray(entries)) throw new HooksError(`hooks.${event} in the settings is not an array, so no ${event} hook ran`);
  return entries.map((entry, i) => {
    if (!isPlain(entry) || typeof entry.command !== 'string' || entry.command.trim() === '') {
      throw new HooksError(`hooks.${event}[${i}] in the settings has no non-empty string command, so no ${event} hook ran`);
    }
    return entry.command;
  });
};

/** Run the commands in order from the root; the first failure stops them. */
const runCommands = (root, event, commands) => {
  for (const [i, command] of commands.entries()) {
    say(`${event} [${i + 1}/${commands.length}] ${command}`);
    const res = spawnSync('bash', ['-c', command], { cwd: root, stdio: 'inherit' });
    if (res.status !== 0) {
      say(`${event} ${command} ${endOf(res)}`);
      return 1;
    }
  }
  return 0;
};

/**
 * Run a repo's hooks for one event. Nothing runs unless the repo's own
 * settings say `"enabled": true`.
 * @param {string} root - the repo root
 * @param {string} event - one of EVENTS
 * @returns {number} 0 every hook passed or none ran, 1 a hook failed or the declaration could not be read
 */
const runHooks = (root, event) => {
  if (!EVENTS.includes(event)) throw new Error(`ship-hooks: ${event} is not an event; the events are ${EVENTS.join(', ')}`);
  try {
    const { settings, misshapen } = readSettings(root, event);
    // The merged view's `enabled` is the repo file's own (loadSettings).
    if (settings.enabled !== true) {
      const declared = settings.hooks[event];
      if (!(Array.isArray(declared) && declared.length === 0)) {
        say(`${event}: hooks run only where ${SETTINGS} says "enabled": true`);
      }
      return 0;
    }
    if (misshapen) throw new HooksError(`hooks in ${misshapen} is not an object, so no ${event} hook ran`);
    const commands = commandsOf(settings, event);
    if (commands.length === 0) {
      say(`no ${event} hooks`);
      return 0;
    }
    return runCommands(root, event, commands);
  } catch (err) {
    if (!(err instanceof HooksError)) throw err;
    say(err.message);
    return 1;
  }
};

module.exports = { EVENTS, runHooks };
