//
// The page chrome — the strip above every page body.
//
// It carries the repo selector, Refresh, the freshness stamp and the chip that
// names a feed that did not answer. The selector lives HERE, in the page's own
// chrome, and NOT in the sidebar's `selector` block: the sidebar is a JSON file
// baked at build time and the roster is whatever repos are on the machine when
// the page is open, read from /api/repos. A build-time file cannot hold a
// runtime list, so the selector is drawn where the data is.
//
// The strip is written in TWO pieces because it is repainted at two different
// rates. The frame — the label, the `<select>` and Refresh — changes only when
// the roster or the selection changes, which is a handful of times a session.
// The status — the spinner, the stamp, the stale chip — changes on every read,
// twice per poll (once as it starts, once as it lands). Rebuilding the frame at
// the status's rate re-created the `<select>` under the pointer and closed it if
// it was open mid-poll, so `chromeKey()` says what the frame is showing and the
// runtime rewrites it only when that answer changed.
//
// Pure string functions, all three: the runtime owns the DOM, this file owns
// what goes in it.
//

import { esc } from './format.js';
import { repos } from './state.js';

/** The roster slugs the selector offers, in roster order. */
const slugsOf = (state) => repos(state).map((repo) => repo.slug).filter(Boolean);

/**
 * What the chrome's frame is showing, as one comparable string.
 *
 * Two states with the same key draw the same frame — which is the whole test
 * the runtime makes before touching it. Newlines separate the parts because a
 * slug cannot contain one.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string}
 */
export const chromeKey = (state) => [state.selectedRepo || '', ...slugsOf(state)].join('\n');

/**
 * The chrome's frame: the repo selector, Refresh, and the empty region the
 * status is written into.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string} markup
 */
export const chromeMarkup = (state) => {
  const slugs = slugsOf(state);
  return `<div class="d-flex flex-wrap align-items-end gap-2 mb-4">
    <label class="flex-grow-0">
      <span class="classy-micro d-block">Repository</span>
      <select class="form-select form-select-sm" id="tower-repo" aria-label="Filter every page by repository">
        <option value=""${state.selectedRepo ? '' : ' selected'}>All repos${slugs.length ? ` (${slugs.length})` : ''}</option>
        ${slugs.map((slug) => `<option value="${esc(slug)}"${slug === state.selectedRepo ? ' selected' : ''}>${esc(slug)}</option>`).join('')}
      </select>
    </label>
    <button class="btn btn-sm btn-outline-adaptive" type="button" id="tower-refresh">Refresh</button>
    <div class="ms-auto d-flex align-items-center gap-2" data-tower-status></div>
  </div>`;
};

/**
 * The chrome's status: whether a read is in flight, when the last one landed,
 * and which feeds are unavailable.
 *
 * @param {object} state - the runtime's feed state
 * @param {{name: string, reason: string}[]} stale - the feeds that did not answer
 * @returns {string} markup
 */
export const statusMarkup = (state, stale) => `<span class="classy-micro text-body-secondary d-flex align-items-center gap-2">
    ${state.pending ? '<span class="spinner-border spinner-border-sm" role="status" aria-label="Reading"></span>' : ''}
    ${esc(state.stamp || 'reading…')}
  </span>
  ${stale.length ? `<span class="classy-chip classy-chip--accent" title="${esc(stale.map((entry) => `${entry.name}: ${entry.reason}`).join(' · '))}">${stale.length} feed${stale.length === 1 ? '' : 's'} unavailable</span>` : ''}`;
