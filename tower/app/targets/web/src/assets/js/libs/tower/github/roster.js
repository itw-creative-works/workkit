// libs/tower/github/roster.js: the home pointer published beside the pages and
// the private roster read off the home repo. github.js re-exports it whole; no
// piece imports github.js.

// ── The roster ─────────────────────────────────────────────────────────────

import { limitMark, rest } from './wire.js';

/** The baked artifact, and the only one: which repo is the home, and which branch of it carries the roster. Relative, so a project-path Pages site resolves it too. */
export const HOME_PATH = 'data/home.json';

/**
 * The home repo's name under the viewer's login, where the central copy reads a
 * board from. Its twin is WK_HOME_REPO_NAME in workflow/home.sh, kept in step by
 * hand across the language line and pinned by tests/tower/app/github-roster.test.js.
 */
export const HOME_NAME = 'workkit';

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
 * `missing` marks a site published without a home (a 404, or a file naming
 * none), the case resolveHome answers from the token instead.
 *
 * @param {object} ctx
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, home: string|null, branch: string, status: number|null, reason: string|null, missing?: boolean}>}
 */
export const fetchHome = async (ctx = {}) => {
  const url = ctx.homePath || HOME_PATH;
  let response;
  try {
    response = await ctx.fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { ok: false, home: null, branch: ROSTER_REF, status: null, reason: `${url} did not answer (${error.message})` };
  }
  // Only a 404 is a site published without the file: any other refusal is a
  // pointer that failed to answer, never a reason to read the viewer's own board.
  if (response.status === 404) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} answered 404 - this site was published without its home repo`, missing: true };
  }
  if (!response.ok) {
    return { ok: false, home: null, branch: ROSTER_REF, status: response.status, reason: `${url} answered ${response.status}` };
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
  if (!home) return { ok: false, home: null, branch, status: response.status, reason: `${url} names no home repo, so there is nowhere to read the board's repositories from`, missing: true };
  return { ok: true, home, branch, status: response.status, reason: null };
};

/**
 * The home repo a login owns, on `main`: the central copy's answer when no file
 * names one. No login names no home, so no slug is invented from nothing.
 *
 * @param {string} login - the viewer's GitHub login
 * @returns {{home: string, branch: string}}
 */
export const homeFromLogin = (login) => ({
  home: typeof login === 'string' && login ? `${login}/${HOME_NAME}` : '',
  branch: ROSTER_REF,
});

// The last token's login, so the central copy asks GET /user once per token
// rather than once per feed per poll; a different token asks again.
let knownLogin = { token: '', login: '' };

/**
 * Whose token this is: the cached login for the same token, else GET /user,
 * cached only when it named one.
 *
 * @param {object} ctx - `{ token, fetch }`
 * @returns {Promise<{ok: boolean, login: string, status: number|null, reason: string|null}>}
 */
const loginFor = async (ctx) => {
  if (ctx.token && knownLogin.token === ctx.token) return { ok: true, login: knownLogin.login, status: 200, reason: null };
  const who = await rest('/user', ctx);
  const login = who.ok && who.data && typeof who.data.login === 'string' ? who.data.login : '';
  if (login) knownLogin = { token: ctx.token, login };
  return { ...who, login };
};

/**
 * Which repo is the home, and which tier said so. A published `data/home.json`
 * wins; a copy published without one (the central copy) asks GitHub whose token
 * this is and reads that viewer's own home repo on `main`.
 *
 * @param {object} ctx - `{ token, fetch, homePath }`
 * @returns {Promise<{ok: boolean, home: string|null, branch: string, status: number|null, reason: string|null, source: 'home.json'|'login'|null}>}
 */
export const resolveHome = async (ctx = {}) => {
  const pointer = await fetchHome(ctx);
  if (pointer.ok) return { ok: true, home: pointer.home, branch: pointer.branch, status: pointer.status, reason: null, source: 'home.json' };
  if (!pointer.missing) return { ...pointer, source: null };

  const who = await loginFor(ctx);
  const { home, branch } = homeFromLogin(who.login);
  if (!home) {
    const why = who.ok ? 'GitHub answered without a login' : who.reason;
    return {
      ok: false,
      home: null,
      branch: ROSTER_REF,
      status: who.status,
      reason: `this copy names no home repo, and the token's own login could not be read to find one: ${why}`,
      source: null,
      ...limitMark(who),
    };
  }
  return { ok: true, home, branch, status: who.status, reason: null, source: 'login' };
};

/**
 * Read the roster: the repos this board covers. Two steps, because Pages is
 * public even when its repo is private: only the home repo is named beside the
 * pages, and the list is read off it with the viewer's token. Past the home,
 * the result carries it and its `source`, so Settings can name the tier.
 *
 * @param {object} ctx
 * @param {string} ctx.token
 * @param {Function} ctx.fetch
 * @param {string} [ctx.homePath]
 * @returns {Promise<{ok: boolean, data: object|null, status: number|null, reason: string|null, home?: string, source?: string}>}
 */
export const fetchSlugs = async (ctx = {}) => {
  const pointer = await resolveHome(ctx);
  if (!pointer.ok) return { ok: false, data: null, status: pointer.status, reason: pointer.reason, ...limitMark(pointer) };
  const tier = { home: pointer.home, source: pointer.source };

  // The raw media type, so the answer is the file itself rather than GitHub's
  // envelope with the bytes base64'd inside it.
  const answer = await rest(
    `/repos/${pointer.home}/contents/${ROSTER_PATH}?ref=${encodeURIComponent(pointer.branch)}`,
    ctx,
    { accept: 'application/vnd.github.raw+json' },
  );
  if (!answer.ok) return { ok: false, data: null, status: answer.status, reason: answer.reason, ...tier, ...limitMark(answer) };
  if (!answer.data || !Array.isArray(answer.data.repos)) {
    return { ok: false, data: null, status: answer.status, reason: `${pointer.home} answered without a repo list at ${ROSTER_PATH} - the board has no repositories to sweep`, ...tier };
  }
  return {
    ok: true,
    data: parseSlugs({ repos: answer.data.repos, home: answer.data.home || pointer.home }),
    status: answer.status,
    reason: null,
    ...tier,
  };
};
