// libs/tower/page/selector.js: the sidebar selector: its button, the menu the
// runtime claims under it, the label patched onto it, and the search box at the
// top of the menu. page.js imports it; nothing here imports page.js.

import { selectorLabel } from './sidebar.js';

/** The selector's toggle button, the framework's own node (sidebar.json turns it on). */
export const selectorButton = () => document.querySelector('#app-sidebar .omega-side__selector');

/**
 * The one node the runtime fills inside the framework's sidebar: the selector's
 * dropdown menu, reached through the button since the nav is a `ul` sibling one
 * level up. Claimed with a data attribute on first fill, which is also the
 * handle the listeners re-find it by.
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
    // The theme's placeholder item is an `href="#"`, which would put a bare hash
    // in an address bar that carries the selection.
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a[href="#"]')) event.preventDefault();
    });
    // The keyboard goes to the search box as the menu opens, and the box is
    // emptied as it closes. Both hang on the button, where Bootstrap fires its
    // dropdown events, and are wired here since the menu itself is never rewritten.
    button.addEventListener('shown.bs.dropdown', () => {
      // A tick later, not now: a keyboard open (ArrowDown on the button) has
      // Bootstrap move focus to the first row after this event fires, and the
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
// Typing narrows the rows on screen and nothing else: no state, no paint, so
// sidebar.js knows nothing of it and a filter lives as long as the menu is open.

/** The menu's search box, or null while the theme's placeholder is still up. */
export const projectSearch = (menu) => menu && menu.querySelector('[data-tower-project-search]');

/**
 * The repo rows' name buttons, in menu order. The master row is not one: it is
 * never filtered away, and the box's Down and Enter land on a repo row.
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
 * Bootstrap's delegated dropdown handler already walks the visible rows and
 * runs last; what it leaves alone is an input's keys, so the box's Down and
 * Enter are wired here, and a character typed on a row goes back to the box.
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
      // A character typed on a row starts a search: the box takes the focus and
      // the character lands in it. Space stays with the row, which it presses.
      if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) search.focus();
    });
  }
};

/**
 * Put the current selection on the selector button. The button is the
 * framework's markup, so its nodes are patched, never rebuilt.
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
