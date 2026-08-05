//
// The page chrome — the strip above every page body.
//
// It carries Refresh, the Token button a published copy needs, the freshness
// stamp and the chip that names a feed that did not answer. The repo selection
// is NOT here (issue #104): it is global, it belongs beside the nav that
// carries it from page to page, and it is drawn into the sidebar at runtime by
// sidebar.js — a control drawn once per page above one page's body reads as a
// property of that page.
//
// The strip is written in TWO pieces because it is repainted at two different
// rates. The frame — Refresh and Token — changes at most once a session. The
// status — the spinner, the stamp, the stale chip — changes on every read,
// twice per poll (once as it starts, once as it lands). Rebuilding the frame at
// the status's rate re-created the controls under the pointer, so `chromeKey()`
// says what the frame is showing and the runtime rewrites it only when that
// answer changed.
//
// Pure string functions, all three: the runtime owns the DOM, this file owns
// what goes in it.
//

import { esc } from './format.js';

/**
 * What the chrome's frame is showing, as one comparable string.
 *
 * Two states with the same key draw the same frame — which is the whole test
 * the runtime makes before touching it. The Token button is the only thing in
 * the frame that varies at all, so it is the whole key.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string}
 */
export const chromeKey = (state) => (state.tokenMode ? 'token' : '');

/**
 * The chrome's frame: Refresh, the Token button a published copy carries, and
 * the empty region the status is written into.
 *
 * `state.tokenMode` is the runtime's word for "this copy runs on the viewer's
 * own GitHub token" — the button is how that token is replaced or taken away,
 * and a copy reading a tower has none to forget.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string} markup
 */
export const chromeMarkup = (state) => `<div class="d-flex flex-wrap align-items-end gap-2 mb-4">
    <button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-refresh">Refresh</button>
    ${state.tokenMode ? '<button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-token" title="Forget the GitHub token this browser holds">Token</button>' : ''}
    <div class="ms-auto d-flex align-items-center gap-2" data-tower-status></div>
  </div>`;

/**
 * The chrome's status: whether a read is in flight, when the last one landed,
 * and which feeds are unavailable.
 *
 * @param {object} state - the runtime's feed state
 * @param {{name: string, reason: string}[]} stale - the feeds that did not answer
 * @returns {string} markup
 */
export const statusMarkup = (state, stale) => `<span class="omega-micro text-body-secondary d-flex align-items-center gap-2">
    ${state.pending ? '<span class="spinner-border spinner-border-sm" role="status" aria-label="Reading"></span>' : ''}
    ${esc(state.stamp || 'reading…')}
  </span>
  ${stale.length ? `<span class="omega-chip omega-chip--accent" title="${esc(stale.map((entry) => `${entry.name}: ${entry.reason}`).join(' · '))}">${stale.length} feed${stale.length === 1 ? '' : 's'} unavailable</span>` : ''}`;
