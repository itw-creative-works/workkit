//
// The one writer of a scratch folder: every suite and helper makes its
// throwaway directories here, and one exit handler removes them all (forced, so
// a folder a case already removed is harmless). The path is always resolved:
// the temp dir is a symlink on macOS, and a child's output names the resolved
// form.
//

const fs = require('fs');
const os = require('os');
const path = require('path');

const made = [];

process.on('exit', () => {
  for (const dir of made) {
    // A folder a hard-ended child still holds never stops the removals after it.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

/** A fresh folder in the temp dir, named `<prefix>XXXXXX`, removed at exit. */
const mkTmp = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
};

module.exports = { mkTmp };
