/**
 * workflow/standards/engine-link.js: the engine's public address
 * (~/.claude/workkit → the workflow folder): whether this engine may take it,
 * and writing it. A step of the heal, and the heal's `--engine-link` mode alone.
 * Usage: const { ensureEngineLink } = require('./engine-link');
 */

const fs = require('fs');
const { isDir } = require('../lib/lock');
const { isLink, link, physical } = require('../lib/link');
const { cloneOutranks, inPluginCache, nativePath } = require('../lib/platform');
const { isKitCheckout } = require('../lib/repo');
const { ok, warn } = require('../lib/voice');

/**
 * The address made to name this engine's workflow folder. Only the machine's
 * real engine takes it: the plugin's copy in Claude's plugin cache, or a
 * workkit checkout; a fixture copy or an archive is a quiet skip, and a clone
 * the address already names outranks the plugin cache.
 * @param {{kit: string, claudeHome: string}} run
 */
const ensureEngineLink = (run) => {
  if (!isDir(run.claudeHome)) return;
  const here = physical(`${run.kit}/workflow`);
  if (!inPluginCache(run.kit) && !isKitCheckout(here)) return;

  const address = `${run.claudeHome}/workkit`;
  let verb = 'linked';
  if (isLink(address)) {
    const current = physical(address);
    if (current === here) return;
    if (cloneOutranks(run.kit, current ?? '')) return;
    verb = 'repointed';
  } else if (fs.existsSync(address)) {
    warn(`engine: ${nativePath(address)} is a real file or directory; move it aside so the engine's address can be linked`);
    return;
  }

  // `link` answers for the address, not the call: losing the race to a
  // session writing the same link is not a failure. Only Windows refuses a
  // symlink for want of a right; elsewhere a failed link stays silent.
  if (link(here, address)) {
    ok(`engine: ${verb} ${nativePath(address)} → ${nativePath(here)}`);
  } else if (process.platform === 'win32') {
    warn(`engine: could not link ${nativePath(address)}; Windows refused the symlink (turn on Developer Mode or run as administrator), then re-run \`workkit update\``);
  }
};

module.exports = { ensureEngineLink };
