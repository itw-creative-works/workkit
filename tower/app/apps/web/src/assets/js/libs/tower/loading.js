//
// Loading, and the discipline of refreshing in place.
//
// Every page is polled: the runtime re-reads its feeds on a timer and calls
// render() again with the answers. The naive shape of that — write the whole
// body on every tick — repaints identical markup ten times a minute, which
// blinks the cards, drops the scroll position inside a scrolling strip and
// closes whatever `details` was open. And before the first answer arrives the
// same render drew an empty line, so a slow feed looked like an empty one.
//
// Two functions, one rule each. `loading()` is what a section shows while its
// feed has never answered, and `swap()` writes markup ONLY when it differs from
// what was written last — so an unchanged section is left alone, DOM, focus,
// scroll and all. A section is never cleared to empty on the way to new data:
// the old markup stays up until the new markup exists to replace it.
//
// The comparison is against what swap itself last wrote, held in a WeakMap, and
// NOT against `host.innerHTML` — the browser re-serializes what it parses
// (attribute order, entities, void tags), so reading it back never matches the
// string that produced it and every tick would count as a change.
//

import { esc } from './format.js';

/** What swap last wrote into each host, keyed by the element itself. */
const written = new WeakMap();

/**
 * The markup a section shows while its feed has not answered yet.
 *
 * The theme's spinner, in the muted voice the "nothing here" line uses — a
 * first paint says which read it is waiting on, never a blank region.
 *
 * @param {string} message - what is being read, in the page's own words
 * @returns {string} markup
 */
export const loading = (message) => `<div class="d-flex align-items-center gap-2 text-body-secondary">
  <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
  <span class="classy-micro" aria-live="polite">${esc(message)}</span>
</div>`;

/**
 * Write markup into a host, but only when it is not already there.
 *
 * @param {{innerHTML: string}} host - the element to draw into
 * @param {string} markup - what the render produced this time
 * @returns {boolean} true when the DOM was written, false when it was left alone
 *   — the caller's post-draw work (charts, listeners) hangs off this
 */
export const swap = (host, markup) => {
  if (written.get(host) === markup) return false;
  written.set(host, markup);
  host.innerHTML = markup;
  return true;
};
