// The page runtime every tower page boots into: the feeds a page arms, the
// `?repo=` selection, the sidebar selector's wiring and the paint loop. A page
// module supplies a mount id, its feeds and `render(root, state)`; the feed
// table is api.js's and the polling is the framework's `createFeedPoller`.

import omega from '@omega.js/client';
import { createFeedPoller, swap } from '@omega.js/client/modules/live-page';
import { loadCharts } from '__main_assets__/js/libs/charts.js';
import {
  feedFetcher, githubFetcher, pageFeeds, githubPageFeeds, LIVE, MODE,
} from './api.js';
import { localOnlyNotice } from './format.js';
import { board, localOnlySlot } from './state.js';
import { isTokenRefusal, safeStorage } from './github.js';
import { readFavorites, toggleFavorite } from './page/favorites.js';
import { isLocalHost, towerDownNotice, settingsNotice } from './token.js';
import { chromeMarkup, statusMarkup } from './page/chrome.js';
import { isScopedPath, NONE, scopedHref, settingsHref } from './scope.js';
import { menuMarkup, sidebarKey } from './page/sidebar.js';
import { startClock } from './clock.js';
import { holdBoard, refreshAgentDialog } from './modal.js';
import {
  selectorButton, projectsHost, paintSelector, projectSearch, filterProjects, wireProjectKeys,
} from './page/selector.js';

// ── The repo selection ─────────────────────────────────────────────────────
// The URL is the only place it is written; what the value means is scope.js's.

/** The `?repo=` value the whole tower is narrowed by, or '' for every repo. */
export const selectedRepo = () => new URL(location.href).searchParams.get('repo') || '';

const writeSelectedRepo = (value) => history.replaceState(null, '', scopedHref(location.href, value));

/**
 * Put the current selection on every tower link in the sidebar. The sidebar is
 * baked with plain hrefs and the framework redraws its shell on a rail
 * collapse, so this runs on every paint as well as on every change.
 *
 * @param {string} value - the `?repo=` value, '' for every repo
 */
const scopeNav = (value) => {
  for (const link of document.querySelectorAll('#app-sidebar a[href]')) {
    const href = link.getAttribute('href');
    if (isScopedPath(href)) link.setAttribute('href', scopedHref(href, value));
  }
};

// ── The runtime ────────────────────────────────────────────────────────────

/**
 * Boot a page.
 * @param {object} options
 * @param {string} options.mount - the id of the page's one mount div
 * @param {string[]} options.feeds - which API feeds this page reads
 * @param {(root: HTMLElement, state: object) => void} options.render - draws the page body
 * @param {boolean} [options.charts] - whether to pull Chart.js in before the first paint
 * @param {boolean} [options.local] - whether this page reads the machine itself
 * @param {boolean} [options.tokenless] - whether this page works with no token (Settings only)
 * @returns {Promise<void>}
 */
export async function startPage(options) {
  await omega.dom().ready();

  const host = document.getElementById(options.mount);
  // A missing mount means the page was renamed: say so once rather than
  // throwing on every poll.
  if (!host) {
    console.warn(`[tower] no #${options.mount} on this page - nothing to draw into`);
    return;
  }

  host.innerHTML = '<div data-tower-chrome></div><div data-tower-body></div>';
  const chrome = host.querySelector('[data-tower-chrome]');
  const body = host.querySelector('[data-tower-body]');

  // Before the mode forks: a locked or local-only page is one a viewer passes
  // through, and a link dropping the selection there loses it for the session.
  scopeNav(selectedRepo());

  // The mode is read from the flag, never inferred from an empty feed table: a
  // page may declare no feeds. Locked has no poller and no chrome.
  if (MODE === 'locked') {
    // Settings is the page a tokenless copy is for, so it draws with nothing
    // behind it, before the hostname fork: a viewer who opened it asked for it.
    if (options.tokenless) {
      options.render(body, { feeds: {}, selectedRepo: selectedRepo() });
      return;
    }
    // On this machine the tower is simply not connected: there is no token to
    // ask a local page for, so the notice is the body and nothing navigates.
    if (isLocalHost(location.hostname)) {
      body.innerHTML = towerDownNotice(location.href);
      return;
    }
    // Anywhere else the body points at Settings while the viewer is taken
    // there; `replace`, so Back does not bounce off a page with no data either.
    body.innerHTML = settingsNotice(settingsHref(selectedRepo()));
    location.replace(settingsHref(selectedRepo()));
    return;
  }
  // Local-only: a token unlocks GitHub, and this page's data is not on GitHub.
  if (MODE === 'github' && options.local) {
    body.innerHTML = localOnlyNotice();
    return;
  }

  // A published copy's sweep runs in this tab and the poller's fetcher has no
  // mid-flight handover, so each landed page is written into the board slot in
  // a landed read's shape and painted; the poller's own answer lands over it.
  const onBoardPage = (partial) => {
    poller.state.feeds.board = { ok: true, data: partial, status: null, reason: null };
    paint();
  };

  const poller = createFeedPoller({
    // Only the feeds this page asked for, so it never polls one it draws
    // nothing from.
    feeds: LIVE ? pageFeeds(options.feeds) : githubPageFeeds(options.feeds),
    fetcher: LIVE ? feedFetcher : (path) => githubFetcher(path, onBoardPage),
    onChange: () => paint(),
  });

  // The selection rides the poller's state because state.js reads both through
  // one argument.
  const state = poller.state;
  state.selectedRepo = selectedRepo();
  // Favorites ride the state too, since the menu is markup from state; storage
  // is guarded because a browser blocking site data throws on the property.
  const storage = safeStorage(window);
  state.favorites = readFavorites(storage);
  // A published page may ask for a machine-only feed (the Overview's crew and
  // health panels): its slot is filled up front as `ok` and marked, since
  // local-only is a designed state and the stale-feed chip counts failures.
  if (MODE === 'github') {
    for (const name of options.feeds) {
      if (!githubPageFeeds([name])[name]) state.feeds[name] = localOnlySlot();
    }
  }
  // A page that writes re-reads its own result past the API's sweep cache; a
  // published copy has no cache, so its plain re-read is already fresh.
  state.refresh = (name) => poller.read(name, true);

  // The frame is written once: rewriting it per paint would re-create the
  // controls under the pointer. Only the status inside it varies.
  chrome.innerHTML = chromeMarkup();
  chrome.querySelector('#tower-refresh').addEventListener('click', () => poller.readAll(true));

  // What the sidebar's selector menu was last drawn from: a poll landing must
  // not rewrite the subset checkboxes under the pointer.
  let paintedProjects = null;
  // Whether the paint about to run was asked for by a control inside the menu:
  // an open menu is otherwise left alone until it closes.
  let scoped = false;

  /**
   * Narrow the whole tower to a `?repo=` value. The boxes pass `reshape` false:
   * the menu keeps its shape mid-build and redraws on close.
   */
  function applyScope(value, reshape = true) {
    state.selectedRepo = value;
    writeSelectedRepo(value);
    scoped = reshape;
    paint();
    scoped = false;
  }

  // Controls are wired per rewrite: a rewrite replaces the nodes wholesale, so
  // no listener stacks on a survivor.
  function paintProjects() {
    const projects = projectsHost();
    if (!projects) return;
    // The reshape an open menu holds back happens as it closes, with the key
    // dropped: boxes built then unbuilt leave the same key behind.
    if (!projects.hasAttribute('data-tower-reshape')) {
      projects.setAttribute('data-tower-reshape', '');
      selectorButton().addEventListener('hidden.bs.dropdown', () => {
        paintedProjects = null;
        paintProjects();
      });
    }
    paintSelector(state);
    const key = sidebarKey(state);
    // Before the roster answers there is nothing to switch between, and the
    // menu keeps the placeholder the theme baked rather than being emptied.
    if (!key || key === paintedProjects) return;
    // An open menu is not rewritten by a poll landing behind it; a scope change
    // made from inside the menu is the exception.
    if (projects.classList.contains('show') && !scoped) return;
    // A rewrite takes the search box with it, so the filter is carried over.
    const filter = projectSearch(projects)?.value || '';
    paintedProjects = key;
    projects.innerHTML = menuMarkup(state);
    for (const entry of projects.querySelectorAll('[data-tower-scope]')) {
      entry.addEventListener('click', () => {
        applyScope(entry.getAttribute('data-tower-scope'));
        // Picking a project is done with the menu; the subset boxes are the
        // reason it does not close itself (`data-bs-auto-close="outside"`).
        window.bootstrap.Dropdown.getOrCreateInstance(selectorButton()).hide();
      });
    }
    // Indeterminate is a DOM property markup cannot say. Unticking the master
    // is the none scope, where a subset builds up from; boxes are set in place
    // so the node under the keyboard survives its own click.
    const master = projects.querySelector('[data-tower-scope-all]');
    if (master) {
      master.indeterminate = master.hasAttribute('data-tower-indeterminate');
      master.addEventListener('change', () => {
        for (const one of projects.querySelectorAll('[data-tower-scope-slug]')) one.checked = master.checked;
        master.indeterminate = false;
        applyScope(master.checked ? '' : NONE, false);
      });
    }
    for (const box of projects.querySelectorAll('[data-tower-scope-slug]')) {
      box.addEventListener('change', () => {
        const boxes = [...projects.querySelectorAll('[data-tower-scope-slug]')];
        const chosen = boxes.filter((one) => one.checked).map((one) => one.getAttribute('data-tower-scope-slug'));
        // Every box checked is every repo, which an absent parameter already
        // says; no box is the none scope, a value of its own.
        applyScope(chosen.length ? (chosen.length < boxes.length ? chosen.join(',') : '') : NONE, false);
        // The menu kept its shape, so the master's summary of the roster is
        // told here rather than redrawn.
        master.checked = chosen.length === boxes.length;
        master.indeterminate = chosen.length > 0 && chosen.length < boxes.length;
      });
    }
    // A star writes storage and redraws only its button: a repaint from state
    // would wipe a subset mid-build. It changes no scope.
    for (const mark of projects.querySelectorAll('[data-tower-favorite]')) {
      mark.addEventListener('click', () => {
        const slug = mark.getAttribute('data-tower-favorite');
        state.favorites = toggleFavorite(storage, slug);
        const on = state.favorites.includes(slug);
        mark.classList.toggle('text-warning', on);
        mark.classList.toggle('text-body-secondary', !on);
        mark.setAttribute('aria-pressed', String(on));
        mark.querySelector('i').className = `fa-${on ? 'solid' : 'regular'} fa-star`;
      });
    }
    wireProjectKeys(projects);
    if (filter) {
      const search = projectSearch(projects);
      if (search) search.value = filter;
      filterProjects(projects, filter);
    }
  }

  function paint() {
    chrome.querySelector('[data-tower-status]').innerHTML = statusMarkup(state, poller.staleFeeds());
    paintProjects();
    scopeNav(state.selectedRepo);

    // A token GitHub refused is carried to Settings, the one place one is typed:
    // into the card there, as the pointer line everywhere else. A spent rate
    // limit is not a refusal (`isTokenRefusal`), so the page says when it lifts.
    state.tokenProblem = '';
    if (MODE === 'github') {
      const refused = Object.values(state.feeds).find(isTokenRefusal);
      if (refused) {
        state.tokenProblem = refused.reason;
        if (!options.tokenless) {
          swap(body, settingsNotice(settingsHref(state.selectedRepo), refused.reason));
          return;
        }
      }
    }
    // The issue dialog lives in the layout, outside the mount, and reads the
    // board this paint draws; handed over here so no page keeps a second copy.
    holdBoard(board(state));
    options.render(body, state);
    // An open agent dialog reads the registry this render just rewrote, so it
    // tells the same story as the card behind it.
    refreshAgentDialog();
  }

  // First paint before anything answers, so the page is never a blank region.
  paint();

  // The second hand patches drawn indicators in place between polls (clock.js).
  // Over the document, not `body`: the dialogs sit outside the mount.
  startClock(document.body);

  if (options.charts) {
    await loadCharts();
    paint();
  }

  await poller.start();
}
