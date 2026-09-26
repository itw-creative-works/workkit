// libs/tower/github/roster.js: the home pointer published beside the pages and
// the private roster read off the home repo. github.js re-exports it whole; no
// piece imports github.js.

// ── The roster ─────────────────────────────────────────────────────────────

import { limitMark, rest } from './wire.js';

/** The baked artifact, and the only one: which repo is the home, and which branch of it carries the roster. Relative, so a project-path Pages site resolves it too. */
export const HOME_PATH = 'data/home.json';

/** Where the roster lives - a path on the home repo, read through the API with the viewer's token. */
export const ROSTER_PATH = 'data/repos.json';

/**
 * The branch it is read from when the home pointer does not say.
 *
 * The publish names the branch it actually pushed to (issue #112), so nothing
 * here has to assume; this is what a site published BEFORE that key existed
 * falls back to, and it is what those sites were written by. Asking GitHub for
 * the default branch instead would cost a request before the first row is drawn.
 */
export const ROSTER_REF = 'main';

/**
 * The slug list, as the roster shape every page already reads.
 *
 * It carries names and nothing else: which repos this site sweeps, plus which
 * of them is the home repo the summaries are published on. A published roster
 * entry has no `path` - there is no machine under it - so the fields that place
 * a session by its working directory simply find nothing, which is correct: a
 * published copy has no sessions.
 *
 * @param {object} parsed - the parsed data/repos.json
 * @returns {{repos: Array<{name: string, path: string, slug: string}>, home: string}}
 */
export const parseSlugs = (parsed) => {
  const slugs = ((parsed && parsed.repos) || [])
    .filter((slug) => typeof slug === 'string' && slug.includes('/'));
  return {
    repos: slugs.map((slug) => ({ name: slug.split('/')[1], path: '', slug })),
    home: (parsed && typeof parsed.home === 'string' && parsed.home.includes('/')) ? parsed.home : '',
  };
};

/**
 * The home repo's slug, from the one file published beside the pages.
 *
 * Unauthenticated, because it is public and says nothing the site's own URL does
 * not: the repo it is served from.
 *
 * It carries the BRANCH as well as the repo (issue #112): the publish pushes
 * whatever branch the home clone is on, so the reader is told which one rather
 * than assuming the account's default is named `main`.
 *
 * @param {object} ctx
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, home: string|null, branch: string, status: number|null, reason: string|null}>}
 */
export const fetchHome = async (ctx = {}) => {
  const url = ctx.homePath || HOME_PATH;
  let response;
  try {
    response = await ctx.fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { ok: false, home: null, branch: ROSTER_REF, status: null, reason: `${url} did not answer (${error.message})` };
  }
  if (!response.ok) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} answered ${response.status} - this site was published without its home repo` };
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch (error) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} is not JSON (${error.message})` };
  }
  const home = parsed && typeof parsed.home === 'string' && parsed.home.includes('/') ? parsed.home : null;
  // A site published before the key existed says nothing about a branch, which
  // is the one case the fallback is for.
  const branch = (parsed && typeof parsed.branch === 'string' && parsed.branch) ? parsed.branch : ROSTER_REF;
  if (!home) return { ok: false, home: null, branch, status: response.status, reason: `${url} names no home repo, so there is nowhere to read the board's repositories from` };
  return { ok: true, home, branch, status: response.status, reason: null };
};

/**
 * Read the roster: the repos this board covers.
 *
 * Two steps, because the list is PRIVATE (issue #110). Pages is public even when
 * the repo serving it is not, so the names of the repositories on it are read
 * from the home repo's default branch through the API - with the same viewer
 * token the sweep uses, and refused in the same words when it does not reach.
 * The only thing published beside the pages is which repo to ask.
 *
 * @param {object} ctx
 * @param {string} ctx.token
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, data: object|null, status: number|null, reason: string|null}>}
 */
export const fetchSlugs = async (ctx = {}) => {
  const pointer = await fetchHome(ctx);
  if (!pointer.ok) return { ok: false, data: null, status: pointer.status, reason: pointer.reason, ...limitMark(pointer) };

  // The raw media type, so the answer is the file itself rather than GitHub's
  // envelope with the bytes base64'd inside it.
  const answer = await rest(
    `/repos/${pointer.home}/contents/${ROSTER_PATH}?ref=${encodeURIComponent(pointer.branch)}`,
    ctx,
    { accept: 'application/vnd.github.raw+json' },
  );
  if (!answer.ok) return { ok: false, data: null, status: answer.status, reason: answer.reason, ...limitMark(answer) };
  if (!answer.data || !Array.isArray(answer.data.repos)) {
    return { ok: false, data: null, status: answer.status, reason: `${pointer.home} answered without a repo list at ${ROSTER_PATH} - the board has no repositories to sweep` };
  }
  return {
    ok: true,
    data: parseSlugs({ repos: answer.data.repos, home: answer.data.home || pointer.home }),
    status: answer.status,
    reason: null,
  };
};
