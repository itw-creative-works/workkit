/**
 * workflow/workkit/update.js: `update`, the machine's pointers and schedule
 * kept current, the secrets and the sign-in reported, the site republished;
 * `--auto`, the daily run the session-start hook makes, quiet and publishing nothing.
 * Usage: const { update } = require('./update');
 */

const {
  skip, error, title, setQuiet,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isCloud } = require('../lib/cloud');
const { machineLinks } = require('./links');
const { updateCron } = require('./schedule');
const { secretsReport } = require('./secrets');
const { identityReport } = require('./identity');
const { publish } = require('./commands');
const { cloudNa } = require('./setup');

/**
 * `workkit update [--auto]`. Reported, never wired: the daily `--auto` run is
 * the one path that must not prompt or mint, so a missing secret is a line.
 * @param {object} kit
 * @param {string} [flag] `--auto`, or none
 * @returns {Promise<number>} 0, or 1 for an unknown option
 */
const update = async (kit, flag) => {
  const auto = flag === '--auto';
  if (auto) setQuiet(true);
  else if (flag) {
    error(`update: unknown option ${flag}`);
    return 1;
  }
  title(`🔄 workkit update in ${nativePath(kit.root)}`);
  machineLinks(kit);
  updateCron(kit);
  if (isCloud(kit.env)) cloudNa(kit, 'secrets');
  else await secretsReport(kit, 'update');
  // The daily run links the gh shim on a machine set up before the identity
  // shipped, and the warning is how that machine hears it must sign in. Quiet
  // holds the skips, so the ok line is the one stdout line `>/dev/null` dropped.
  await identityReport(kit, 'machine', { okLine: !auto });
  // A human's update republishes from this checkout; --auto leaves it to the daily job.
  if (auto) skip('site: the daily job publishes it; `workkit publish` does it now');
  else await publish(kit);
  return 0;
};

module.exports = { update };
