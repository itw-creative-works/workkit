// The page chrome, the strip above every page body: Refresh, the freshness
// stamp and the stale-feed chip. Two pieces, repainted at two rates: the frame
// is written once per page, since rebuilding it would re-create the controls
// under the pointer, and the status on every read. Pure string functions.

import { esc } from '../format.js';

/**
 * The chrome's frame: Refresh, and the empty region the status is written into.
 * It takes no state, which is why it is written once.
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
