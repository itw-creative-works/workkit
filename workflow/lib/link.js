/**
 * workflow/lib/link.js: a machine address made a link, for the kit's Node
 * scripts: renamed onto the address, never removed first, so no other session
 * sees a gap. The Node half of `wk_link` (lib/flows.sh) and `wk_mv_link`
 * (lib/platform.sh).
 * Usage: const { link, mvLink, isLink, physical } = require('../lib/link');
 */

const fs = require('fs');
const path = require('path');

/**
 * Renames `from` onto `to` without following a link at `to` (`wk_mv_link`):
 * a rename replaces the name itself, never lands inside the folder it points at.
 * @param {string} from
 * @param {string} to
 * @returns {boolean} true when renamed
 */
const mvLink = (from, to) => {
  try {
    fs.renameSync(from, to);
    return true;
  } catch {
    return false;
  }
};

/**
 * Makes `address` a link to `target` and answers whether it now resolves to
 * it (`wk_link`): a link made beside it, then renamed onto it. It removes
 * nothing: what sits there is the caller's to judge.
 * @param {string} target
 * @param {string} address
 * @returns {boolean}
 */
const link = (target, address) => {
  const tmp = `${address}.tmp.${process.pid}`;
  try {
    // A temp link a killed run left goes first, so the new one can take its name.
    fs.rmSync(tmp, { force: true });
    fs.symlinkSync(target, tmp);
  } catch {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  if (!mvLink(tmp, address)) {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  const from = path.dirname(address);
  try {
    return path.resolve(from, fs.readlinkSync(address)) === path.resolve(from, target);
  } catch {
    return false;
  }
};

/**
 * Whether `p` is a symlink, a dangling one included.
 * @param {string} p
 * @returns {boolean}
 */
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * A path's physical spelling, through every link, or null when it does not resolve.
 * @param {string} p
 * @returns {string|null}
 */
const physical = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
};

module.exports = {
  link, mvLink, isLink, physical,
};
