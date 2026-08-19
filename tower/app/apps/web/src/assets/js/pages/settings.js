//
// Settings - the GitHub token this browser holds (issue #167).
//
// The one page that works with NO token, which is what makes it a page at all:
// the token used to be asked for in a dialog that could not be dismissed, over
// whichever data page the viewer happened to land on, so a copy with nothing to
// draw had nowhere to be. Now it has somewhere. The runtime sends a tokenless
// landing here (`tokenless: true`, page.js), every other page points at it in a
// line, and this is where a token is saved, replaced and forgotten - the last
// of those being the chrome's old Token button.
//
// It draws in every mode. On a published copy the card is the credential the
// whole site runs on; on a copy reading a tower it is the note that the machine
// holds the login already, above the same card - a token saved here is what a
// published copy uses, and saying nothing would let the card read as this
// dashboard's own key.
//
// The markup is token.js's, like every other page's is a lib's: the card, the
// permissions guidance and the two listeners live beside the storage they read
// and write, and this file is the composition and the mount.
//
// `repos` is the one feed it arms - not for anything on the page, but for the
// sidebar's project selector, which every other page fills from the same read.
// A locked copy arms nothing at all: the runtime draws this page once, without
// a poller, since the token every feed needs is the thing being asked for.
//

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
  // Read at paint time rather than held: Save and Clear both reload the page,
  // so what this browser holds is only ever read once per load anyway - and
  // reading it here is what makes the card and the storage impossible to
  // disagree about.
  const held = Boolean(readToken(safeStorage(window)));

  // Nothing on this page comes from a feed, so a poll landing produces the same
  // markup and `swap` leaves it alone - which is what keeps a half-typed token
  // in the field while the roster refreshes behind the sidebar.
  if (!swap(root, `${LIVE ? towerTokenNote() : ''}${tokenCard({ held, problem: state.tokenProblem })}${tokenGuidance()}`)) return;

  mountTokenCard(root);
};

export default () => startPage({
  mount: 'tower-settings',
  feeds: ['repos'],
  tokenless: true,
  render,
});
