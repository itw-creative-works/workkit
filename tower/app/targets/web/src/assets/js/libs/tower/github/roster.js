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
 * The branch the roster is read from when the home pointer names none; asking
 * GitHub for the default branch would cost a request before the first row.
 */
export const ROSTER_REF = 'main';

/**
 * The slug list, as the roster shape every page already reads. A published
 * entry has no `path`, so nothing places a session in it: a published copy has
 * no sessions.
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
 * The home repo's slug and the roster's branch, from the one file published
 * beside the pages. Unauthenticated: it says nothing the site's URL does not.
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
  // A pointer naming no branch is the one case the fallback is for.
  const branch = (parsed && typeof parsed.branch === 'string' && parsed.branch) ? parsed.branch : ROSTER_REF;
  if (!home) return { ok: false, home: null, branch, status: response.status, reason: `${url} names no home repo, so there is nowhere to read the board's repositories from` };
  return { ok: true, home, branch, status: response.status, reason: null };
};

/**
 * Read the roster: the repos this board covers. Two steps, because Pages is
 * public even when its repo is private: only the home repo is named beside the
 * pages, and the list is read off it with the viewer's token.
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
