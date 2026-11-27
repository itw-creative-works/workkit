/**
 * workflow/lib/link.js: a machine address made a link, for the kit's Node
 * scripts: renamed onto the address, never removed first, so no other session
 * sees a gap; on Windows alone a folder link naming something else is removed
 * first.
 * Usage: const { link, mvLink, isLink, physical } = require('../lib/link');
 */

const fs = require('fs');
const path = require('path');

/**
 * Renames `from` onto `to` without following a link at `to`:
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
 * Whether the link at `address` names `target`, read against its folder.
 * @param {string} target
 * @param {string} address
 * @returns {boolean}
 */
const names = (target, address) => {
  const from = path.dirname(address);
  try {
    return path.resolve(from, fs.readlinkSync(address)) === path.resolve(from, target);
  } catch {
    return false;
  }
};

/**
 * Windows renames nothing onto a folder link, so there the link at `address`
 * is removed and `tmp` renamed again; one already naming `target` is another
 * session's win and stays. Elsewhere a refused rename is final.
 * @param {string} tmp
 * @param {string} target
 * @param {string} address
 * @returns {boolean} whether `address` now holds a link to `target`
 */
const replaceOnWindows = (tmp, target, address) => {
  if (process.platform !== 'win32' || !isLink(address)) return false;
  if (names(target, address)) return true;
  try {
    fs.unlinkSync(address);
  } catch (err) {
    if (err.code !== 'ENOENT') return false;
  }
  // A session that lost the rename to another writing the same link still won.
  return mvLink(tmp, address) || names(target, address);
};

/**
 * Makes `address` a link to `target` and answers whether it now resolves to
 * it: a link made beside it, then renamed onto it. It removes
 * nothing but, on Windows, a link there naming something else: what sits
 * there is the caller's to judge.
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
  const moved = mvLink(tmp, address) || replaceOnWindows(tmp, target, address);
  fs.rmSync(tmp, { force: true });
  return moved && names(target, address);
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
