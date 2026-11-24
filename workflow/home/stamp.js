/**
 * workflow/home/stamp.js: the clone's version stamp and the compare that
 * refuses a downgrade. The kit's manifest is read through committed.js's
 * `file`, the committed copy, so it agrees with the bytes the writers copy.
 * Usage: const { STAMP, kitVersion, downgrades, stampWrite } = require('./stamp');
 */

const fs = require('fs');
const path = require('path');
const { towerDir } = require('../user-dir');
const { compareVersions } = require('../ship/semver');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { warn } = require('../lib/voice');
const { file } = require('./committed');
const { kitDir } = require('./options');

// The kit version the clone was last written from: one file at the root for
// every writer, since they all seed from one checkout.
const STAMP = '.workkit-version';

/** The stamp's text, or null with none. */
const stampText = () => {
  const file = path.join(towerDir(), STAMP);
  if (!isFile(file)) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * This checkout's kit version, or '' for "do not know", which nothing here
 * ever refuses on.
 * @returns {string}
 */
const kitVersion = () => {
  const manifest = file(kitDir(), '.claude-plugin/plugin.json');
  if (manifest === null) return '';
  let version;
  try {
    ({ version } = JSON.parse(manifest));
  } catch {
    return '';
  }
  if (version === null || version === undefined || version === false) return '';
  return typeof version === 'string' ? version : JSON.stringify(version);
};

/**
 * The clone's stamp, or ''; an unstamped clone is written as usual. The
 * version is the first line, its spaces dropped.
 * @returns {string}
 */
const stampRead = () => {
  const text = stampText();
  return text === null ? '' : text.split('\n')[0].replace(/\s/g, '');
};

/**
 * The top-level app folders the last sync recorded, in order; none for a
 * stamp from before the list.
 * @returns {string[]}
 */
const stampFolders = () => {
  const text = stampText();
  if (text === null) return [];
  return text.split('\n').slice(1).join('\n').split(/\s+/).filter(Boolean);
};

/**
 * Would writing from this checkout downgrade the clone? Reads the working
 * copy's stamp and never fetches. A version either side cannot read is no
 * downgrade.
 * @returns {boolean} true when this checkout is older (write nothing)
 */
const downgrades = () => {
  const stamp = stampRead();
  if (!stamp) return false;
  const mine = kitVersion();
  if (!mine) return false;
  let newer;
  try {
    newer = compareVersions(stamp, mine) > 0;
  } catch {
    return false;
  }
  if (!newer) return false;
  warn(`home: the clone carries workkit ${stamp} and this kit is ${mine}; not downgrading; run \`workkit update\` here`);
  return true;
};

/** Lines as one text, trailing newlines dropped, as a shell capture reads them. */
const captured = (lines) => lines.join('\n').replace(/\n+$/, '');

/**
 * The stamp written by content beside the caller's write, so it rides the
 * same commit. The sync passes the folders it synced; a writer passing none
 * keeps the list already there.
 * @param {string[]} [folders]
 * @returns {boolean} true written (the caller counts a change), false nothing to write
 */
const stampWrite = (folders = []) => {
  const mine = kitVersion();
  if (!mine) return false;
  const body = captured([mine, ...(folders.length > 0 ? folders : stampFolders())]);
  // Compared as read, so a checkout's CRLF or spacing is never a change.
  if (captured([stampRead(), ...stampFolders()]) === body) return false;
  try {
    fs.writeFileSync(path.join(towerDir(), STAMP), `${body}\n`);
  } catch {
    warn(`home: could not write ${STAMP} into ${nativePath(towerDir())}; the next machine to seed this clone cannot tell which kit wrote what is in it`);
    return false;
  }
  return true;
};

module.exports = {
  STAMP, kitVersion, stampRead, stampFolders, downgrades, stampWrite,
};
