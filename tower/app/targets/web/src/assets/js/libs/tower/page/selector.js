// libs/tower/page/selector.js: the sidebar selector: its button, the menu the
// runtime claims under it, the label patched onto it, and the search box at the
// top of the menu. page.js imports it; nothing here imports page.js.

import { selectorLabel } from '../sidebar.js';

/** The selector's toggle button, the framework's own node (sidebar.json turns it on). */
export const selectorButton = () => document.querySelector('#app-sidebar .omega-side__selector');

/**
 * The one node the runtime fills inside the framework's sidebar: the selector's
 * dropdown menu.
 *
 * Reached through the BUTTON, never as a bare list in the sidebar - the nav is a `ul`
 * too, and it is the menu's sibling one level up. Claimed with a data attribute
 * on first fill, both as the marker that the menu is ours and as the handle the
 * change listener re-finds it by after a repaint.
 */
export const projectsHost = () => {
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
    // The box at the top of the menu is there to be typed in, so the keyboard
    // goes to it the moment the menu opens - and what it holds is forgotten when
    // the menu closes, so the next open is the whole roster again rather than
    // yesterday's search. Both listeners hang on the BUTTON, which is where
    // Bootstrap fires its dropdown events, and both are wired HERE: the rows
    // inside the menu are rewritten many times over, the menu itself never is.
    button.addEventListener('shown.bs.dropdown', () => {
      // A tick later, not now: a keyboard open (ArrowDown on the button) has
      // Bootstrap move focus to the first row AFTER this event fires, and the
      // box is where the keyboard belongs however the menu was opened.
      setTimeout(() => {
        const search = projectSearch(menu);
        if (search) search.focus();
      }, 0);
    });
    button.addEventListener('hidden.bs.dropdown', () => {
      const search = projectSearch(menu);
      if (search) search.value = '';
      filterProjects(menu, '');
    });
  }
  return menu;
};

// ── The menu's search box ──────────────────────────────────────────────────
//
// Typing in it narrows the rows on screen and does nothing else (issue #185):
// no state is written, no paint is asked for, and the markup is the same list it
// was - a row the text does not name is hidden where it stands. That is why
// sidebar.js knows nothing about any of this, and why a filter lives exactly as
// long as the menu is open.

/** The menu's search box, or null while the theme's placeholder is still up. */
export const projectSearch = (menu) => menu && menu.querySelector('[data-tower-project-search]');

/**
 * The repo rows' name buttons, in menu order.
 *
 * The master row is not one of them: All projects is what the rows are narrowed
 * OUT of, so it is never filtered away - and the box's Down and Enter land on a
 * repo row, the thing a typed search names.
 */
const projectRows = (menu) => [...menu.querySelectorAll('[data-tower-scope]:not([data-tower-scope=""])')];

/** The rows a filter has left on screen. */
const shownRows = (menu) => projectRows(menu).filter((entry) => !entry.closest('li').classList.contains('d-none'));

/**
 * Hide every row the text does not name, in place.
 *
 * @param {HTMLElement} menu - the claimed menu
 * @param {string} text - what is in the box; '' is the whole roster back
 */
export const filterProjects = (menu, text) => {
  const needle = String(text || '').trim().toLowerCase();
  for (const entry of projectRows(menu)) {
    const slug = entry.getAttribute('data-tower-scope').toLowerCase();
    entry.closest('li').classList.toggle('d-none', Boolean(needle) && !slug.includes(needle));
  }
};

/**
 * Wire the box and the rows to the keyboard, for one rewrite of the menu.
 *
 * The arrows BETWEEN rows are not wired here at all: Bootstrap's own dropdown
 * handler, delegated from the document, already walks the visible
 * `.dropdown-item`s - the master row among them, hidden rows skipped, the ends
 * clamped - and it runs last, so anything written here about row arrows would
 * lose to it anyway. What it leaves alone is an INPUT's keys, so the box's own
 * Down and Enter are wired here, and a character typed on a row hands the
 * keyboard back to the box. Escape is Bootstrap's and is not touched.
 *
 * @param {HTMLElement} menu - the claimed menu, just rewritten
 */
export const wireProjectKeys = (menu) => {
  const search = projectSearch(menu);
  if (!search) return;
  search.addEventListener('input', () => filterProjects(menu, search.value));
  search.addEventListener('keydown', (event) => {
    const rows = shownRows(menu);
    if (!rows.length) return;
    // Down walks into the list; Enter takes the row at the top of it, which is
    // what typing until one row is left and pressing it means.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      rows[0].focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      rows[0].click();
    }
  });
  for (const entry of projectRows(menu)) {
    entry.addEventListener('keydown', (event) => {
      // A character typed on a row is the start of a search, not a shortcut:
      // the box takes the focus and the character lands in it, which is exactly
      // why nothing is prevented here. Space stays with the row - it is how a
      // button is pressed from the keyboard.
      if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) search.focus();
    });
  }
};

/**
 * Put the current selection on the selector button.
 *
 * The button is the framework's markup and its classes are the contract - the
 * nodes are PATCHED, never rebuilt, so the theme keeps owning how it looks.
 *
 * @param {object} state - the runtime's feed state
 */
export const paintSelector = (state) => {
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
