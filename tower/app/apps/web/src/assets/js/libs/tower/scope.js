//
// The repo scope — what `?repo=` says, in the one place that reads and writes
// it.
//
// The selection is a SET of slugs, not a slug: `?repo=` carries one repo, or a
// comma-separated subset of the roster, or nothing at all for every repo. The
// URL is its only home — nothing on the machine and nothing in localStorage
// remembers it — so the string in the query and the set every page filters by
// have to agree, and this file is the one translation between them.
//
// It is also what makes the selection survive a click on the nav: the sidebar's
// page links are rewritten to carry the current value, and `scopedHref` is that
// rewrite. Pure string and array functions, no DOM — which is what lets the
// suite ask the parse, the format and the predicate the questions the browser
// used to be the only way to ask.
//

/** The tower's own pages — the links the sidebar carries the selection onto. */
export const SCOPED_PATHS = ['/', '/board', '/crew', '/usage', '/health', '/brief'];

/** A base for parsing a relative href; only the path and the query are ever read back. */
const BASE = 'http://tower.invalid';

/**
 * The slugs a `?repo=` value names, in the order it names them.
 *
 * Empty, absent or all-whitespace is the empty list, which every predicate
 * reads as "every repo" — the tower's default scope.
 *
 * @param {string} value - the raw query value
 * @returns {string[]} the slugs, trimmed, de-duplicated, blanks dropped
 */
export const parseRepos = (value) => String(value == null ? '' : value)
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean)
  .filter((slug, index, all) => all.indexOf(slug) === index);

/**
 * The `?repo=` value a set of slugs is written as.
 *
 * @param {string[]} slugs - the slugs in play
 * @returns {string} the query value, '' for every repo
 */
export const formatRepos = (slugs) => parseRepos((slugs || []).join(',')).join(',');

/**
 * The slugs the runtime's selection leaves in play.
 *
 * `state.selectedRepo` stays the RAW query value — one string, the thing that
 * goes back into the URL — and every reader comes through here rather than
 * comparing against it, because a comma list compared as a slug matches nothing
 * and silently empties the page.
 *
 * @param {object} state - the runtime's feed state
 * @returns {string[]}
 */
export const selectedSlugs = (state) => parseRepos(state && state.selectedRepo);

/**
 * Whether one repo is in scope: no selection is every repo, one slug is that
 * repo, several is the subset.
 *
 * @param {string[]} slugs - the selection, from `selectedSlugs`
 * @param {string} slug - the repo being placed
 * @returns {boolean}
 */
export const inScope = (slugs, slug) => !slugs.length || slugs.includes(slug);

/** The path an href points at, with the trailing slash and any `.html` taken off. */
const pathOf = (href) => {
  const { pathname } = new URL(href, BASE);
  const clean = pathname.replace(/\.html$/, '').replace(/\/+$/, '');
  return clean || '/';
};

/**
 * Whether an href is one of the tower's pages — the test the nav rewrite makes
 * before touching a link, so anything the framework puts in the sidebar that
 * points OFF the tower's six pages is left alone. The brand lockup's `/` IS one
 * of them, on purpose: brand-to-Overview keeps the scope like any other page
 * move. A hash-only href is NOT: it goes nowhere by design (the selector menu's
 * placeholder), and resolving it against the base would turn "stay here" into
 * a navigation to Overview.
 *
 * @param {string} href
 * @returns {boolean}
 */
export const isScopedPath = (href) => !href.startsWith('#') && SCOPED_PATHS.includes(pathOf(href));

/**
 * The same href, carrying the current selection.
 *
 * Idempotent: a link already carrying a selection is rewritten to the new one,
 * and an empty selection takes the parameter off rather than leaving `?repo=`
 * behind.
 *
 * @param {string} href - the link's href, relative or absolute
 * @param {string} value - the `?repo=` value, '' for every repo
 * @returns {string} the href, path and query only
 */
export const scopedHref = (href, value) => {
  const url = new URL(href, BASE);
  if (value) url.searchParams.set('repo', value);
  else url.searchParams.delete('repo');
  // The separator is written as a comma, not as `%2C`: both read back the same
  // through `searchParams`, and the query is a thing people copy out of the
  // address bar and paste to each other.
  const search = url.search.replace(/%2C/g, ',');
  return `${url.pathname}${search}${url.hash}`;
};
