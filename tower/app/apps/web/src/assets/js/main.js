//
// The tower's main bundle — the framework's, plus one thing.
//
// A consumer main.js SHADOWS the core one entirely, so it composes rather than
// replaces: `__main_assets__/js/main.js` is the core module, awaited first and
// unchanged. This is the framework's own port recipe (src/migrate/consumer-assets.js).
//
// It exists for a single line. The intake dialog rides the topbar of EVERY page
// (issue #20: "stays reachable from the topbar on every page, not buried on a
// tab"), and the main bundle is the only entry every page loads — a page module
// would wire the dialog on one page and leave it dead on the other five.
//

import coreMain from '__main_assets__/js/main.js';
import omega from '@omega.js/client';
import { mountIntake } from './libs/tower/intake.js';

/**
 * The global module, run once per page by the boot runtime.
 *
 * @param {object} context - `{ manager, options }` from runtime/boot.js
 * @returns {Promise<void>}
 */
export default async function (context) {
  await coreMain(context);
  await omega.dom().ready();
  mountIntake();
}
