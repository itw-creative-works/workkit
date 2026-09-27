// The repo scope: the one translation between the `?repo=` string and the set
// of slugs every page filters by, the nav rewrite that carries it, and the path
// prefix a published copy is served under (`sitePath`). Pure string and array
// functions; the only DOM read is the prefix stamp.

/**
 * Where the token is typed: the one page a copy holding none can use, and so
 * the one address the runtime navigates to by itself.
 */
export const SETTINGS_PATH = '/settings';

/**
 * The tower's own pages, as identities written from the site's root:
 * `sitePath` gives the address a copy serves them at, `pathOf` the way back.
 */
export const SCOPED_PATHS = ['/', '/board', '/crew', '/usage', '/health', '/brief', SETTINGS_PATH];

/** A base for parsing a relative href; only the path and the query are ever read back. */
const BASE = 'http://tower.invalid';

/**
 * The `?repo=` value that means no repos at all, what unticking every box
 * writes: an absent value already means every repo, and a tilde can never be a
 * GitHub name. It needs no special parsing, since a selection naming no roster
 * repo already places nothing; `isNone` is for the surfaces that say it.
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
 * The slugs the runtime's selection leaves in play. `state.selectedRepo` stays
 * the raw query value; every reader comes through here, since a comma list
 * compared as a slug matches nothing and silently empties the page.
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
 * The prefix this copy is served under: '' at a site's root, `/<name>` on a
 * project Pages site. Read off the `data-omega-path-prefix` stamp the build
 * leaves (workflow/publish.sh hands it `OMEGA_PATH_PREFIX`), never guessed from
 * the path, and off the DOM rather than the framework's reader for api.js's
 * reason. The normalization mirrors the build's.
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
 * One of the tower's paths, as this copy serves it - the one place the prefix is
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
 * Whether an href is one of the tower's pages, so the nav rewrite leaves any
 * other sidebar link alone. The brand's `/` is one, keeping the scope; a
 * hash-only href is not: it goes nowhere by design (the selector's placeholder).
 *
 * @param {string} href
 * @returns {boolean}
 */
export const isScopedPath = (href) => !href.startsWith('#') && SCOPED_PATHS.includes(pathOf(href));

/**
 * The same href, carrying the current selection: an existing one is replaced,
 * an empty one takes the parameter off, and the path comes back out through
 * `sitePath`, so the link lands on this copy wherever it is served from.
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
 * The Settings page, carrying the current selection, so a viewer sent there
 * comes back to the board they were narrowed to.
 *
 * @param {string} value - the `?repo=` value, '' for every repo
 * @returns {string}
 */
export const settingsHref = (value) => scopedHref(SETTINGS_PATH, value);
