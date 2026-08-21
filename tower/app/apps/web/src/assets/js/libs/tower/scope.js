//
// The repo scope - what `?repo=` says, in the one place that reads and writes
// it.
//
// The selection is a SET of slugs, not a slug: `?repo=` carries one repo, or a
// comma-separated subset of the roster, or nothing at all for every repo. The
// URL is its only home - nothing on the machine and nothing in localStorage
// remembers it - so the string in the query and the set every page filters by
// have to agree, and this file is the one translation between them.
//
// It is also what makes the selection survive a click on the nav: the sidebar's
// page links are rewritten to carry the current value, and `scopedHref` is that
// rewrite. Pure string and array functions, no DOM - which is what lets the
// suite ask the parse, the format and the predicate the questions the browser
// used to be the only way to ask.
//
// And since every one of those links is a PATH, this is also where the tower
// learns where it is served from (issue #169). A published copy answers under a
// prefix - `<owner>.github.io/<name>/` - and the build rewrites only the URLs it
// emits into the HTML; a URL the runtime assembles is this app's own to get
// right, and a root-absolute one walks off the site. `basePath` reads the
// prefix the build stamped on the page and `sitePath` is the one thing that
// applies it, so every address the runtime builds comes out under it. On a
// root-served copy the prefix is the empty string and nothing moves.
//

/**
 * Where the token is typed (issue #167) - the one page a copy holding none can
 * use, and so the one address the runtime navigates to by itself.
 */
export const SETTINGS_PATH = '/settings';

/**
 * The tower's own pages - the links the sidebar carries the selection onto.
 *
 * These are page IDENTITIES, written from the site's root, and never an address
 * on their own: what a copy under a prefix actually serves them at is
 * `sitePath`'s answer, and `pathOf` is the way back to the identity.
 */
export const SCOPED_PATHS = ['/', '/board', '/crew', '/usage', '/health', '/brief', SETTINGS_PATH];

/** A base for parsing a relative href; only the path and the query are ever read back. */
const BASE = 'http://tower.invalid';

/**
 * The `?repo=` value that means NO repos at all (issue #188) - what unticking
 * every box writes. An ABSENT value already means every repo, so "none" needs a
 * value of its own, and a tilde can never collide with a repo: GitHub names
 * allow only letters, digits, `-`, `_` and `.`. It asks for no special parsing
 * - a selection naming a repo the roster does not carry already places
 * nothing, which is exactly what this state is - and `isNone` below is the one
 * door for the surfaces that DRAW the state in words rather than filter by it.
 */
export const NONE = '~';

/**
 * Whether a parsed selection is the none state - what the surfaces that say
 * "no projects selected" test, so no page ever compares against the tilde
 * itself or prints it.
 *
 * @param {string[]} slugs - the selection, from `selectedSlugs`/`parseRepos`
 * @returns {boolean}
 */
export const isNone = (slugs) => slugs.length === 1 && slugs[0] === NONE;

/**
 * The slugs a `?repo=` value names, in the order it names them.
 *
 * Empty, absent or all-whitespace is the empty list, which every predicate
 * reads as "every repo" - the tower's default scope.
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
 * `state.selectedRepo` stays the RAW query value - one string, the thing that
 * goes back into the URL - and every reader comes through here rather than
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
const cleanPath = (href) => {
  const { pathname } = new URL(href, BASE);
  const clean = pathname.replace(/\.html$/, '').replace(/\/+$/, '');
  return clean || '/';
};

/**
 * The prefix this copy of the tower is served under: '' at a site's root, and
 * `/<name>` on a project Pages site.
 *
 * The build's own answer, read back off the page: `OMEGA_PATH_PREFIX` is what
 * the publisher hands the build (workflow/publish.sh), and the build stamps the
 * normalized value on `<html data-omega-path-prefix>` as it mounts every URL it
 * emits (@omega.js/web's path-prefix pass, omega#355). Never guessed from the
 * page's path: a path-shaped guess has to know which segment is the site and
 * which is the page, and it gets `/index.html` - and a repo named after one of
 * the pages - wrong. Every absence is the domain root, which is exactly what a
 * root-served site ships: it is stamped only when there IS a prefix.
 *
 * The value is read off the DOM rather than through the framework's own reader
 * (`__main_assets__/js/libs/path-prefix.js`, the same stamp) for api.js's
 * reason: a framework import is a bundler specifier that would take this module
 * out of reach of its own suite. The normalization mirrors the build's, since
 * this reads an attribute rather than the value that was handed over.
 *
 * @returns {string} the prefix, with no trailing slash, or ''
 */
export const basePath = () => {
  const stamped = (globalThis.document?.documentElement?.dataset?.omegaPathPrefix || '').trim();
  if (!stamped) return '';
  const prefix = `/${stamped}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return prefix === '/' ? '' : prefix;
};

/**
 * One of the tower's paths, as THIS copy serves it - the one place the prefix is
 * applied, and what every URL the runtime builds goes through.
 *
 * @param {string} path - a page path, written from the site's root
 * @returns {string}
 */
export const sitePath = (path) => `${basePath()}${path}`;

/**
 * The tower page an href points at, as an identity: the prefix taken off, so a
 * link the build wrote under one and a link written from the root are the same
 * page. `sitePath` is the way back.
 *
 * @param {string} href - the link's href, relative or absolute
 * @returns {string} the path, from the site's root
 */
export const pathOf = (href) => {
  const clean = cleanPath(href);
  const base = basePath();
  if (!base) return clean;
  if (clean === base) return '/';
  return clean.startsWith(`${base}/`) ? clean.slice(base.length) : clean;
};

/**
 * Whether an href is one of the tower's pages - the test the nav rewrite makes
 * before touching a link, so anything the framework puts in the sidebar that
 * points OFF the tower's own pages is left alone. The brand lockup's `/` IS one
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
 * The path comes back out through `sitePath`, so the link lands on this copy
 * wherever it is served from - a link the build already prefixed keeps the
 * prefix it has, and one written from the root is put under it rather than
 * pointed off the site (issue #169).
 *
 * @param {string} href - the link's href, relative or absolute
 * @param {string} value - the `?repo=` value, '' for every repo
 * @returns {string} the href, path and query only
 */
export const scopedHref = (href, value) => {
  const url = new URL(href, BASE);
  if (value) url.searchParams.set('repo', value);
  else url.searchParams.delete('repo');
  // The separator is written as a comma and the none state as its tilde, not
  // as `%2C`/`%7E`: all of them read back the same through `searchParams`, and
  // the query is a thing people copy out of the address bar and paste to each
  // other.
  const search = url.search.replace(/%2C/g, ',').replace(/%7E/g, '~');
  return `${sitePath(pathOf(url.pathname))}${search}${url.hash}`;
};

/**
 * The Settings page, carrying the current selection.
 *
 * Written through the same formatter every nav link is, for the same reason:
 * a viewer sent to Settings by the runtime, or following the line that points
 * there, comes back to the board they were narrowed to (issue #167).
 *
 * @param {string} value - the `?repo=` value, '' for every repo
 * @returns {string}
 */
export const settingsHref = (value) => scopedHref(SETTINGS_PATH, value);
