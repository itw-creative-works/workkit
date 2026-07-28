//
// The page runtime every tower page boots into.
//
// It owns the things that are the same on all six pages: which feeds this page
// arms, the repo selection held in `?repo=`, the chrome that lets you change
// it, and the paint loop. A page module supplies a mount id, the feeds it
// reads, and one `render(root, state)` — nothing else. The feed table itself
// (paths and cadence) is api.js's, which is where every tower URL is written.
//
// A published copy has no tower to read (api.js's `LIVE`): it keeps its mount,
// its sidebar and its topbar, arms no feeds, and says so where its data would
// be.
//
// Reading the state back out is state.js, which this file does not import: a
// page asks the runtime to run it and asks state.js what the answers were.
//
// The polling itself is the framework's: `createFeedPoller` owns the declared
// feed table, the in-flight count, the timestamp and the keep-last-good rule
// (@omega.js/client/modules/live-page — upstreamed FROM this file). What stays
// here is what is the TOWER's: which feeds exist, the repo selection, the
// chrome, and the paint loop.
//
// The loop calls render() on every answer and on every tick; what reaches the
// DOM is decided further down, by live-page's `swap` in each page's render, so
// a tick that changed nothing leaves the page — and its focus, its scroll and
// its open `details` — exactly as it was. The chrome above the body is held to
// the same rule by its own means: chrome.js writes it in two pieces and this
// file rewrites the frame only when what it shows changed, so a poll passing
// under an open `<select>` no longer closes it.
//

import omega from '@omega.js/client';
import { createFeedPoller } from '@omega.js/client/modules/live-page';
import { loadCharts } from '__main_assets__/js/libs/charts.js';
import { feedFetcher, pageFeeds, LIVE } from './api.js';
import { publishedNotice } from './format.js';
import { chromeKey, chromeMarkup, statusMarkup } from './chrome.js';

// ── The repo selection ─────────────────────────────────────────────────────

/** The repo the whole tower is narrowed to, or '' for all of them. */
export const selectedRepo = () => new URL(location.href).searchParams.get('repo') || '';

const writeSelectedRepo = (slug) => {
  const url = new URL(location.href);
  if (slug) url.searchParams.set('repo', slug);
  else url.searchParams.delete('repo');
  history.replaceState(null, '', url);
};

// ── The runtime ────────────────────────────────────────────────────────────

/**
 * Boot a page.
 *
 * @param {object} options
 * @param {string} options.mount - the id of the page's one mount div
 * @param {string[]} options.feeds - which API feeds this page reads
 * @param {(root: HTMLElement, state: object) => void} options.render - draws the page body
 * @param {boolean} [options.charts] - whether to pull Chart.js in before the first paint
 * @returns {Promise<void>}
 */
export async function startPage(options) {
  await omega.dom().ready();

  const host = document.getElementById(options.mount);
  // The mount is the page's contract with its markdown file. If it is missing,
  // the page was renamed and this module is bound to nothing — say so once
  // rather than throwing on every poll.
  if (!host) {
    console.warn(`[tower] no #${options.mount} on this page — nothing to draw into`);
    return;
  }

  host.innerHTML = '<div data-tower-chrome></div><div data-tower-body></div>';
  const chrome = host.querySelector('[data-tower-chrome]');
  const body = host.querySelector('[data-tower-body]');

  // Published mode is read from the flag itself, never inferred from an empty
  // feed table: a page that legitimately declares no feeds is still a live
  // page. There is no tower to read, so no poller is created and no chrome is
  // drawn — every control in it (the roster select, Refresh, the freshness
  // stamp) needs a feed behind it.
  if (!LIVE) {
    body.innerHTML = publishedNotice();
    return;
  }

  const poller = createFeedPoller({
    // Only the feeds this page asked for: readAll reads the whole table and
    // start() arms a timer per entry, so a page never polls a feed it draws
    // nothing from.
    feeds: pageFeeds(options.feeds),
    fetcher: feedFetcher,
    onChange: () => paint(),
  });

  // The poller owns `feeds`, `pending` and `stamp`. The repo selection is the
  // tower's own and rides the same object, because state.js reads both halves
  // through one argument.
  const state = poller.state;
  state.selectedRepo = selectedRepo();
  // A page that WRITES has to be able to read the result of its own write: the
  // board's poll is a minute away and the API caches the sweep for as long, so
  // a relabel that landed would otherwise be shown as the old state until both
  // expired. It rides the state object for the same reason the selection does —
  // render(root, state) is the whole of a page module's argument list.
  state.refresh = (name) => poller.read(name, true);

  // What the chrome's frame was last drawn from. A poll paints twice — once as
  // the read starts and once as it lands — and rewriting the frame each time
  // re-created the `<select>`, which closed it if it was open while a poll went
  // by. The frame is rewritten only when `chromeKey` says what it shows has
  // changed; the status inside it is rewritten every paint, because that is the
  // half a poll actually changes.
  let painted = null;

  function paint() {
    const key = chromeKey(state);
    if (key !== painted) {
      painted = key;
      chrome.innerHTML = chromeMarkup(state);
      chrome.querySelector('#tower-repo').addEventListener('change', (event) => {
        state.selectedRepo = event.target.value;
        writeSelectedRepo(state.selectedRepo);
        paint();
      });
      chrome.querySelector('#tower-refresh').addEventListener('click', () => poller.readAll(true));
    }
    chrome.querySelector('[data-tower-status]').innerHTML = statusMarkup(state, poller.staleFeeds());
    options.render(body, state);
  }

  // First paint before anything answers, so the page is never a blank region.
  paint();

  if (options.charts) {
    await loadCharts();
    paint();
  }

  await poller.start();
}
