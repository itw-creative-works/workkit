// The sidebar's project selector as markup from state: the framework's
// selector module, its menu filled at runtime from the roster (`tower/README.md`
// § The pages). Pure string functions like chrome.js; the runtime owns the DOM
// and redraws the menu only when `sidebarKey` changes.

import { esc } from '../format.js';
import { repos } from '../state.js';
import { isNone, selectedSlugs } from '../scope.js';

/** The roster slugs, in roster order. */
const slugsOf = (state) => repos(state).map((repo) => repo.slug).filter(Boolean);

// Which of the roster's slugs are starred, in roster order. Read defensively:
// the list comes from a localStorage key a viewer can edit.
const favoritesOf = (state) => {
  const held = Array.isArray(state.favorites) ? state.favorites : [];
  return slugsOf(state).filter((slug) => held.includes(slug));
};

// The roster with the favorites lifted out of it and put back on top. Roster
// order holds inside each group, so a menu that is half starred still reads in
// the order every other list on the tower is in.
const orderedSlugs = (state) => {
  const favored = favoritesOf(state);
  return [...favored, ...slugsOf(state).filter((slug) => !favored.includes(slug))];
};

/**
 * What the selector is showing, as one comparable string; '' while the roster
 * is unread, so the theme's placeholder stays. The stars are their own segment:
 * a star on the first repo changes the marks without changing the order.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string}
 */
export const sidebarKey = (state) => {
  const slugs = orderedSlugs(state);
  return slugs.length ? [state.selectedRepo || '', favoritesOf(state).join(','), ...slugs].join('\n') : '';
};

// A row's box: ticked while the whole board is in force, since unticking one
// is how a subset starts. It carries its own screen-reader name because the
// name beside it is a button with a job of its own.
const box = (slug, checked) => `<input class="form-check-input flex-shrink-0 ms-3" type="checkbox" data-tower-scope-slug="${esc(slug)}" aria-label="Include ${esc(slug)}"${checked ? ' checked' : ''}>`;

// The master row's box, derived from the ticked count rather than the
// selection's length, so a `?repo=` naming every repo or unknown ones cannot
// leave it disagreeing with its rows. The runtime turns the marker into the
// indeterminate property (page.js).
const masterBox = (ticked, total) => `<input class="form-check-input flex-shrink-0 ms-3" type="checkbox" data-tower-scope-all aria-label="All projects"${ticked === total ? ' checked' : (ticked ? ' data-tower-indeterminate' : '')}>`;

// A row's star: a button, since a click changes what this browser remembers
// and goes nowhere; it carries its own screen-reader name, the glyph being
// decoration.
const star = (slug, on) => `<button type="button" class="btn btn-link btn-sm flex-shrink-0 px-2 py-0 ms-2 ${on ? 'text-warning' : 'text-body-secondary'}" data-tower-favorite="${esc(slug)}" aria-pressed="${on}" aria-label="Favorite ${esc(slug)}"><i class="fa-${on ? 'solid' : 'regular'} fa-star" aria-hidden="true"></i></button>`;

// The box that narrows the list, drawn only when there are rows. Filtering is
// the runtime's, in place, so this markup is the same with a filter in force.
const search = () => `<li class="px-3 pb-2" data-tower-project-filter>
      <input type="search" class="form-control form-control-sm" data-tower-project-search placeholder="Search projects" aria-label="Search projects" autocomplete="off">
    </li>`;

// One row: the box and the star, then the name that scopes to the repo alone.
// A button, not a link: the name re-scopes in place, so there is no href.
const row = (label, value, active, controls) => `<li class="d-flex align-items-center">
      ${controls}<button type="button" class="dropdown-item flex-grow-1${active ? ' active' : ''}" data-tower-scope="${esc(value)}"${active ? ' aria-current="true"' : ''}>${esc(label)}</button>
    </li>`;

/**
 * The selector menu: the search box, the All projects master row, then one row
 * per repo, the starred ones first. All projects is the active row whenever the
 * selection is not exactly one repo, which keeps the subset's boxes on screen;
 * the none state has no active row at all.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string} the menu's `li` children, or '' before the roster answers
 */
export const menuMarkup = (state) => {
  const slugs = orderedSlugs(state);
  if (!slugs.length) return '';
  const favored = favoritesOf(state);
  const selected = selectedSlugs(state);
  // The none state keeps the boxes with nothing ticked: it is the start of a
  // build. One project in force is the one state with nothing to tick.
  const none = isNone(selected);
  const single = !none && selected.length === 1;
  const ticks = none ? [] : slugs.filter((slug) => !selected.length || selected.includes(slug));
  // The star rides every row in all the modes; the box only while there is a
  // subset to build.
  const repoRow = (slug) => row(slug, slug, single && selected[0] === slug,
    `${single ? '' : box(slug, ticks.includes(slug))}${star(slug, favored.includes(slug))}`);
  return `${search()}
    ${row('All projects', '', !single && !none, single ? '' : masterBox(ticks.length, slugs.length))}
    ${slugs.map(repoRow).join('')}`;
};

/**
 * What the selector button says about the current selection: the tile is the
 * name's first character, as the theme spells it, and the second line is the
 * count behind the name, the one place the mode shows with the menu closed.
 *
 * @param {object} state - the runtime's feed state
 * @returns {{name: string, initial: string, env: string}}
 */
export const selectorLabel = (state) => {
  const slugs = slugsOf(state);
  // The selection is read raw: a `?repo=` naming a repo off the roster still
  // narrows every page to nothing, and the button naming it explains why.
  const selected = selectedSlugs(state);
  const total = slugs.length;
  let name = 'All projects';
  // Before the roster answers the count is not known, and the line says the
  // same thing the theme baked rather than a number nothing stands behind.
  let env = total ? `all ${total} repos on the roster` : 'every repo on the roster';
  if (isNone(selected)) {
    // The trigger is what explains an empty board, so it says No projects
    // rather than naming a tilde.
    name = 'No projects';
    env = total ? `${total} hidden` : 'nothing selected';
  } else if (selected.length === 1) {
    [name] = selected;
    env = `1 of ${total} repos`;
  } else if (selected.length > 1) {
    // The subset says its arithmetic on the name line and the hidden half under
    // it, but only when the roster stands behind the count: an unread roster or
    // a shared `?repo=` naming unknown repos hides nothing.
    const hidden = total - selected.length;
    name = hidden > 0 ? `${selected.length} of ${total} projects` : `${selected.length} projects`;
    if (hidden > 0) env = `${hidden} hidden`;
  }
  return { name, initial: (name[0] || '?').toUpperCase(), env };
};
