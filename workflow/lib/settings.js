// workflow/lib/settings.js: the settings loader (hooks/mods/settings.js) bound
// to the disk, for the kit's Node scripts: the kit's defaults, the machine's
// file, then the repo's, merged, read with fs; and the home slug read through it.
// Usage: const { settingsAt, homeSlug } = require('../lib/settings');

const fs = require('fs');
const path = require('path');
const { homeSlugOf, loadSettings } = require('../../hooks/mods/settings.js');
const { userDir } = require('../user-dir');

const KIT = path.join(__dirname, '..', '..');

/**
 * A file's text, or null when it cannot be read.
 * @param {string} file
 * @returns {string|null}
 */
const readOrNull = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/**
 * The merged settings of a repo root, or of the machine alone with no root.
 * @param {string|null} root the repo root
 * @param {string} [user] the machine's settings file, `<user dir>/settings.json` by default
 * @param {function} [read] a file's text or null, readOrNull by default: a caller
 *   that already holds a file's text hands it back instead of reading it again
 * @returns {object}
 * @throws {Error} when the kit's defaults are missing or do not parse
 */
const settingsAt = (root, user = path.join(userDir(), 'settings.json'), read = readOrNull) => loadSettings(read, { kit: KIT, root, user });

/**
 * The home repo a machine folder's settings name (`site.repo`), or null when
 * it names none or no `owner/name`.
 * @param {string} workflowHome the machine folder, ~/.workkit or a fixture
 * @returns {string|null}
 */
const homeSlug = (workflowHome) => homeSlugOf(settingsAt(null, path.join(workflowHome, 'settings.json')));

module.exports = { settingsAt, readOrNull, homeSlug };
