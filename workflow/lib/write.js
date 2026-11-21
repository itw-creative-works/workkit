/**
 * workflow/lib/write.js: the write of a file a reader must never see
 * half-written, for the kit's Node scripts, the sign-in file included.
 * Usage: const { writeWhole } = require('../lib/write');
 */

const fs = require('fs');

/**
 * Writes `text` to `file` through a temp file and a rename, so a reader never
 * sees it half-written. A write or a rename that fails leaves no temp file behind.
 * @param {string} file
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.mode] the new file's mode, which it is created at: never wider, not even for a moment
 * @throws {Error} the failed write's or rename's own error
 */
const writeWhole = (file, text, { mode } = {}) => {
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    // A temp file a killed write left goes first, so `wx` makes a new one, born at `mode`.
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
};

module.exports = { writeWhole };
