// The second hand: between polls it patches the activity indicators the last
// paint drew, re-deciding each from its own `data-live-*` stamps through the
// paint's `activityTick`. A patch, never a repaint: a repaint every second would
// restart the spin it exists to keep turning (`tower/README.md` § The pages).

import { activityTick, activityClass, mutedClass, MUTED_CLASS } from './agent.js';

/** How often the second hand moves. A second, because the label is in seconds. */
const TICK_MS = 1000;

// The one timer. Module-level because there is one page per document and the
// clock belongs to the document, not to a render - a second `startClock` (a page
// re-boot in a live-reloading dev server) replaces it rather than adding to it.
let timer = null;

/**
 * Bring every drawn indicator under `host` up to `now`. Every write is behind
 * a comparison, so a tick that changes nothing writes nothing.
 *
 * @param {ParentNode} host the document body - the dialogs carry indicators too
 *   and live outside the page mount
 * @param {number} [now] ms epoch
 */
export const applyLive = (host, now = Date.now()) => {
  // The cards first: the walk below strips a gone indicator's stamps, and a
  // card that just went muted is read while its indicator still says so.
  for (const element of host.querySelectorAll('[data-live-card]')) {
    const live = element.querySelector('[data-live-ts]');
    if (!live) continue;
    element.classList.toggle(MUTED_CLASS, !!mutedClass(activityTick(live.dataset, now).phase));
  }

  for (const element of host.querySelectorAll('[data-live-ts]')) {
    const { phase, age, title } = activityTick(element.dataset, now);

    // Past five minutes the indicator is gone: with its stamp removed it drops
    // out of this walk until a paint draws it again with a fresher timestamp.
    if (phase === 'none') {
      element.removeAttribute('data-live-ts');
      element.replaceChildren();
      continue;
    }

    const label = element.querySelector('[data-live-age]');
    if (label && label.textContent !== age) label.textContent = age;

    const icon = element.querySelector('.omega-tower-activity');
    if (!icon) continue;
    // This writes the icon's whole class list, correct only because
    // `agent.activityClass` is the entire class attribute the paint gives it:
    // put any other class on the wrapper or inside the glyph.
    const classes = activityClass(phase);
    if (icon.className !== classes) icon.className = classes;
    if (icon.getAttribute('title') !== title) icon.setAttribute('title', title);
    // Toggling the one class leaves the element in place, so a card that stays
    // working keeps one unbroken spin across every tick.
    const glyph = icon.querySelector('i');
    if (glyph) glyph.classList.toggle('fa-spin', phase === 'working');
    // What a screen reader hears is the same verdict as the colour, so it moves
    // with it rather than keeping the word the paint happened to write.
    const spoken = icon.querySelector('.visually-hidden');
    if (spoken && spoken.textContent !== phase) spoken.textContent = phase;
  }
};

/**
 * Start the second hand over the document. Harmless on a page with no
 * indicators, so the runtime arms it for every page.
 *
 * @param {ParentNode} host the document body - the dialogs carry indicators too
 *   and live outside the page mount
 */
export const startClock = (host) => {
  if (timer) clearInterval(timer);
  timer = setInterval(() => applyLive(host), TICK_MS);
};
