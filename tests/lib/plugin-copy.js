// A plugin-cache copy of the kit: the kit as a plugin install leaves it, with
// no `.git` and no origin, and a `.claude-plugin/plugin.json` manifest naming
// the kit. Where the copy sits (in a Claude plugin cache or not) is the caller's.

const fs = require('fs');
const path = require('path');

const KIT_ROOT = path.join(__dirname, '..', '..');

/**
 * Copy the named kit folders into `root` and write the manifest beside them.
 * @param {string} root - the copy's root, created as needed
 * @param {object} [opts]
 * @param {string} [opts.version] - the version the manifest carries
 * @param {string[]} [opts.dirs] - the kit folders copied, root-relative
 * @returns {string} the copy's `workflow/` folder
 */
const mkPluginCopy = (root, { version = '0.0.0', dirs = ['workflow'] } = {}) => {
  for (const dir of dirs) fs.cpSync(path.join(KIT_ROOT, dir), path.join(root, dir), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), `{ "name": "workkit", "version": "${version}" }\n`);
  return path.join(root, 'workflow');
};

module.exports = { mkPluginCopy };
