/**
 * workflow/home/services.js: the home repo's Discussions and Pages, each
 * turned on where it is off, the four categories checked and never created
 * (no API does).
 * Usage: const { discussions, pages, categoriesPresent } = require('./services');
 */

const { isPlain } = require('../../hooks/mods/settings.js');
const {
  ready, meta, enable, CATEGORIES,
} = require('../lib/discussions');
const { interactive, enterToOpen, poll } = require('../lib/flows');
const { spawnSync, onPath } = require('../lib/run');
const { secondsOf } = require('../lib/bounded');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { spin } = require('../lib/spin');
const { PAGES_BRANCH } = require('./options');

/**
 * The CATEGORIES one meta answer lacks; none means all four are there.
 * @param {object} answer a meta answer
 * @returns {string[]}
 */
const missingCategories = (answer) => CATEGORIES.filter((name) => !(isPlain(answer.categories) && Object.hasOwn(answer.categories, name)));

/**
 * The poll's check: a fresh read of the categories.
 * @param {string} slug
 * @returns {Promise<string[]|null>} the missing names, none when all four are there; null when the read failed
 */
const categoriesPresent = async (slug) => {
  const answer = await meta(slug, { refresh: true });
  return answer === null ? null : missingCategories(answer);
};

/**
 * Discussions on, and the four categories checked: at a terminal the page is
 * opened and polled until they are there; a piped run prints the pointer.
 * @param {string} slug
 * @param {{stdin: object, stderr: object}} [io] the terminal the questions use, the process's own by default
 * @returns {Promise<number>} 0
 */
const discussions = async (slug, io) => {
  const page = `https://github.com/${slug}/discussions/categories`;
  if (!ready()) {
    skip('home: Discussions need gh; skipped');
    return 0;
  }
  const rc = await enable(slug);
  if (rc === 0) {
    ok(`home: Discussions enabled on ${slug}`);
  } else if (rc === 2) {
    skip(`home: Discussions are on for ${slug}`);
  } else {
    warn(`home: could not enable Discussions on ${slug}; turn them on at https://github.com/${slug}/settings`);
    return 0;
  }
  const answer = await meta(slug, { refresh: true });
  if (answer === null) return 0;
  let missing = missingCategories(answer);
  if (missing.length === 0) {
    skip('home: the Daily, Weekly, Monthly and Brief categories are there');
    return 0;
  }
  // The posts match on the name, so any format will do.
  if (interactive(io)) {
    await enterToOpen(page, 'the categories page', `Make the ${missing.join(', ')} categories on this page, each with that exact name (any format).`, io);
    let last = null;
    const check = async () => {
      const found = await categoriesPresent(slug);
      if (found !== null) last = found;
      return found !== null && found.length === 0;
    };
    // WORKKIT_HOME_POLL_INTERVAL is the suite's seam: a case waits one interval
    // it chose, never the five seconds an owner gets. Above 0, so no check runs back to back.
    if (await poll('Waiting for the categories', secondsOf(process.env.WORKKIT_HOME_POLL_INTERVAL, 5), check, io)) {
      ok('home: the Daily, Weekly, Monthly and Brief categories are there');
      return 0;
    }
    // A read that failed during the poll keeps what was last known.
    if (last !== null && last.length > 0) missing = last;
  }
  info(`home: the ${missing.join(', ')} categories do not exist yet; GitHub has no API that creates one, so make them once at ${page}. Until then the summaries and the brief publish in the repo's default category`);
  return 0;
};

/** A `gh api` call whose output is dropped; whether it exited 0. */
const ghApi = (args) => spawnSync('gh', ['api', ...args], { stdio: 'ignore', windowsHide: true }).status === 0;

/**
 * Pages from the root of the `gh-pages` branch, which need not exist yet: the
 * first publish makes it.
 * @param {string} slug
 * @returns {Promise<number>} 0
 */
const pages = async (slug) => {
  if (!onPath('gh')) return 0;
  if (await spin('reading the Pages settings', () => ghApi([`repos/${slug}/pages`]), { line: false })) {
    skip(`home: GitHub Pages is on for ${slug}`);
    return 0;
  }
  if (!(await spin('turning GitHub Pages on', () => ghApi(['-X', 'POST', `repos/${slug}/pages`, '-f', `source[branch]=${PAGES_BRANCH}`, '-f', 'source[path]=/']), { line: false }))) {
    warn(`home: could not enable GitHub Pages on ${slug}; a private repo needs a paid plan for Pages; make the repo public or enable it at https://github.com/${slug}/settings/pages`);
    return 0;
  }
  ok(`home: GitHub Pages serves ${slug} from ${PAGES_BRANCH} /`);
  return 0;
};

module.exports = {
  missingCategories, categoriesPresent, discussions, pages,
};
