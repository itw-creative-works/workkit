//
// The second hand.
//
// Everything else on the tower moves when a FEED moves: the poller reads every
// ten seconds (crew) or sixty (board) and each answer repaints the page. That is
// right for counts and columns and wrong for the one thing measured in seconds —
// an agent's freshness, which is drawn as `12s` beside a glyph that spins while
// it is working. Between two reads the number sat still and the phase it decides
// (agent.activityPhase) was only ever evaluated at poll cadence, so a card went
// from green to gray up to ten seconds late.
//
// This is the missing clock, and it is deliberately NOT a repaint. A page's
// render writes its whole subtree in one `innerHTML` (live-page's `swap`), which
// every second would restart the very animation this exists to keep running and
// take hover and selection with it. So the tick patches instead: it finds the
// indicators the paint already drew, re-decides each one from the stamps ITS
// OWN markup carries (`data-live-*`, written by agent.crewActivity), and writes
// only the text and classes that actually changed.
//
// One decision, two callers: `activityTick` is the paint's arithmetic too, so
// the tick can never disagree with the render that drew the element.
//

import { activityTick, activityClass } from './agent.js';

/** How often the second hand moves. A second, because the label is in seconds. */
const TICK_MS = 1000;

// The one timer. Module-level because there is one page per document and the
// clock belongs to the document, not to a render — a second `startClock` (a page
// re-boot in a live-reloading dev server) replaces it rather than adding to it.
let timer = null;

/**
 * Bring every drawn indicator under `host` up to `now`.
 *
 * Idempotent by construction: same stamps and same second in, same DOM out, and
 * a tick that changes nothing writes nothing — every mutation below is behind a
 * comparison, because a blind write of an unchanged class is a style
 * recalculation sixty times a minute for every card on the page.
 *
 * @param {ParentNode} host the document body — the dialogs carry indicators too
 *   and live outside the page mount
 * @param {number} [now] ms epoch
 */
export const applyLive = (host, now = Date.now()) => {
  for (const element of host.querySelectorAll('[data-live-ts]')) {
    const { phase, age, title } = activityTick(element.dataset, now);

    // Past the cutoff the indicator is not gray, it is GONE — and with its
    // stamp removed it drops out of this walk until a paint draws it again,
    // which is the only thing that can bring it back (a fresher timestamp
    // arrives with a feed, never with a tick).
    if (phase === 'none') {
      element.removeAttribute('data-live-ts');
      element.replaceChildren();
      continue;
    }

    const label = element.querySelector('[data-live-age]');
    if (label && label.textContent !== age) label.textContent = age;

    const icon = element.querySelector('.omega-tower-activity');
    if (!icon) continue;
    // COUPLING: this writes the icon's class list WHOLESALE, which is correct
    // only because `agent.activityClass` is the entire class attribute the
    // paint gives that element. Any class a drawing path adds to the indicator
    // span is stripped by the next tick — put it on the wrapper or inside the
    // glyph, or teach activityClass about it.
    const classes = activityClass(phase);
    if (icon.className !== classes) icon.className = classes;
    if (icon.getAttribute('title') !== title) icon.setAttribute('title', title);
    // The glyph's motion IS the phase. Toggling the one class leaves the
    // element in place, so a card that stays working keeps one unbroken spin
    // across every tick under it.
    const glyph = icon.querySelector('i');
    if (glyph) glyph.classList.toggle('fa-spin', phase === 'working');
    // What a screen reader hears is the same verdict as the colour, so it moves
    // with it rather than keeping the word the paint happened to write.
    const spoken = icon.querySelector('.visually-hidden');
    if (spoken && spoken.textContent !== phase) spoken.textContent = phase;
  }
};

/**
 * Start the second hand over the document.
 *
 * Harmless on a page that draws no indicators — the walk finds nothing and the
 * tick is a no-op — so the runtime arms it for every page rather than making
 * each one declare whether it has anything that ages.
 *
 * @param {ParentNode} host the document body — the dialogs carry indicators too
 *   and live outside the page mount
 */
export const startClock = (host) => {
  if (timer) clearInterval(timer);
  timer = setInterval(() => applyLive(host), TICK_MS);
};
