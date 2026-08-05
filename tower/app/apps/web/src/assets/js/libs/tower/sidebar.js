//
// The sidebar's project selector — the tower's one project switch.
//
// The switch is the FRAMEWORK's selector module, the dropdown that sits above
// the nav in the base shell (themes/base/_includes/global/sections/
// app-sidebar.html): a button carrying the current project and a menu of the
// ones to switch to. The tower turns it on in its sidebar data and fills the
// menu at runtime, because the nav is baked at build time and the roster is
// whatever repos are on the machine when the page is open — one entry per repo
// plus All projects, the active one marked, and under a divider the checkbox
// subset that narrows the board to a few repos instead of one (`?repo=`).
//
// It is the selector rather than a list section because the selection is
// GLOBAL: it belongs at the top of the shell, above the nav that carries it
// from page to page, in the one control the theme already draws for exactly
// this — not as a second nav below the first.
//
// Pure string functions, like chrome.js: the runtime owns the DOM, this file
// owns what goes in it, and `sidebarKey` is what tells the runtime the menu is
// showing something new. The menu is only rewritten when that answer changes,
// so a poll passing under an open filter leaves the boxes alone.
//

import { esc } from './format.js';
import { repos } from './state.js';
import { selectedSlugs } from './scope.js';

/** The roster slugs, in roster order. */
const slugsOf = (state) => repos(state).map((repo) => repo.slug).filter(Boolean);

/**
 * What the selector is showing, as one comparable string.
 *
 * An unread roster has nothing to switch between, and says so with the empty
 * key — the menu keeps the placeholder the theme baked until it answers.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string}
 */
export const sidebarKey = (state) => {
  const slugs = slugsOf(state);
  return slugs.length ? [state.selectedRepo || '', ...slugs].join('\n') : '';
};

// One menu entry. A BUTTON rather than a link: the entry re-scopes the page in
// place through `history.replaceState`, so there is no href for it to point at
// and nothing for a middle click to open.
const entry = (label, value, active) => `<li>
      <button type="button" class="dropdown-item${active ? ' active' : ''}" data-tower-scope="${esc(value)}"${active ? ' aria-current="true"' : ''}>${esc(label)}</button>
    </li>`;

// The subset filter, at the foot of the same menu under a divider.
//
// It is checkboxes rather than a second list of entries: every repo already has
// an entry above, and the boxes answer a different question — not "which repo"
// but "which few". The button that opens the menu carries
// `data-bs-auto-close="outside"` (page.js) so ticking one does not close it.
//
// Ids are positional because a slug is `owner/name` and an id may not be — the
// slug itself rides on the data attribute, which the runtime reads.
const filter = (slugs, selected) => `<li><hr class="dropdown-divider"/></li>
    <li><h6 class="dropdown-header">Filter projects</h6></li>
    ${slugs.map((slug, index) => `<li class="form-check px-3">
      <input class="form-check-input" type="checkbox" id="tower-scope-${index}" data-tower-scope-slug="${esc(slug)}"${!selected.length || selected.includes(slug) ? ' checked' : ''}>
      <label class="form-check-label omega-micro" for="tower-scope-${index}">${esc(slug)}</label>
    </li>`).join('')}`;

/**
 * The selector menu: All projects, one entry per repo, and the subset filter.
 *
 * All projects is the active entry whenever the selection is not exactly one
 * repo — a subset is still a view of the whole board, narrowed — which is also
 * what keeps the filter that made the subset on screen while it is in force.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string} the menu's `li` children, or '' before the roster answers
 */
export const menuMarkup = (state) => {
  const slugs = slugsOf(state);
  if (!slugs.length) return '';
  const selected = selectedSlugs(state);
  const all = selected.length !== 1;
  return `${entry('All projects', '', all)}
    ${slugs.map((slug) => entry(slug, slug, selected.length === 1 && selected[0] === slug)).join('')}
    ${all ? filter(slugs, selected) : ''}`;
};

/**
 * What the selector BUTTON says about the current selection.
 *
 * The tile is the name's first character, the way the theme's own selector
 * spells it, and the second line is the honest count behind the name — the
 * three modes read differently and the button is the only place a viewer sees
 * which one they are in without opening the menu.
 *
 * @param {object} state - the runtime's feed state
 * @returns {{name: string, initial: string, env: string}}
 */
export const selectorLabel = (state) => {
  const slugs = slugsOf(state);
  // The selection is read RAW, not filtered against the roster: a `?repo=`
  // naming a repo the roster no longer carries still narrows every page to
  // nothing, and the button naming that slug is what explains the empty board.
  // The menu agrees by marking no entry active.
  const selected = selectedSlugs(state);
  const total = slugs.length;
  let name = 'All projects';
  // Before the roster answers the count is not known, and the line says the
  // same thing the theme baked rather than a number nothing stands behind.
  let env = total ? `all ${total} repos on the roster` : 'every repo on the roster';
  if (selected.length === 1) {
    [name] = selected;
    env = `1 of ${total} repos`;
  } else if (selected.length > 1) {
    name = `${selected.length} projects`;
    env = `${selected.length} of ${total} repos`;
  }
  return { name, initial: (name[0] || '?').toUpperCase(), env };
};
