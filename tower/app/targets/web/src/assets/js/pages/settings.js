// Settings: the GitHub token this browser holds, and the one page that works
// with no token (tower/README.md § The three modes). The markup is token.js's;
// this file composes and mounts it. `repos` is armed only for the sidebar's
// project selector; the tier line under the token section reads it once more.

import { startPage } from '../libs/tower/page.js';
import { LIVE, MODE, readAnyFeed } from '../libs/tower/api.js';
import { readToken, safeStorage } from '../libs/tower/github.js';
import {
  tokenCard, tokenGuidance, towerTokenNote, tierNote, mountTokenCard,
} from '../libs/tower/token.js';
import { swap } from '@omega.js/client/modules/live-page';

// The github-mode roster answer the tier line is drawn from, and the element it
// is drawn into. Its own host, so the line landing never rewrites the card.
let tier = null;
let tierHost = null;
let tierAsked = false;

const paintTier = () => {
  if (tierHost) swap(tierHost, tierNote(MODE, tier));
};

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
  if (swap(root, `${LIVE ? towerTokenNote() : ''}<div class="row g-4">
    <div class="col-12 col-xl-6">${tokenCard({ held, problem: state.tokenProblem })}</div>
    <div class="col-12 col-xl-6">${tokenGuidance()}</div>
  </div>
  <div data-tower-tier></div>`)) mountTokenCard(root);

  tierHost = root.querySelector('[data-tower-tier]');
  paintTier();

  // Only a copy reading GitHub has a tier to ask about, once: the poller's
  // repos slot holds the unwrapped list, which has lost the tier.
  if (MODE === 'github' && !tierAsked) {
    tierAsked = true;
    readAnyFeed('/api/repos').then((result) => {
      tier = result;
      paintTier();
    });
  }
};

export default () => startPage({
  mount: 'tower-settings',
  feeds: ['repos'],
  tokenless: true,
  render,
});
