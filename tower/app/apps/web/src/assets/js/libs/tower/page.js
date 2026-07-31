//
// The page runtime every tower page boots into.
//
// It owns the things that are the same on all six pages: which feeds this page
// arms, the repo selection held in `?repo=`, the chrome that lets you change
// it, and the paint loop. A page module supplies a mount id, the feeds it
// reads, and one `render(root, state)` — nothing else. The feed table itself
// (paths and cadence) is api.js's, which is where every tower URL is written.
//
// A published copy keeps its mount, its sidebar and its topbar, and what it
// draws into them is its MODE (api.js): unlocked, it polls GitHub itself with
// the viewer's token, through the same feed names and the same paint loop;
// locked, the shell stays and the unlock dialog opens over it; and either way
// a page whose data is this machine's — the crew, the spend, the working
// copies — says so instead (`local: true`).
//
// Reading the state back out is state.js: a page asks the runtime to run it and
// asks state.js what the answers were. The one thing this file takes from there
// is the SHAPE of a slot it fills itself — the local-only stand-in, which lives
// beside the reader that keys on it rather than being written twice.
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
import {
  feedFetcher, githubFetcher, pageFeeds, githubPageFeeds, LIVE, MODE,
} from './api.js';
import { localOnlyNotice } from './format.js';
import { localOnlySlot } from './state.js';
import { clearToken, isTokenRefusal, safeStorage } from './github.js';
import {
  isLocalHost, towerDownNotice, openTokenModal, hideTokenModal,
} from './token.js';
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
 * @param {boolean} [options.local] - whether this page reads the machine itself,
 *   and so has nothing to show in a published copy
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

  // The mode is read from the flag itself, never inferred from an empty feed
  // table: a page that legitimately declares no feeds is still a live page.
  //
  // Locked: no data of any kind is reachable, so there is no poller and no
  // chrome — every control in the chrome needs a feed behind it. What the
  // viewer is told forks on the hostname (issue #89), on token.js's one
  // predicate. On THIS machine the tower is simply not connected, and that
  // notice is the page body, carrying the link that points this page at it —
  // there is no token to ask a local page for. Anywhere else the copy has not
  // been unlocked, and the prompt opens as a dialog OVER the page rather than
  // as the page (issue #96): the shell — sidebar, topbar, heading — stays where
  // it was, and the body behind the dialog is left empty rather than filled
  // with a stand-in for data that does not exist.
  if (MODE === 'locked') {
    if (isLocalHost(location.hostname)) body.innerHTML = towerDownNotice(location.href);
    else openTokenModal();
    return;
  }
  // Local-only: a token unlocks GitHub, and this page's data is not on GitHub.
  if (MODE === 'github' && options.local) {
    body.innerHTML = localOnlyNotice();
    return;
  }

  const poller = createFeedPoller({
    // Only the feeds this page asked for: readAll reads the whole table and
    // start() arms a timer per entry, so a page never polls a feed it draws
    // nothing from.
    feeds: LIVE ? pageFeeds(options.feeds) : githubPageFeeds(options.feeds),
    fetcher: LIVE ? feedFetcher : githubFetcher,
    onChange: () => paint(),
  });

  // The poller owns `feeds`, `pending` and `stamp`. The repo selection is the
  // tower's own and rides the same object, because state.js reads both halves
  // through one argument.
  const state = poller.state;
  state.selectedRepo = selectedRepo();
  // A published page may ask for a feed only the machine can answer — the
  // Overview's crew table and its health panel are the case. Their slot is
  // filled up front, so the panel says why instead of spinning on a read that
  // was never armed.
  //
  // The slot's shape is state.js's `localOnlySlot`, beside the `localOnly`
  // reader every panel keys on — it is `ok` and marked rather than failed,
  // because local-only is a designed state and the chrome's stale-feed chip
  // counts failures.
  if (MODE === 'github') {
    state.tokenMode = true;
    for (const name of options.feeds) {
      if (!githubPageFeeds([name])[name]) state.feeds[name] = localOnlySlot();
    }
  }
  // A page that WRITES has to be able to read the result of its own write: the
  // board's poll is a minute away and the API caches the sweep for as long, so
  // a relabel that landed would otherwise be shown as the old state until both
  // expired. It rides the state object for the same reason the selection does —
  // render(root, state) is the whole of a page module's argument list. A
  // published copy writes too, and re-reads through the same call: it has no
  // cache to bypass, so a plain re-read of the sweep is already the fresh one.
  state.refresh = (name) => poller.read(name, true);

  // What the chrome's frame was last drawn from. A poll paints twice — once as
  // the read starts and once as it lands — and rewriting the frame each time
  // re-created the `<select>`, which closed it if it was open while a poll went
  // by. The frame is rewritten only when `chromeKey` says what it shows has
  // changed; the status inside it is rewritten every paint, because that is the
  // half a poll actually changes.
  let painted = null;
  // Whether the unlock dialog is currently up over the page.
  let prompted = false;

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
      const token = chrome.querySelector('#tower-token');
      // Forgetting the token locks the copy again, and the next load is the
      // prompt — which is also how a token is REPLACED, since the prompt is
      // the only place one is typed.
      if (token) {
        token.addEventListener('click', () => {
          clearToken(safeStorage(window));
          location.reload();
        });
      }
    }
    chrome.querySelector('[data-tower-status]').innerHTML = statusMarkup(state, poller.staleFeeds());

    // A token GitHub REFUSED is not a page problem but a token problem, and the
    // only place a token is typed is the prompt — so the refusal is shown there,
    // as the reason, rather than drawn as an alert on a page with no field in
    // it. The same dialog the locked copy opens, over the same shell. Opened
    // once: every feed fails the same way, and re-filling it under a viewer
    // mid-type would take what they typed away.
    if (MODE === 'github') {
      const refused = Object.values(state.feeds).find(isTokenRefusal);
      if (refused) {
        if (!prompted) {
          prompted = true;
          openTokenModal(refused.reason);
        }
        return;
      }
      // A read landed after all — the page comes back, and the dialog holding
      // a refusal that is no longer true goes with it (a 403 is a rate limit
      // as often as a bad token).
      if (prompted) hideTokenModal();
      prompted = false;
    }
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
