// The ship hooks: the commands declared under `hooks.<event>` in the repo's
// merged settings (the kit defaults, then the machine's, then its tracked `.workkit/settings.json`),
// each run through `bash -c` from the repo root in order, stopping at the first
// failure. The ship commands run them once their step succeeds: cut.js
// (afterRelease), publish.js, deploy.js.
// Usage: const { EVENTS, runHooks } = require('./hooks');

const { spawnSync } = require('../lib/run');
const { faultsUnder, repoSettingsFile } = require('../../hooks/mods/settings.js');
const { sayAs, endOf } = require('../lib/say');
const { settingsAt, faultsAt } = require('../lib/settings');
const { isCloud } = require('../lib/cloud');
const { HooksError, commandsOf } = require('./entries');

// The events the ship runs; every known event, ciSetup (CI's) included, has its
// default in defaults/settings.json.
const EVENTS = ['afterRelease', 'afterPublish', 'afterDeploy'];
const SETTINGS = '.workkit/settings.json';

const say = sayAs('ship-hooks');

/**
 * The repo's merged settings; a missing or empty file of its own declares
 * nothing. The loader takes a repo file that is no JSON object, or a hooks
 * value that is no object, as adding nothing, so its faults say them:
 * `misshapen` names the first such hooks key and its file.
 * @returns {{settings: object, misshapen: string|null}}
 * @throws {HooksError} when the repo's own file is no JSON object
 */
const readSettings = (root, event) => {
  const file = repoSettingsFile(root);
  const faults = faultsAt(root);
  if (faults.some((fault) => fault.key === null && fault.file === file)) {
    throw new HooksError(`${SETTINGS} is not a JSON object, so no ${event} hook ran`);
  }
  const [hooks] = faultsUnder(faults, 'hooks');
  const misshapen = hooks ? `${hooks.key} in ${hooks.file === file ? SETTINGS : hooks.file}` : null;
  return { settings: settingsAt(root), misshapen };
};

/**
 * Run the entries in order from the root; the first failure stops them.
 * A cloud session skips a `local` entry with its line and runs the rest.
 */
const runCommands = (root, event, entries) => {
  const cloud = isCloud();
  for (const [i, { command, local }] of entries.entries()) {
    const step = `${event} [${i + 1}/${entries.length}] ${command}`;
    if (local && cloud) {
      say(`${step} skipped: local only, this is a cloud session`);
      continue;
    }
    say(step);
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
    if (misshapen) throw new HooksError(`${misshapen} is not an object, so no ${event} hook ran`);
    const entries = commandsOf(settings, event);
    if (entries.length === 0) {
      say(`no ${event} hooks`);
      return 0;
    }
    return runCommands(root, event, entries);
  } catch (err) {
    if (!(err instanceof HooksError)) throw err;
    say(err.message);
    return 1;
  }
};

module.exports = { EVENTS, runHooks };
