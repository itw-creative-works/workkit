// The PATH lookup for `needs` (harness.js) and `modCase` (lib/mods.js): which
// files are named for a command, and whether one would run. The door does not
// re-export it.

import fs from 'node:fs';
import path from 'node:path';

// Whether `file` passes the `access` check `mode` names and is a file; any error is a no.
const passes = (file, mode) => {
  try {
    fs.accessSync(file, mode);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

// Whether `file` is a file or a link, the link's target unread; any error is a no.
const isEntry = (file) => {
  try {
    const entry = fs.lstatSync(file);
    return entry.isFile() || entry.isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Each file or link on the PATH named `name`, in PATH order: the name alone,
 * and on Windows the name plus each PATHEXT extension too; its run bit unread,
 * and a link to nothing found too.
 * @param {string} name a command name
 * @returns {string[]}
 */
export const filesOnPath = (name) => {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
  const names = [name, ...exts.map((ext) => `${name}${ext}`)];
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .flatMap((dir) => names.map((candidate) => path.join(dir, candidate)))
    .filter(isEntry);
};

/**
 * Whether PATH's search would run a file as `name`: on Windows a file
 * `filesOnPath` finds that has an extension and is there (a link to nothing
 * is not), elsewhere an executable one.
 * @param {string} name a command name
 * @returns {boolean}
 */
export const onPath = (name) => filesOnPath(name).some((file) => (process.platform === 'win32'
  ? path.extname(file) !== '' && passes(file, fs.constants.F_OK)
  : passes(file, fs.constants.X_OK)));
