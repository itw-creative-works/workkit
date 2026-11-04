// workflow/lib/settings.js: the settings loader (hooks/mods/settings.js) bound
// to the disk, for the kit's Node scripts: the kit's defaults, the machine's
// file, then the repo's, merged, read with fs; what that merge set aside; and
// the home slug read through it.
// Usage: const { settingsAt, faultsAt, homeSlug } = require('../lib/settings');

const path = require('path');
const { homeSlugOf, loadSettings, settingsFaults } = require('../../hooks/mods/settings.js');
const { userDir } = require('../user-dir');
const { readOrNull } = require('./read');

const KIT = path.join(__dirname, '..', '..');

/**
 * The merged settings of a repo root, or of the machine alone with no root.
 * @param {string|null} root the repo root
 * @param {string} [user] the machine's settings file, `<user dir>/settings.json` by default
 * @returns {object}
 * @throws {Error} when the kit's defaults are missing or do not parse
 */
const settingsAt = (root, user = path.join(userDir(), 'settings.json')) => loadSettings(readOrNull, { kit: KIT, root, user });

/**
 * settingsFaults over the files settingsAt reads: one `{ file, key, line }`
 * per layer or value the merge set aside.
 * @param {string|null} root the repo root
 * @param {string} [user] the machine's settings file, `<user dir>/settings.json` by default
 * @returns {object[]}
 * @throws {Error} when the kit's defaults are missing or do not parse
 */
const faultsAt = (root, user = path.join(userDir(), 'settings.json')) => settingsFaults(readOrNull, { kit: KIT, root, user });

/**
 * The home repo a machine folder's settings name (`site.repo`), or null when
 * it names none or no `owner/name`.
 * @param {string} workflowHome the machine folder, ~/.workkit or a fixture
 * @returns {string|null}
 */
const homeSlug = (workflowHome) => homeSlugOf(settingsAt(null, path.join(workflowHome, 'settings.json')));

module.exports = { settingsAt, faultsAt, homeSlug };
