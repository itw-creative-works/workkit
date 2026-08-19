//
// The page chrome - the strip above every page body.
//
// It carries Refresh, the freshness stamp and the chip that names a feed that
// did not answer. The repo selection is NOT here (issue #104): it is global, it
// belongs beside the nav that carries it from page to page, and it is drawn
// into the sidebar at runtime by sidebar.js - a control drawn once per page
// above one page's body reads as a property of that page. Neither is the token
// (issue #167): the Token button that forgot it now lives on the Settings page,
// which is where a token is typed in the first place.
//
// The strip is written in TWO pieces because it is repainted at two different
// rates. The frame - Refresh, and the region the status goes in - never changes
// at all now that the Token button has left it, so the runtime writes it ONCE
// per page and never again; rebuilding it at the status's rate re-created the
// controls under the pointer, which is the defect that first split it in two.
// The status - the spinner, the stamp, the stale chip - changes on every read,
// twice per poll (once as it starts, once as it lands).
//
// Pure string functions, both: the runtime owns the DOM, this file owns what
// goes in it.
//

import { esc } from './format.js';

/**
 * The chrome's frame: Refresh, and the empty region the status is written into.
 *
 * It takes no state, which is the whole of why it is written once: nothing on
 * it varies by page, by mode or by read.
 *
 * @returns {string} markup
 */
export const chromeMarkup = () => `<div class="d-flex flex-wrap align-items-end gap-2 mb-4">
    <button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-refresh">Refresh</button>
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
