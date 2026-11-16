// A kit file the package ships a copy of (`run`, `expand-workspaces`): in the
// kit's own checkout (the folder two above the package, its package.json named
// `workkit`) the kit's file, so a copy a local `npm pack` left never wins;
// elsewhere the packed copy at the package's root, never a consumer repo's file.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = path.join(import.meta.dirname, '..', '..');
const KIT_ROOT = path.join(PACKAGE_ROOT, '..', '..');
const KIT_MANIFEST = path.join(KIT_ROOT, 'package.json');
const IN_KIT = fs.existsSync(KIT_MANIFEST) && JSON.parse(fs.readFileSync(KIT_MANIFEST, 'utf8')).name === 'workkit';

/**
 * The exports of the kit's `workflow/lib/<stem>.js` in the kit's checkout, else of `<stem>.cjs` at the package's root.
 * @param {string} stem the file's name without its extension
 * @returns {object}
 */
export const kitModule = (stem) => require(IN_KIT
  ? path.join(KIT_ROOT, 'workflow', 'lib', `${stem}.js`)
  : path.join(PACKAGE_ROOT, `${stem}.cjs`));
