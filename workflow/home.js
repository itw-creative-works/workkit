#!/usr/bin/env node
/**
 * workflow/home.js: the home repo's one entry, a verb per step the command
 * (homeRun in workkit/kit.js) hands over. Only `setup` creates the repo, the clone and
 * its services; see workflow/README.md § The home repo's lifecycle.
 * Usage: node home.js <verb> [argument]
 */

const { writeErr, writeOut } = require('./lib/say');
const {
  slug, siteHost, setSlug, homeState, homeReady,
} = require('./home/options');
const { catchUp, commitPush } = require('./home/install');
const { seedRunner } = require('./home/runner');
const { doctor, runnerDoctor } = require('./home/doctor');
const { setup } = require('./home/wizard');

// What a usage error exits with, as sysexits' EX_USAGE.
const USAGE_CODE = 64;

/** A value on stdout as one line, an empty one for none. */
const line = (value) => {
  writeOut(`${value}\n`);
  return 0;
};

// Each verb: how many arguments it takes, as [fewest, most], and its run.
const VERBS = {
  setup: [[0, 1], async ([force]) => {
    if (force !== undefined && force !== 'force') return null;
    return (await setup(force === 'force')) ? 0 : 1;
  }],
  doctor: [[0, 0], () => doctor()],
  'runner-doctor': [[0, 0], () => runnerDoctor()],
  slug: [[0, 0], () => line(slug())],
  host: [[0, 0], () => line(siteHost())],
  'set-slug': [[1, 1], async ([repo]) => ((await setSlug(repo)) ? 0 : 1)],
  state: [[0, 0], () => line(homeState())],
  ready: [[0, 0], () => (homeReady() ? 0 : 1)],
  'catch-up': [[1, 1], async ([prefix]) => ((await catchUp(prefix)) ? 0 : 1)],
  'seed-runner': [[0, 0], () => seedRunner()],
  'commit-push': [[1, 1], async ([subject]) => ((await commitPush(subject)) ? 0 : 1)],
};

/**
 * The program: one verb and its argument.
 * @param {string[]} args
 * @returns {Promise<number>} the verb's code, or 64 with the usage line
 */
const main = async ([verb = '', ...rest]) => {
  const entry = Object.hasOwn(VERBS, verb) ? VERBS[verb] : null;
  const code = entry && rest.length >= entry[0][0] && rest.length <= entry[0][1] ? await entry[1](rest) : null;
  if (code !== null) return code;
  writeErr('usage: home.js <setup [force]|doctor|runner-doctor|slug|host|set-slug <slug>|state|ready|catch-up <prefix>|seed-runner|commit-push <subject>>\n');
  return USAGE_CODE;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { main };
