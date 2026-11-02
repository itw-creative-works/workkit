// The kit pieces every settings read needs in a partial copy of the kit: the
// defaults file and the hooks modules workflow/lib/settings.js requires, ES modules
// under hooks/package.json's "type". Consumers: publish/helpers.js's copyEngine
// (publish-sync's too) and the workkit-cli helpers' kit copies.

const fs = require('fs');
const path = require('path');

const KIT = path.join(__dirname, '..', '..');
const PIECES = ['defaults/settings.json', 'hooks/package.json', 'hooks/mods/settings.js', 'hooks/mods/gate.js', 'hooks/mods/log.js'];

/**
 * Copy the settings pieces into `kit`, a partial copy of the kit.
 * @param {string} kit - the copy's root
 */
const copySettingsKit = (kit) => {
  for (const rel of PIECES) {
    fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), path.join(kit, rel));
  }
};

module.exports = { copySettingsKit };
