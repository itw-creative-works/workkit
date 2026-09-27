// The tower's main bundle: the core one (a consumer main.js shadows it, so it is
// awaited first, unchanged) plus the three dialogs every page carries, wired
// here because this is the one entry every page loads.

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
  // Handed in here, where the singleton is, so modal.js stays pure string
  // functions the suite can run under Node.
  mountIssueModal({ render: (text) => omega.utilities().renderMarkdown(text) });
  mountAgentModal();
}
