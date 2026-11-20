/**
 * workflow/lib/write.js: the write of a file a reader must never see
 * half-written, for the kit's Node scripts.
 * Usage: const { writeWhole } = require('../lib/write');
 */

const fs = require('fs');

/**
 * Writes `text` to `file` through a temp file and a rename, so a reader never
 * sees it half-written. A write or a rename that fails leaves no temp file behind.
 * @param {string} file
 * @param {string} text
 * @throws {Error} the failed write's or rename's own error
 */
const writeWhole = (file, text) => {
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
};

module.exports = { writeWhole };
