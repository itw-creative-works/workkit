//
// The page runtime every tower page boots into.
//
// It owns the things that are the same on all seven pages: which feeds this
// page arms, the repo selection held in `?repo=`, the sidebar's project
// selector that changes it and the nav links that carry it, and the paint loop.
// A page module supplies a mount id, the feeds it
// reads, and one `render(root, state)` - nothing else. The feed table itself
// (paths and cadence) is api.js's, which is where every tower URL is written.
//
// A published copy keeps its mount, its sidebar and its topbar, and what it
// draws into them is its MODE (api.js): unlocked, it polls GitHub itself with
// the viewer's token, through the same feed names and the same paint loop;
// locked, it has no data at all and is sent to the one page that works without
// a token (`tokenless: true`, issue #167); and either way a page whose data is
// this machine's - the crew, the spend, the working copies - says so instead
// (`local: true`).
//
// Reading the state back out is state.js: a page asks the runtime to run it and
// asks state.js what the answers were. The one thing this file takes from there
// is the SHAPE of a slot it fills itself - the local-only stand-in, which lives
// beside the reader that keys on it rather than being written twice.
//
// The polling itself is the framework's: `createFeedPoller` owns the declared
// feed table, the in-flight count, the timestamp and the keep-last-good rule
// (@omega.js/client/modules/live-page - upstreamed FROM this file). What stays
// here is what is the TOWER's: which feeds exist, the repo selection, the
// chrome, and the paint loop.
//
// The loop calls render() on every answer and on every tick; what reaches the
// DOM is decided further down, by live-page's `swap` in each page's render, so
// a tick that changed nothing leaves the page - and its focus, its scroll and
// its open `details` - exactly as it was. The chrome's frame above the body is
// written once and never again (chrome.js), and the selector menu in the
// sidebar is markup from state with a KEY beside it (sidebar.js) that this file
// rewrites only when what it shows changed - so a poll passing under an open
// control no longer closes it.
//
// Beside the loop, and never part of it, runs the second hand (clock.js): the
// one thing on the tower measured in seconds is an agent's freshness, and it
// moves between polls by PATCHING what the last paint drew rather than by
// asking for another one.
//

import omega from '@omega.js/client';
import { createFeedPoller, swap } from '@omega.js/client/modules/live-page';
import { loadCharts } from '__main_assets__/js/libs/charts.js';
import {
  feedFetcher, githubFetcher, pageFeeds, githubPageFeeds, LIVE, MODE,
} from './api.js';
import { localOnlyNotice } from './format.js';
import { board, localOnlySlot } from './state.js';
import { isTokenRefusal } from './github.js';
import { isLocalHost, towerDownNotice, settingsNotice } from './token.js';
import { chromeMarkup, statusMarkup } from './chrome.js';
import { isScopedPath, scopedHref, settingsHref } from './scope.js';
import { menuMarkup, selectorLabel, sidebarKey } from './sidebar.js';
import { startClock } from './clock.js';
import { holdBoard, refreshAgentDialog } from './modal.js';

// ── The repo selection ─────────────────────────────────────────────────────
//
// One repo, a comma-separated subset of the roster, or nothing at all for every
// repo - the URL is the only place it is ever written (issue #104). What the
// value MEANS is scope.js's, which every page filters through; what is here is
// the reading, the writing, and the sidebar the viewer changes it from.

/** The `?repo=` value the whole tower is narrowed by, or '' for every repo. */
export const selectedRepo = () => new URL(location.href).searchParams.get('repo') || '';

const writeSelectedRepo = (value) => history.replaceState(null, '', scopedHref(location.href, value));

/**
 * Put the current selection on every tower link in the sidebar.
 *
 * This is what makes the scope survive the nav: the sidebar is baked at build
 * time with plain hrefs, so Overview → Board dropped the selection on the floor
 * until the links carried it. Idempotent - a link already carrying one is
 * rewritten, never appended to - and run on every paint as well as on every
 * change, since the framework redraws its own shell on a rail collapse.
 *
 * @param {string} value - the `?repo=` value, '' for every repo
 */
const scopeNav = (value) => {
  for (const link of document.querySelectorAll('#app-sidebar a[href]')) {
    const href = link.getAttribute('href');
    if (isScopedPath(href)) link.setAttribute('href', scopedHref(href, value));
  }
};

/** The selector's toggle button, the framework's own node (sidebar.json turns it on). */
const selectorButton = () => document.querySelector('#app-sidebar .omega-side__selector');

/**
 * The one node the runtime fills inside the framework's sidebar: the selector's
 * dropdown menu.
 *
 * Reached through the BUTTON, never as a bare list in the sidebar - the nav is a `ul`
 * too, and it is the menu's sibling one level up. Claimed with a data attribute
 * on first fill, both as the marker that the menu is ours and as the handle the
 * change listener re-finds it by after a repaint.
 */
const projectsHost = () => {
  const button = selectorButton();
  const menu = button && button.parentElement.querySelector(':scope > .dropdown-menu');
  if (!menu) return null;
  if (!menu.hasAttribute('data-tower-projects')) {
    menu.setAttribute('data-tower-projects', '');
    // Ticking a subset box must not close the menu it lives in. The rest of
    // Bootstrap's dropdown - the toggle, the outside click, escape - is the
    // theme bundle's data-api, untouched.
    button.setAttribute('data-bs-auto-close', 'outside');
    // The one item the theme ships is a placeholder (sidebar.json), and it is
    // what the menu shows until the roster answers - an `href="#"` that would
    // otherwise put a bare hash in the address bar of a page whose URL carries
    // the selection.
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a[href="#"]')) event.preventDefault();
    });
  }
  return menu;
};

/**
 * Put the current selection on the selector button.
 *
 * The button is the framework's markup and its classes are the contract - the
 * nodes are PATCHED, never rebuilt, so the theme keeps owning how it looks.
 *
 * @param {object} state - the runtime's feed state
 */
const paintSelector = (state) => {
  const button = selectorButton();
  if (!button) return;
  const { name, initial, env } = selectorLabel(state);
  const set = (selector, text) => {
    const node = button.querySelector(selector);
    if (node) node.textContent = text;
  };
  set('.omega-side__selector-tile', initial);
  set('.omega-side__selector-name', name);
  set('.omega-side__selector-env', env);
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
 * @param {boolean} [options.tokenless] - whether this page works with no token
 *   at all, which is Settings and only Settings: it is where one is typed
 * @returns {Promise<void>}
 */
export async function startPage(options) {
  await omega.dom().ready();

  const host = document.getElementById(options.mount);
  // The mount is the page's contract with its markdown file. If it is missing,
  // the page was renamed and this module is bound to nothing - say so once
  // rather than throwing on every poll.
  if (!host) {
    console.warn(`[tower] no #${options.mount} on this page - nothing to draw into`);
    return;
  }

  host.innerHTML = '<div data-tower-chrome></div><div data-tower-body></div>';
  const chrome = host.querySelector('[data-tower-chrome]');
  const body = host.querySelector('[data-tower-body]');

  // Before the mode forks: the nav carries the scope on every page, including
  // the ones that draw nothing themselves - a locked copy, and a local-only
  // page in a published one, are pages a viewer passes THROUGH, and a link that
  // dropped the selection there would lose it for the rest of the session.
  scopeNav(selectedRepo());

  // The mode is read from the flag itself, never inferred from an empty feed
  // table: a page that legitimately declares no feeds is still a live page.
  //
  // Locked: no data of any kind is reachable, so there is no poller and no
  // chrome - every control in the chrome needs a feed behind it.
  if (MODE === 'locked') {
    // Except on Settings, which is the page a copy with no token is FOR: it
    // draws itself here, with nothing behind it, because the token it asks for
    // is the thing every feed is waiting on (issue #167). It is drawn before
    // the hostname fork as well - a viewer who opened Settings asked for it,
    // wherever the page was served from.
    if (options.tokenless) {
      options.render(body, { feeds: {}, selectedRepo: selectedRepo() });
      return;
    }
    // On THIS machine the tower is simply not connected, and that notice is the
    // page body, carrying the link that points this page at it - there is no
    // token to ask a local page for (issue #89), so it is not sent anywhere to
    // type one.
    if (isLocalHost(location.hostname)) {
      body.innerHTML = towerDownNotice(location.href);
      return;
    }
    // Anywhere else the copy has not been unlocked. The shell - sidebar,
    // topbar, heading - stays where it was, the body says the one true thing
    // about this page and points at Settings, and the viewer is taken there:
    // the line is what stands here while the navigation happens, and what the
    // page goes on saying if they come back to it. `replace`, not `assign`, so
    // Back does not bounce off a page that has no data either.
    body.innerHTML = settingsNotice(settingsHref(selectedRepo()));
    location.replace(settingsHref(selectedRepo()));
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
  // A published page may ask for a feed only the machine can answer - the
  // Overview's crew table and its health panel are the case. Their slot is
  // filled up front, so the panel says why instead of spinning on a read that
  // was never armed.
  //
  // The slot's shape is state.js's `localOnlySlot`, beside the `localOnly`
  // reader every panel keys on - it is `ok` and marked rather than failed,
  // because local-only is a designed state and the chrome's stale-feed chip
  // counts failures.
  if (MODE === 'github') {
    for (const name of options.feeds) {
      if (!githubPageFeeds([name])[name]) state.feeds[name] = localOnlySlot();
    }
  }
  // A page that WRITES has to be able to read the result of its own write: the
  // board's poll is a minute away and the API caches the sweep for as long, so
  // a relabel that landed would otherwise be shown as the old state until both
  // expired. It rides the state object for the same reason the selection does -
  // render(root, state) is the whole of a page module's argument list. A
  // published copy writes too, and re-reads through the same call: it has no
  // cache to bypass, so a plain re-read of the sweep is already the fresh one.
  state.refresh = (name) => poller.read(name, true);

  // The chrome's frame, once. A poll paints twice - once as the read starts and
  // once as it lands - and rewriting the frame each time re-created the controls
  // under the pointer. Nothing in the frame varies any more (chrome.js), so it
  // is written here rather than compared on every paint; the status inside it is
  // rewritten every paint, because that is the half a poll actually changes.
  chrome.innerHTML = chromeMarkup();
  chrome.querySelector('#tower-refresh').addEventListener('click', () => poller.readAll(true));

  // What the sidebar's selector menu was last drawn from: a poll landing must
  // not rewrite the subset checkboxes under the pointer.
  let paintedProjects = null;
  // Whether the paint about to run was asked for by a control INSIDE the menu.
  // An open menu is otherwise left alone until it closes - but the control that
  // changed the scope is exactly the one whose menu has to redraw around it.
  let scoped = false;

  /** Narrow the whole tower to a `?repo=` value: the URL, the state, the nav, the paint. */
  function applyScope(value) {
    state.selectedRepo = value;
    writeSelectedRepo(value);
    scoped = true;
    paint();
    scoped = false;
  }

  // The sidebar's selector menu (sidebar.js). The names and the subset boxes
  // are wired per control on each rewrite - every rewrite replaces the nodes
  // wholesale, so no listener ever stacks on a survivor.
  function paintProjects() {
    const projects = projectsHost();
    if (!projects) return;
    paintSelector(state);
    const key = sidebarKey(state);
    // Before the roster answers there is nothing to switch between, and the
    // menu keeps the placeholder the theme baked rather than being emptied.
    if (!key || key === paintedProjects) return;
    // A menu the viewer has OPEN is not rewritten under their pointer by a poll
    // landing behind it; the key is left unclaimed, so the redraw happens on the
    // first paint after it closes. A scope change made from inside the menu is
    // the exception - that redraw is the answer to their click.
    if (projects.classList.contains('show') && !scoped) return;
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
    // The master row's box. Indeterminate is a DOM PROPERTY - markup cannot say
    // it - so the marker sidebar.js writes is turned into the property here, and
    // whichever of the two states it was in, ticking it means the whole board.
    const master = projects.querySelector('[data-tower-scope-all]');
    if (master) {
      master.indeterminate = master.hasAttribute('data-tower-indeterminate');
      master.addEventListener('change', () => {
        applyScope('');
        // A board that was ALREADY whole is not a new selection, so the menu was
        // not rewritten and the box the click emptied is still on screen - put
        // it back the way the markup for this state spells it. Either way the
        // box is re-found and focused, like the slug boxes below: a rewrite
        // takes the node the keyboard was on with it.
        const shown = projectsHost()?.querySelector('[data-tower-scope-all]');
        if (shown) {
          shown.checked = true;
          shown.indeterminate = false;
          shown.focus();
        }
      });
    }
    for (const box of projects.querySelectorAll('[data-tower-scope-slug]')) {
      box.addEventListener('change', () => {
        const boxes = [...projects.querySelectorAll('[data-tower-scope-slug]')];
        const chosen = boxes.filter((one) => one.checked).map((one) => one.getAttribute('data-tower-scope-slug'));
        // Every box checked is every repo, which is what an ABSENT parameter
        // already says - and so is no box at all, since a scope holding nothing
        // is a board with nothing on it rather than a filter.
        applyScope(chosen.length && chosen.length < boxes.length ? chosen.join(',') : '');
        // The paint above rewrote the section, taking the box the keyboard was
        // on with it - put focus back on its replacement so tabbing resumes in
        // place. Narrowing to one repo removes the filter itself; then there is
        // no replacement to focus.
        const slug = box.getAttribute('data-tower-scope-slug');
        const successor = projectsHost()?.querySelector(`[data-tower-scope-slug="${slug}"]`);
        if (successor) successor.focus();
      });
    }
  }

  function paint() {
    chrome.querySelector('[data-tower-status]').innerHTML = statusMarkup(state, poller.staleFeeds());
    paintProjects();
    scopeNav(state.selectedRepo);

    // A token GitHub REFUSED is not a page problem but a token problem, and the
    // only place a token is typed is Settings - so the refusal is carried
    // THERE rather than drawn as an alert on a page with no field in it. On
    // Settings itself it rides the state into the card's own reason; on every
    // other page it is the line pointing at Settings, in place of the data that
    // will not load. Written through `swap` like everything else in the body, so
    // a read landing after all (a 403 is a rate limit as often as a bad token)
    // draws the page back over it.
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
    // What an issue waits on and what it blocks are both read off the board this
    // paint is drawing (#127), and the dialog that says them lives in the layout,
    // outside the page mount. Handed over HERE, where every page's paint passes,
    // so no page keeps a second copy of the payload for the dialog to read - and
    // a page whose feeds carry no board hands over nothing.
    holdBoard(board(state));
    options.render(body, state);
    // The page is drawn; so is anything the viewer has open OVER it. An agent
    // dialog is filled once, from a registry the render above has just
    // rewritten - refresh it here and it tells the same story as the card
    // behind it, spinning while the agent works and decaying only when it
    // stops (#108). Quiet on a page with no dialog open, which is most of them.
    refreshAgentDialog();
  }

  // First paint before anything answers, so the page is never a blank region.
  paint();

  // The paint loop moves at the feeds' pace, and the freshness on a crew card
  // is measured in seconds - so the second hand runs beside it, patching the
  // drawn indicators in place rather than repainting anything (clock.js).
  //
  // Over the DOCUMENT, not over `body`: the two dialogs are part of the layout
  // and sit outside the page mount entirely, and an agent dialog left open has
  // the same glyph on it as the card behind it (modal.agentDialog). The walk
  // finds indicators by their stamps wherever they were drawn, so the wider
  // host costs one `querySelectorAll` a second and reaches all of them.
  startClock(document.body);

  if (options.charts) {
    await loadCharts();
    paint();
  }

  await poller.start();
}
