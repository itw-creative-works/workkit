// Settings: the GitHub token this browser holds, and the one page that works
// with no token (tower/README.md § The three modes). The markup is token.js's;
// this file composes and mounts it. `repos` is armed only for the sidebar's
// project selector.

import { startPage } from '../libs/tower/page.js';
import { LIVE } from '../libs/tower/api.js';
import { readToken, safeStorage } from '../libs/tower/github.js';
import {
  tokenCard, tokenGuidance, towerTokenNote, mountTokenCard,
} from '../libs/tower/token.js';
import { swap } from '@omega.js/client/modules/live-page';

/**
 * Draw the page.
 * @param {HTMLElement} root the page body
 * @param {object} state the runtime's feed state
 */
const render = (root, state) => {
  // Read at paint time, so the card and the storage can never disagree.
  const held = Boolean(readToken(safeStorage(window)));

  // Nothing here comes from a feed, so a poll produces the same markup and
  // `swap` leaves it alone: a half-typed token survives the roster refresh.
  if (!swap(root, `${LIVE ? towerTokenNote() : ''}<div class="row g-4">
    <div class="col-12 col-xl-6">${tokenCard({ held, problem: state.tokenProblem })}</div>
    <div class="col-12 col-xl-6">${tokenGuidance()}</div>
  </div>`)) return;

  mountTokenCard(root);
};

export default () => startPage({
  mount: 'tower-settings',
  feeds: ['repos'],
  tokenless: true,
  render,
});
