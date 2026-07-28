//
// The tower's main bundle — the framework's, plus one thing.
//
// A consumer main.js SHADOWS the core one entirely, so it composes rather than
// replaces: `__main_assets__/js/main.js` is the core module, awaited first and
// unchanged. This is the framework's own port recipe (src/migrate/consumer-assets.js).
//
// It exists for the three dialogs that ride EVERY page. The intake dialog is on
// the topbar (issue #20: "stays reachable from the topbar on every page, not
// buried on a tab"), the issue dialog opens from four of the six pages and the
// agent dialog from the Crew page — and the main bundle is the only entry every
// page loads, so a page module would wire them on one page and leave them dead
// on the rest.
//

import coreMain from '__main_assets__/js/main.js';
import omega from '@omega.js/client';
import { mountIntake } from './libs/tower/intake.js';
import { mountIssueModal, mountAgentModal } from './libs/tower/modal.js';

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
  // The issue dialog draws a body with the framework's escape-first markdown
  // renderer. It is handed in here, where the singleton already is, so modal.js
  // stays pure string functions the suite can run under Node.
  mountIssueModal({ render: (text) => omega.utilities().renderMarkdown(text) });
  // The agent dialog writes no markdown — every field on it is a number, a
  // name or a path — so it needs nothing handed in.
  mountAgentModal();
}
