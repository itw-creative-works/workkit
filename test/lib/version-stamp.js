// The version stamp a clone carries at its root, as the suites read it back:
// the version on the stamp's first line (a folder list may follow it), and the
// kit version a stamp written from this checkout should hold.

const fs = require('fs');
const path = require('path');

const KIT_DIR = path.join(__dirname, '..', '..');

/** Where the stamp lives at a clone's root and what it is called: the name is the contract. */
const STAMP = '.workkit-version';

/** The version on <file>'s first line, or null when there is no stamp. */
const readStamp = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n')[0].trim() : null);

/** This checkout's version, as its plugin manifest says it. */
const kitVersion = () => JSON.parse(
  fs.readFileSync(path.join(KIT_DIR, '.claude-plugin', 'plugin.json'), 'utf8'),
).version;

module.exports = { STAMP, readStamp, kitVersion };
