//
// The sidebar's project selector - the tower's one project switch.
//
// The switch is the FRAMEWORK's selector module, the dropdown that sits above
// the nav in the base shell (themes/base/_includes/global/sections/
// app-sidebar.html): a button carrying the current project and a menu of the
// ones to switch to. The tower turns it on in its sidebar data and fills the
// menu at runtime, because the nav is baked at build time and the roster is
// whatever repos are on the machine when the page is open - an All projects
// master row on top and ONE row per repo under it, the row in force marked.
//
// One list, never two (issue #168). Every repo used to appear twice, once as an
// entry and again as a checkbox in a Filter projects section below, so a
// fifteen-repo roster drew a thirty-row menu. The two questions live on the one
// row now: its NAME scopes to that project alone, its BOX puts it in the subset
// the board is narrowed to (`?repo=`). The boxes are only there while the whole
// board is on screen - a subset is built by taking repos OUT of it, and a menu
// showing one project has no whole board to take them out of.
//
// It is the selector rather than a list section because the selection is
// GLOBAL: it belongs at the top of the shell, above the nav that carries it
// from page to page, in the one control the theme already draws for exactly
// this - not as a second nav below the first.
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
 * key - the menu keeps the placeholder the theme baked until it answers.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string}
 */
export const sidebarKey = (state) => {
  const slugs = slugsOf(state);
  return slugs.length ? [state.selectedRepo || '', ...slugs].join('\n') : '';
};

// A row's box: what puts one repo in the subset, or takes it out.
//
// Ticked while the whole board is in force, because every repo IS in play then
// and unticking one is how a subset starts. No id and no `label` element: the
// name beside it is a BUTTON with a job of its own, so the box carries its own
// name for a screen reader rather than borrowing one. The button that opens the
// menu carries `data-bs-auto-close="outside"` (page.js) so ticking does not
// close it.
const box = (slug, checked) => `<input class="form-check-input flex-shrink-0 ms-3" type="checkbox" data-tower-scope-slug="${esc(slug)}" aria-label="Include ${esc(slug)}"${checked ? ' checked' : ''}>`;

// The master row's box, which says exactly what the boxes UNDER it say: every
// one ticked is ticked, some of them is INDETERMINATE, none of them is empty.
// It is derived from the ticked count rather than from the selection's length
// so that a `?repo=` naming every repo - or naming repos the roster does not
// carry - cannot leave the master disagreeing with the rows it summarises.
//
// Indeterminate is a DOM property and not something markup can say, so the
// markup carries the marker and the runtime sets the property from it (page.js).
const masterBox = (ticked, total) => `<input class="form-check-input flex-shrink-0 ms-3" type="checkbox" data-tower-scope-all aria-label="All projects"${ticked === total ? ' checked' : (ticked ? ' data-tower-indeterminate' : '')}>`;

// One row: its box, when there is a subset to pick, and the name that scopes to
// it alone. A BUTTON rather than a link: the name re-scopes the page in place
// through `history.replaceState`, so there is no href for it to point at and
// nothing for a middle click to open.
const row = (label, value, active, control) => `<li class="d-flex align-items-center">
      ${control}<button type="button" class="dropdown-item flex-grow-1${active ? ' active' : ''}" data-tower-scope="${esc(value)}"${active ? ' aria-current="true"' : ''}>${esc(label)}</button>
    </li>`;

/**
 * The selector menu: the All projects master row, then one row per repo.
 *
 * All projects is the active row whenever the selection is not exactly one
 * repo - a subset is still a view of the whole board, narrowed - which is also
 * what keeps the boxes that made the subset on screen while it is in force.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string} the menu's `li` children, or '' before the roster answers
 */
export const menuMarkup = (state) => {
  const slugs = slugsOf(state);
  if (!slugs.length) return '';
  const selected = selectedSlugs(state);
  // One project in force is the one state with nothing to tick.
  const single = selected.length === 1;
  const ticks = slugs.filter((slug) => !selected.length || selected.includes(slug));
  return `${row('All projects', '', !single, single ? '' : masterBox(ticks.length, slugs.length))}
    ${slugs.map((slug) => row(slug, slug, single && selected[0] === slug, single ? '' : box(slug, ticks.includes(slug)))).join('')}`;
};

/**
 * What the selector BUTTON says about the current selection.
 *
 * The tile is the name's first character, the way the theme's own selector
 * spells it, and the second line is the honest count behind the name - the
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
    // The subset says its own arithmetic on the name line (issue #168), so the
    // line under it says the half the count leaves out rather than the same
    // sentence twice.
    //
    // Both lines are written only when the roster STANDS BEHIND them. The
    // selection is raw, so its count can outrun the roster two ways - an unread
    // roster counts nothing yet, and a shared `?repo=` can name repos this
    // machine no longer carries - and either way there is nothing hidden to
    // report: the board is already showing every repo it has. The count of what
    // was chosen is still true, and that is what the name falls back to.
    const hidden = total - selected.length;
    name = hidden > 0 ? `${selected.length} of ${total} projects` : `${selected.length} projects`;
    if (hidden > 0) env = `${hidden} hidden`;
  }
  return { name, initial: (name[0] || '?').toUpperCase(), env };
};
