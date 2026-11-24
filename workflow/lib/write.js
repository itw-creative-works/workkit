/**
 * workflow/lib/write.js: the write of a file a reader must never see
 * half-written, for the kit's Node scripts, the sign-in file included, and the
 * JSON file changed whole on it (`wk_json_edit` in lib/state.sh).
 * Usage: const { writeWhole, editJson, readJsonText } = require('../lib/write');
 */

const fs = require('fs');
const { warn } = require('./voice');
const { nativePath } = require('./platform');
const { physical } = require('./link');

/**
 * Writes `text` to `file` through a temp file and a rename, so a reader never
 * sees it half-written. A write or a rename that fails leaves no temp file behind.
 * @param {string} file
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.mode] the file's mode: it is created at it, never wider, and set to exactly it before the rename, so the umask cannot narrow it
 * @throws {Error} the failed write's, mode's or rename's own error
 */
const writeWhole = (file, text, { mode } = {}) => {
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    // A temp file a killed write left goes first, so `wx` makes a new one, born at `mode`.
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, text, { mode, flag: 'wx' });
    // The mode is set on the temp file, so a chmod that fails leaves the target as it was.
    if (mode !== undefined) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
};

/**
 * A JSON file's value as jq reads it: `{ value }`, null when its text holds no
 * value at all (blank), undefined when it cannot be read or does not parse.
 * @param {string} file
 * @returns {{value: *}|null|undefined}
 */
const readJsonText = (file) => {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return /^[ \t\r\n]*$/.test(text) ? null : { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
};

/**
 * `change(value)` as two-space JSON and one newline, or undefined when it
 * throws or answers nothing JSON can hold: jq's failed or empty filter.
 * @param {(value: *) => *} change
 * @param {*} value
 * @returns {string|undefined}
 */
const jsonText = (change, value) => {
  try {
    const text = JSON.stringify(change(value), null, 2);
    return text === undefined ? undefined : `${text}\n`;
  } catch {
    return undefined;
  }
};

/**
 * The file a path names, through every link; a path that does not resolve
 * (a dangling link, nothing there) is its own answer, as `readlink -f` falls back.
 * @param {string} file
 * @returns {string}
 */
const targetOf = (file) => physical(file) ?? file;

/**
 * A JSON file changed whole (`wk_json_edit`): the value at `file`, read through
 * its links, handed to `change`, and what that returns written as two-space JSON
 * and one newline, through `writeWhole` beside the target, the target's mode
 * kept. A failure warns the shell's line, leaves the file as it was and no temp file.
 * @param {string} file
 * @param {(value: *) => *} change the new value from the old
 * @param {object} [opts]
 * @param {boolean} [opts.create] a missing file starts as `{}`, taken away again on a failed edit
 * @returns {boolean} true when written
 */
const editJson = (file, change, { create = false } = {}) => {
  if (create && !fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, '{}\n');
    } catch {
      warn(`settings: could not create ${nativePath(file)}`);
      return false;
    }
    if (editJson(file, change)) return true;
    fs.rmSync(targetOf(file), { force: true });
    return false;
  }
  const target = targetOf(file);
  const old = readJsonText(target);
  if (old === undefined) {
    warn(`settings: ${nativePath(target)} cannot be read as JSON (unreadable or not valid JSON); fix or remove it, then try again`);
    return false;
  }
  const text = old === null ? undefined : jsonText(change, old.value);
  if (text === undefined) {
    warn(`settings: could not write ${nativePath(target)} (left unchanged)`);
    return false;
  }
  const { mode } = fs.statSync(target);
  try {
    writeWhole(target, text, { mode: mode & 0o777 });
  } catch (err) {
    warn(err.syscall === 'rename' ? `settings: could not replace ${nativePath(target)}` : `settings: could not write ${nativePath(target)} (left unchanged)`);
    return false;
  }
  return true;
};

module.exports = { writeWhole, editJson, readJsonText };
